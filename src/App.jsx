import React, { useEffect, useState } from 'react'
import { supabase, isCollegeEmail, ALLOWED_DOMAIN } from './supabase.js'
import Upload from './Upload.jsx'
import Find from './Find.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('find')
  const [consent, setConsent] = useState(() => localStorage.getItem('consent') === '1')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email
  useEffect(() => {
    if (session && !isCollegeEmail(email)) {
      alert(`Only @${ALLOWED_DOMAIN} accounts are allowed.`)
      supabase.auth.signOut()
    }
  }, [session])

  const login = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' } },
    })

  if (session === undefined) return <div className="wrap"><div className="card">Loading…</div></div>

  if (!session || !isCollegeEmail(email))
    return (
      <div className="wrap">
        <div className="card center">
          <h1>🎓 Farewell Photos</h1>
          <p className="muted">Upload your photos. Find every photo you are in. Only for @{ALLOWED_DOMAIN}.</p>
          <button onClick={login}>Sign in with college Google</button>
        </div>
      </div>
    )

  if (!consent)
    return (
      <div className="wrap">
        <div className="card">
          <h2>Before you continue</h2>
          <p>
            To find your photos, this site detects faces in uploaded photos and stores a numeric face
            signature (not a photo of your face). Your live selfie is never saved. Everything will be
            deleted after the event.
          </p>
          <button onClick={() => { localStorage.setItem('consent', '1'); setConsent(true) }}>I agree</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>No, sign out</button>
        </div>
      </div>
    )

  return (
    <div className="wrap">
      <header>
        <h1>🎓 Farewell Photos</h1>
        <span className="muted">{email}</span>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <nav>
        <button className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>Find my photos</button>
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Upload photos</button>
      </nav>
      {tab === 'find' ? <Find user={session.user} /> : <Upload user={session.user} />}
    </div>
  )
}
