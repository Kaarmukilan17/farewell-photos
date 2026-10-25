import React, { useState } from 'react'
import { supabase } from './supabase.js'
import { loadModels, detectAll, resizeImage } from './face.js'

// short fingerprint of the original file, used to skip photos this login already uploaded
async function fingerprint(file) {
  try {
    const buf = await file.arrayBuffer()
    const h = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch (e) {
    return null
  }
}

async function loadMyHashes(email) {
  const seen = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('photos')
      .select('file_hash')
      .eq('uploader', email)
      .not('file_hash', 'is', null)
      .range(from, from + 999)
    if (error || !data) break
    data.forEach((r) => seen.add(r.file_hash))
    if (data.length < 1000) break
  }
  return seen
}

export default function Upload({ user }) {
  const [log, setLog] = useState([])
  const [failed, setFailed] = useState([])
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const displayName = (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email.split('@')[0]
  ).trim()

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    setLog([])
    setFailed([])
    setSummary('')
    setProgress({ done: 0, total: files.length })
    await loadModels()
    const seen = await loadMyHashes(user.email)

    let okCount = 0
    let skipped = 0
    let faces = 0
    const bad = []
    for (const file of files) {
      try {
        const hash = await fingerprint(file)
        if (hash && seen.has(hash)) {
          skipped++
          setLog((l) => ['Skipped (already uploaded): ' + file.name, ...l].slice(0, 5))
        } else {
          const { blob, canvas } = await resizeImage(file)
          const dets = await detectAll(canvas)

          const path = crypto.randomUUID() + '.jpg'
          const up = await supabase.storage.from('photos').upload(path, blob, {
            contentType: 'image/jpeg',
          })
          if (up.error) throw up.error

          const { data: photo, error: pe } = await supabase
            .from('photos')
            .insert({ path, uploader: user.email, uploader_name: displayName, file_hash: hash })
            .select('id')
            .single()
          if (pe) {
            if (pe.code === '23505') {
              skipped++
              seen.add(hash)
              throw new Error('__dup__')
            }
            throw pe
          }
          if (hash) seen.add(hash)

          if (dets.length) {
            const rows = dets.map((d) => ({
              photo_id: photo.id,
              descriptor: Array.from(d.descriptor),
            }))
            const { error: fe } = await supabase.from('faces').insert(rows)
            if (fe) throw fe
          }
          okCount++
          faces += dets.length
          setLog((l) => ['OK: ' + file.name + ' (' + dets.length + ' face(s))', ...l].slice(0, 5))
        }
      } catch (err) {
        if (err.message !== '__dup__') {
          const msg = file.name + ' - ' + (err.message || err)
          bad.push(msg)
          setFailed([...bad])
          setLog((l) => ['Failed: ' + msg, ...l].slice(0, 5))
        }
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setSummary(
      okCount + ' uploaded, ' + skipped + ' skipped (already uploaded), ' + bad.length + ' failed. ' + faces + ' faces found.'
    )
    setBusy(false)
  }

  return (
    <div className="card">
      <h2>Upload photos</h2>
      <p className="muted">
        Choose as many photos as you like. They are resized on your phone first, so uploads are quick.
        Photos you already uploaded from this account are skipped automatically.
        Keep this page open until the summary appears.
      </p>
      <p className="muted">
        Check your gallery for farewell photos of friends that you have not shared yet, and upload
        those. There is no need to upload photos you have already shared with everyone in them.
      </p>
      <p className="muted">
        Your name ({displayName}) and college email are shown to people who download your photos, so
        they can ask you for the original quality.
      </p>
      <label className={'btn ' + (busy ? 'disabled' : '')}>
        {busy ? 'Uploading ' + progress.done + ' of ' + progress.total + '...' : 'Choose photos'}
        <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={handleFiles} />
      </label>
      {busy && (
        <div className="bar"><div style={{ width: (progress.done / progress.total) * 100 + '%' }} /></div>
      )}
      {summary && <p className="big">{summary}</p>}
      {failed.length > 0 && (
        <div>
          <p className="warn">These photos did not upload. Try saving them as JPG and uploading again:</p>
          <ul className="log">{failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {busy && <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  )
}
