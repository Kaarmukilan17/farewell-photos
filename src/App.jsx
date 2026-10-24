import React, { useEffect, useState } from 'react'
import { supabase, isCollegeEmail, ALLOWED_DOMAIN } from './supabase.js'
import Upload from './Upload.jsx'
import Find from './Find.jsx'

const WHATSAPP = '917845514978'

function BugButton({ email, page }) {
  const text =
    'Farewell Photos bug report\n' +
    'Account: ' + (email || 'not signed in') + '\n' +
    'Page: ' + page + '\n' +
    'Problem: '
  return (
    <a
      className="bug"
      href={'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(text)}
      target="_blank"
      rel="noreferrer"
    >
      Report a problem on WhatsApp
    </a>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('find')
  const [consent, setConsent] = useState(() => localStorage.getItem('consent_v2') === '1')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email
  useEffect(() => {
    if (session && !isCollegeEmail(email)) {
      alert('Only @' + ALLOWED_DOMAIN + ' accounts are allowed.')
      supabase.auth.signOut()
    }
  }, [session])

  const login = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
      },
    })

  if (session === undefined)
    return <div className="wrap"><div className="card">Loading...</div></div>

  if (!session || !isCollegeEmail(email))
    return (
      <div className="wrap">
        <div className="hero">
          <p className="eyebrow">Class of 2027</p>
          <h1>Farewell Photos</h1>
          <p className="lead">
            Upload the photos you took. Find every photo you appear in, from every phone in the batch.
          </p>
        </div>
        <div className="card center">
          <p className="muted">Sign in with your @{ALLOWED_DOMAIN} Google account to continue.</p>
          <button onClick={login}>Sign in with college Google</button>
        </div>
        <BugButton page="login" />
      </div>
    )

  if (!consent)
    return (
      <div className="wrap">
        <div className="card">
          <h2>Before you continue</h2>
          <p>
            To find your photos, this site detects faces in uploaded photos and stores a numeric face
            signature (not a picture of your face). Your live selfie is never saved.
          </p>
          <p>
            Your name and college email are shown next to photos you upload, so people who download them
            can contact you for the original quality.
          </p>
          <p>Everything will be deleted after the event.</p>
          <button onClick={() => { localStorage.setItem('consent_v2', '1'); setConsent(true) }}>
            I agree
          </button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>No, sign out</button>
        </div>
        <BugButton email={email} page="consent" />
      </div>
    )

  return (
    <div className="wrap">
      <header>
        <h1>Farewell Photos</h1>
        <span className="muted">{email}</span>
        <button className="ghost light" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <nav>
        <button className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>Find my photos</button>
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Upload photos</button>
      </nav>
      {tab === 'find' ? <Find user={session.user} /> : <Upload user={session.user} />}
      <BugButton email={email} page={tab === 'find' ? 'find my photos' : 'upload photos'} />
    </div>
  )
}
