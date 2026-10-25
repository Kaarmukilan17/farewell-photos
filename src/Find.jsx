import React, { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { supabase } from './supabase.js'
import { distance, MATCH_THRESHOLD } from './face.js'
import LiveCheck from './LiveCheck.jsx'

const BATCH = 50
const CANDIDATE_LIMIT = 0.55 // solo photos up to this score can be used to improve a profile
const MAX_FRAMES = 12 // most saved looks per person
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
  const [verified, setVerified] = useState(false)
  const [photos, setPhotos] = useState([]) // every row we loaded
  const [onlyNew, setOnlyNew] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [selectedHidden, setSelectedHidden] = useState(new Set())
  const [selectedCand, setSelectedCand] = useState(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [showImprove, setShowImprove] = useState(false)
  const [status, setStatus] = useState('')
  const [lastDownload, setLastDownload] = useState(null)
  const facesRef = useRef(null)

  useEffect(() => {
    supabase.from('profiles').select('*').eq('email', user.email).maybeSingle().then(({ data }) => {
      setProfile(data)
      setLastDownload(data?.last_download || null)
      setStage(data ? 'verify' : 'enroll')
    })
  }, [])

  // Compare every stored face with the saved profile and load the matching photos
  async function runSearch(mine, refetch = true) {
    setStage('searching')
    setStatus('Scanning all photos...')
    try {
      if (refetch || !facesRef.current) facesRef.current = await fetchAllFaces()
      const faces = facesRef.current

      const counts = new Map()
      for (const f of faces) counts.set(f.photo_id, (counts.get(f.photo_id) || 0) + 1)

      const scores = new Map() // photo -> best score, kept if under the loose limit
      const soloFace = new Map() // photo with exactly one face -> that face
      for (const f of faces) {
        // score = the 2nd closest saved frame, so one lucky frame cannot cause a wrong match
        const ds = mine.map((r) => distance(r, f.descriptor)).sort((a, b) => a - b)
        const d = ds.length > 1 ? ds[1] : ds[0]
        if (d < CANDIDATE_LIMIT) {
          scores.set(f.photo_id, Math.min(scores.get(f.photo_id) ?? 9, d))
          if (counts.get(f.photo_id) === 1) soloFace.set(f.photo_id, f.descriptor)
        }
      }

      // photos this person marked "Not me" earlier
      const { data: hid } = await supabase
        .from('match_feedback').select('photo_id').eq('user_email', user.email)
      const hidden = new Set((hid || []).map((h) => h.photo_id))

      const matchedIds = [...scores.keys()].filter((id) => scores.get(id) < MATCH_THRESHOLD)
      const candIds = [...soloFace.keys()]
        .filter((id) => !hidden.has(id))
        .sort((a, b) => scores.get(a) - scores.get(b))
        .slice(0, 30)
      const ids = [...new Set([...matchedIds, ...candIds])]

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
      const all = rows.map((r) => ({
        ...r,
        url: urlMap.get(r.path),
        dist: scores.get(r.id),
        matched: scores.get(r.id) < MATCH_THRESHOLD,
        hidden: hidden.has(r.id),
        solo: soloFace.has(r.id),
        faceDesc: soloFace.get(r.id) || null,
      }))
      setPhotos(all)
      // how many photos were shown, to compare with the Not me reports later
      supabase
        .from('search_log')
        .insert({ user_email: user.email, shown: all.filter((p) => p.matched && !p.hidden).length })
        .then(() => {})
      setSelected(new Set())
      setSelectedHidden(new Set())
      setSelectedCand(new Set())
      setStatus('')
      setStage('results')
    } catch (e) {
      setStatus('Error: ' + (e.message || e))
      setStage('verify')
    }
  }

  async function onLive(frames) {
    setStage('searching')
    setStatus('Checking that it is really you...')
    try {
      let mine = profile?.descriptors
      if (!mine) {
        // first time: lock these looks to this college email
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
      setVerified(true)
      await runSearch(mine, true)
    } catch (e) {
      setStatus('Error: ' + (e.message || e))
      setStage(profile ? 'verify' : 'enroll')
    }
  }

  async function refresh() {
    if (!verified || !profile) {
      setStatus('')
      setStage('verify')
      return
    }
    await runSearch(profile.descriptors, true)
  }

  const isNew = (p) => !lastDownload || new Date(p.created_at) > new Date(lastDownload)
  const visible = useMemo(() => photos.filter((p) => p.matched && !p.hidden), [photos])
  const hiddenList = useMemo(() => photos.filter((p) => p.matched && p.hidden), [photos])
  const candidates = useMemo(
    () => photos.filter((p) => p.solo && !p.hidden).sort((a, b) => a.dist - b.dist).slice(0, 30),
    [photos]
  )
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

  const flip = (setter) => (id) =>
    setter((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggle = flip(setSelected)
  const toggleHidden = flip(setSelectedHidden)
  const toggleCand = flip(setSelectedCand)

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

  // Add the face from chosen solo photos to the saved profile
  async function addToProfile() {
    const list = candidates.filter((p) => selectedCand.has(p.id))
    if (!list.length || !profile) return
    const mine = profile.descriptors
    const room = MAX_FRAMES - mine.length
    if (room <= 0) {
      setStatus('Your profile already has the maximum number of saved looks (' + MAX_FRAMES + ').')
      return
    }
    const ok = window.confirm(
      'Add ' + list.length + ' selected photo(s) to your profile? Only choose photos where you are the only person.'
    )
    if (!ok) return
    const add = []
    for (const p of list) {
      const d = Array.from(p.faceDesc)
      const closest = Math.min(...mine.map((m) => distance(m, d)))
      if (closest < 0.05) continue // already saved
      if (closest >= CANDIDATE_LIMIT) continue // does not look like the registered face
      add.push(d)
      if (add.length >= room) break
    }
    if (!add.length) {
      setStatus('Nothing new to add from those photos.')
      return
    }
    const next = [...mine, ...add]
    const { error } = await supabase.from('profiles').update({ descriptors: next }).eq('email', user.email)
    if (error) {
      setStatus('Could not save: ' + error.message)
      return
    }
    setProfile({ ...profile, descriptors: next })
    await runSearch(next, false)
    setStatus('Profile improved with ' + add.length + ' new look(s). Your photos were refreshed.')
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

  if (stage === 'enroll')
    return (
      <div className="card center">
        <h2>Register your face</h2>
        <p className="muted">
          First time only, about 15 seconds: the camera will ask you to look straight, smile, and turn your
          head a little each way. This is locked to your college email, so nobody else can search for your
          photos. Look the way you usually do in photos (keep your glasses on if you wear them) and use good
          light. Your selfie is never saved.
        </p>
        {status && <p className="warn">{status}</p>}
        <button onClick={() => { setStatus(''); setStage('enroll-cam') }}>Open camera</button>
      </div>
    )

  if (stage === 'verify')
    return (
      <div className="card center">
        <h2>Verify it is you</h2>
        <p className="muted">
          A quick face check to confirm it is you, then your photos load. Your selfie is never saved.
        </p>
        {status && <p className="warn">{status}</p>}
        <button onClick={() => { setStatus(''); setStage('verify-cam') }}>Verify and find my photos</button>
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
  const savedLooks = profile?.descriptors?.length || 0
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
          <button className="ghost" onClick={refresh}>Refresh my photos</button>
        </div>
        <p className="muted">
          Tap photos to select them. Downloads are split into zip files of {BATCH} photos. If some selected photos are not you, press "Not me" and they will be hidden from your results. You can restore them any time. Missing some of your photos? Use "Improve my profile" at the bottom.
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

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Improve my profile</h3>
        <p className="muted">
          Missing some of your photos? Pick a few clear photos where you are the <b>only person</b>. They
          are added to your saved face, so more of your photos are found. Only solo photos that look like
          your registered face are listed. Saved looks: {savedLooks} of {MAX_FRAMES}.
        </p>
        <button className="ghost" onClick={() => setShowImprove((v) => !v)}>
          {showImprove ? 'Close' : 'Choose solo photos'}
        </button>
        {showImprove && (
          <div>
            {candidates.length === 0 ? (
              <p className="muted">No solo photos of you were found yet. Check again after more photos are uploaded.</p>
            ) : (
              <div className="grid" style={{ marginTop: 10 }}>
                {candidates.map((p) => (
                  <div key={p.id} className={'thumb ' + (selectedCand.has(p.id) ? 'sel' : '')} onClick={() => toggleCand(p.id)}>
                    <img src={p.url} loading="lazy" />
                    {selectedCand.has(p.id) && <span className="tick">Selected</span>}
                    <span className="cap">{debug ? p.dist.toFixed(2) + ' | ' : ''}{nameOf(p)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={addToProfile} disabled={!selectedCand.size}>
              Add to my profile ({selectedCand.size})
            </button>
          </div>
        )}
      </div>

      {hiddenList.length > 0 && (
        <div className="card">
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
