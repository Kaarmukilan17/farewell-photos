import React, { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { supabase } from './supabase.js'
import { distance, MATCH_THRESHOLD } from './face.js'
import LiveCheck from './LiveCheck.jsx'

const BATCH = 50
// open the site with ?debug=1 on the end to see each photo's match score
const debug = new URLSearchParams(window.location.search).get('debug') === '1'

const prefixOf = (email) => (email || '').split('@')[0]
const nameOf = (p) => (p.uploader_name || prefixOf(p.uploader) || 'unknown').trim()
const clean = (s) =>
  (s || '').replace(/[^a-zA-Z0-9 ._-]/g, '').trim().replace(/\s+/g, '_') || 'photo'

async function fetchAllFaces() {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('faces')
      .select('photo_id, descriptor')
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default function Find({ user }) {
  const [stage, setStage] = useState('loading') // loading | enroll | verify | searching | results
  const [profile, setProfile] = useState(null)
  const [photos, setPhotos] = useState([]) // includes hidden ones (hidden: true)
  const [onlyNew, setOnlyNew] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [selectedHidden, setSelectedHidden] = useState(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [status, setStatus] = useState('')
  const [lastDownload, setLastDownload] = useState(null)

  useEffect(() => {
    supabase.from('profiles').select('*').eq('email', user.email).maybeSingle().then(({ data }) => {
      setProfile(data)
      setLastDownload(data?.last_download || null)
      setStage(data ? 'verify' : 'enroll')
    })
  }, [])

  async function onLive(frames) {
    setStage('searching')
    setStatus('Checking that it is really you...')
    try {
      let mine = profile?.descriptors
      if (!mine) {
        // first time: lock this face to this college email
        const { error } = await supabase
          .from('profiles')
          .insert({ email: user.email, descriptors: frames })
        if (error) throw error
        mine = frames
        setProfile({ email: user.email, descriptors: frames })
      } else {
        const ok = frames.some((f) => mine.some((m) => distance(f, m) < MATCH_THRESHOLD))
        if (!ok) {
          setStatus('This face does not match the one registered for your email.')
          setStage('verify')
          return
        }
      }

      setStatus('Scanning all photos...')
      const faces = await fetchAllFaces()
      // match against the saved registration only, so every search gives the same result.
      // the live frames are only used above, to check that it is really you
      const refs = mine
      const best = new Map()
      for (const f of faces) {
        // score = the 2nd closest selfie frame, so one lucky frame cannot cause a wrong match
        const ds = refs.map((r) => distance(r, f.descriptor)).sort((a, b) => a - b)
        const d = ds.length > 1 ? ds[1] : ds[0]
        if (d < MATCH_THRESHOLD) best.set(f.photo_id, Math.min(best.get(f.photo_id) ?? 9, d))
      }

      // photos this person marked "Not me" earlier
      const { data: hid } = await supabase
        .from('match_feedback').select('photo_id').eq('user_email', user.email)
      const hidden = new Set((hid || []).map((h) => h.photo_id))

      const ids = [...best.keys()]
      const rows = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from('photos')
          .select('id, path, created_at, uploader, uploader_name')
          .in('id', ids.slice(i, i + 200))
        if (error) throw error
        rows.push(...data)
      }
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      const urls = []
      for (let i = 0; i < rows.length; i += 100) {
        const { data } = await supabase.storage
          .from('photos')
          .createSignedUrls(rows.slice(i, i + 100).map((r) => r.path), 3600)
        urls.push(...(data || []))
      }
      const urlMap = new Map(urls.map((u) => [u.path, u.signedUrl]))
      setPhotos(
        rows.map((r) => ({
          ...r,
          url: urlMap.get(r.path),
          dist: best.get(r.id),
          hidden: hidden.has(r.id),
        }))
      )
      // how many photos were shown, to compare with the Not me reports later
      supabase
        .from('search_log')
        .insert({ user_email: user.email, shown: rows.filter((r) => !hidden.has(r.id)).length })
        .then(() => {})
      setSelected(new Set())
      setSelectedHidden(new Set())
      setStatus('')
      setStage('results')
    } catch (e) {
      setStatus('Error: ' + (e.message || e))
      setStage(profile ? 'verify' : 'enroll')
    }
  }

  const isNew = (p) => !lastDownload || new Date(p.created_at) > new Date(lastDownload)
  const visible = useMemo(() => photos.filter((p) => !p.hidden), [photos])
  const hiddenList = useMemo(() => photos.filter((p) => p.hidden), [photos])
  const shown = useMemo(() => (onlyNew ? visible.filter(isNew) : visible), [visible, onlyNew, lastDownload])
  const newCount = useMemo(() => visible.filter(isNew).length, [visible, lastDownload])

  // who took the photos shown, so people know whom to contact
  const credits = useMemo(() => {
    const m = new Map()
    for (const p of shown) {
      const k = p.uploader || 'unknown'
      const e = m.get(k) || { name: nameOf(p), email: p.uploader, count: 0 }
      e.count++
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [shown])

  const toggle = (id) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleHidden = (id) =>
    setSelectedHidden((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function hideSelected() {
    const list = visible.filter((p) => selected.has(p.id))
    if (!list.length) return
    const ok = window.confirm(
      'Mark ' + list.length + ' selected photo(s) as NOT you? They will be hidden from your results. You can restore them later.'
    )
    if (!ok) return
    const rows = list.map((p) => ({ user_email: user.email, photo_id: p.id, distance: p.dist }))
    const { error } = await supabase.from('match_feedback').insert(rows)
    if (error && error.code !== '23505') {
      setStatus('Could not save that: ' + error.message)
      return
    }
    const ids = new Set(list.map((p) => p.id))
    setPhotos((l) => l.map((p) => (ids.has(p.id) ? { ...p, hidden: true } : p)))
    setSelected(new Set())
    setStatus(list.length + ' photo(s) hidden. You can restore them under "Hidden photos" below.')
  }

  async function restoreSelected() {
    const ids = [...selectedHidden]
    if (!ids.length) return
    const { data, error } = await supabase
      .from('match_feedback')
      .delete()
      .eq('user_email', user.email)
      .in('photo_id', ids)
      .select('photo_id')
    if (error || !data || !data.length) {
      setStatus('Could not restore: ' + (error ? error.message : 'not allowed. Tell the admin.'))
      return
    }
    const done = new Set(data.map((d) => d.photo_id))
    setPhotos((l) => l.map((p) => (done.has(p.id) ? { ...p, hidden: false } : p)))
    setSelectedHidden(new Set())
    setStatus(done.size + ' photo(s) restored.')
  }

  async function markDownloaded() {
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ last_download: now }).eq('email', user.email)
    setLastDownload(now)
    setSelected(new Set())
  }

  async function downloadList(list) {
    if (!list.length) return
    // file names: Name_001.jpg inside a folder per uploader: Name__emailprefix
    const counters = {}
    const named = list.map((p) => {
      const key = p.uploader || 'unknown'
      counters[key] = (counters[key] || 0) + 1
      const nm = clean(nameOf(p))
      const folder = nm + '__' + clean(prefixOf(p.uploader))
      return { ...p, zipPath: folder + '/' + nm + '_' + String(counters[key]).padStart(3, '0') + '.jpg' }
    })

    const parts = Math.ceil(named.length / BATCH)
    for (let part = 0; part < parts; part++) {
      const chunk = named.slice(part * BATCH, (part + 1) * BATCH)
      const zip = new JSZip()
      for (let i = 0; i < chunk.length; i++) {
        setStatus('Zip ' + (part + 1) + ' of ' + parts + ': photo ' + (i + 1) + ' of ' + chunk.length)
        const blob = await (await fetch(chunk[i].url)).blob()
        zip.file(chunk[i].zipPath, blob)
      }
      const out = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(out)
      a.download = 'my-farewell-photos-part' + (part + 1) + '.zip'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
      await new Promise((s) => setTimeout(s, 800))
    }
    setStatus('Download complete. Photos are grouped in folders named after the person who uploaded them.')
    await markDownloaded()
  }

  if (stage === 'loading') return <div className="card">Loading...</div>

  if (stage === 'enroll' || stage === 'verify')
    return (
      <div className="card center">
        <h2>{stage === 'enroll' ? 'Register your face' : 'Find my photos'}</h2>
        <p className="muted">
          {stage === 'enroll'
            ? 'First time only, about 15 seconds: the camera will ask you to look straight, smile, and turn your head a little each way. This is locked to your college email, so nobody else can search for your photos. Look the way you usually do in photos (keep your glasses on if you wear them) and use good light.'
            : 'Take a quick live selfie to find every photo you appear in, including new ones.'}
        </p>
        {status && <p className="warn">{status}</p>}
        <button onClick={() => { setStatus(''); setStage(stage + '-cam') }}>Open camera</button>
      </div>
    )

  if (stage.endsWith('-cam'))
    return (
      <LiveCheck
        mode={stage.startsWith('enroll') ? 'enroll' : 'verify'}
        onDone={onLive}
        onCancel={() => setStage(stage.replace('-cam', ''))}
      />
    )

  if (stage === 'searching') return <div className="card center"><p className="big">{status}</p></div>

  const chosen = visible.filter((p) => selected.has(p.id))
  return (
    <div>
      <div className="card">
        <h2>{visible.length} photos of you {newCount > 0 && <span className="badge">{newCount} new</span>}</h2>
        <div className="row">
          <label><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Show only new photos (since your last download)</label>
        </div>
        <div className="row">
          <button onClick={() => downloadList(visible.filter(isNew))} disabled={!newCount}>Download new ({newCount})</button>
          <button onClick={() => downloadList(shown)}>Download all shown ({shown.length})</button>
          <button onClick={() => downloadList(chosen)} disabled={!chosen.length}>Download selected ({chosen.length})</button>
        </div>
        <div className="row">
          <button className="ghost danger" onClick={hideSelected} disabled={!chosen.length}>Not me ({chosen.length})</button>
          <button className="ghost" onClick={() => setStage('verify')}>Search again</button>
        </div>
        <p className="muted">
          Tap photos to select them. Downloads are split into zip files of {BATCH} photos. If some selected photos are not you, press "Not me" and they will be hidden from your results. You can restore them any time.
        </p>
        {status && <p className="warn">{status}</p>}
      </div>

      {credits.length > 0 && (
        <div className="card">
          <h3>Photos taken by</h3>
          <p className="muted">Contact them if you want the original, full quality photo.</p>
          <ul className="credits">
            {credits.map((c) => (
              <li key={c.email}>
                <span>{c.name}</span>
                <a href={'mailto:' + c.email}>{c.email}</a>
                <span className="count">{c.count} photo{c.count > 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid">
        {shown.map((p) => (
          <div key={p.id} className={'thumb ' + (selected.has(p.id) ? 'sel' : '')} onClick={() => toggle(p.id)}>
            <img src={p.url} loading="lazy" />
            {isNew(p) && <span className="badge small">NEW</span>}
            {selected.has(p.id) && <span className="tick">Selected</span>}
            <span className="cap">{debug && p.dist != null ? p.dist.toFixed(2) + ' | ' : ''}{nameOf(p)}</span>
          </div>
        ))}
      </div>

      {hiddenList.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Hidden photos ({hiddenList.length})</h3>
          <p className="muted">These are the photos you marked as not you. If you hid one by mistake, select it and restore it.</p>
          <button className="ghost" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Hide this list' : 'Show hidden photos'}
          </button>
          {showHidden && (
            <div>
              <div className="grid" style={{ marginTop: 10 }}>
                {hiddenList.map((p) => (
                  <div key={p.id} className={'thumb ' + (selectedHidden.has(p.id) ? 'sel' : '')} onClick={() => toggleHidden(p.id)}>
                    <img src={p.url} loading="lazy" />
                    {selectedHidden.has(p.id) && <span className="tick">Selected</span>}
                    <span className="cap">{nameOf(p)}</span>
                  </div>
                ))}
              </div>
              <button onClick={restoreSelected} disabled={!selectedHidden.size}>
                Restore selected ({selectedHidden.size})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
