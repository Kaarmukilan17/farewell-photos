import React, { useState } from 'react'
import { supabase } from './supabase.js'
import { loadModels, detectAll, resizeImage } from './face.js'

export default function Upload({ user }) {
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    setLog([])
    setProgress({ done: 0, total: files.length })
    await loadModels()

    let faces = 0
    for (const file of files) {
      try {
        const { blob, canvas } = await resizeImage(file)
        const dets = await detectAll(canvas)

        const path = `${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('photos').upload(path, blob, {
          contentType: 'image/jpeg',
        })
        if (up.error) throw up.error

        const { data: photo, error: pe } = await supabase
          .from('photos')
          .insert({ path, uploader: user.email })
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
        faces += dets.length
        setLog((l) => [`✓ ${file.name} — ${dets.length} face(s)`, ...l].slice(0, 8))
      } catch (err) {
        setLog((l) => [`✗ ${file.name} — ${err.message || err}`, ...l].slice(0, 8))
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setLog((l) => [`Done. ${faces} faces indexed.`, ...l])
    setBusy(false)
  }

  return (
    <div className="card">
      <h2>Upload farewell photos</h2>
      <p className="muted">
        Pick as many photos as you want. They are shrunk on your phone first, so uploads are fast.
        Keep this tab open until it says Done.
      </p>
      <label className={'btn ' + (busy ? 'disabled' : '')}>
        {busy ? `Uploading ${progress.done}/${progress.total}…` : 'Choose photos'}
        <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={handleFiles} />
      </label>
      {busy && (
        <div className="bar"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
      )}
      <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  )
}
