import React, { useState } from 'react'
import { supabase } from './supabase.js'
import { loadModels, detectAll, resizeImage } from './face.js'

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

    let okCount = 0
    let faces = 0
    const bad = []
    for (const file of files) {
      try {
        const { blob, canvas } = await resizeImage(file)
        const dets = await detectAll(canvas)

        const path = crypto.randomUUID() + '.jpg'
        const up = await supabase.storage.from('photos').upload(path, blob, {
          contentType: 'image/jpeg',
        })
        if (up.error) throw up.error

        const { data: photo, error: pe } = await supabase
          .from('photos')
          .insert({ path, uploader: user.email, uploader_name: displayName })
          .select('id')
          .single()
        if (pe) throw pe

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
      } catch (err) {
        const msg = file.name + ' - ' + (err.message || err)
        bad.push(msg)
        setFailed([...bad])
        setLog((l) => ['Failed: ' + msg, ...l].slice(0, 5))
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setSummary(okCount + ' uploaded, ' + bad.length + ' failed. ' + faces + ' faces found.')
    setBusy(false)
  }

  return (
    <div className="card">
      <h2>Upload photos</h2>
      <p className="muted">
        Choose as many photos as you like. They are resized on your phone first, so uploads are quick.
        Keep this page open until the summary appears.
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
