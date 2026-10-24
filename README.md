# Farewell Photos (free, VIT-only)

Upload photos from any phone. Everyone takes a **live selfie** and gets only the photos they appear in.
New uploads show up automatically with a **NEW** badge since your last download.

Stack (all free): Vite + React, face-api (runs in each person's browser), Supabase (login, database, storage), Vercel (hosting).

## Setup (about 20 minutes)

### 1. Supabase
1. Create a free project at https://supabase.com (use the new Gmail).
2. SQL Editor -> New query -> paste `sql/setup.sql` -> Run.
3. Project Settings -> API: copy the **Project URL** and the **anon public key**.

### 2. Google login (college accounts only)
1. https://console.cloud.google.com -> new project -> APIs & Services -> OAuth consent screen
   -> User type **External** -> fill app name + your email -> Publish app (so any VIT account can log in).
2. Credentials -> Create credentials -> OAuth client ID -> **Web application**.
   Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
3. Copy the Client ID and Secret.
4. Supabase -> Authentication -> Providers -> Google -> enable, paste ID and Secret.
5. Supabase -> Authentication -> URL Configuration: set Site URL to your Vercel link (step 4)
   and add `http://localhost:5173` to Redirect URLs for testing.

### 3. Run locally
```
cp .env.example .env     # fill in the URL and anon key
npm install
npm run dev
```
Camera needs HTTPS, localhost counts as safe.

### 4. Deploy on Vercel
1. Push this folder to GitHub.
2. vercel.com -> Add New Project -> import the repo.
3. Add the 3 environment variables from `.env.example`.
4. Deploy, then put the live URL in Supabase Site URL (step 2.5).

## How limits work on the free tier
- Photos are shrunk on the phone to 1600px (~300-500 KB). Supabase gives **1 GB** storage, so about **2,000-3,000 photos**.
- Uploads go straight from each phone to Supabase storage. No middleman, so many people can upload at once.
- Supabase **pauses** projects idle for 7 days. Open the dashboard to resume.
- Need more space later? Switch storage to Cloudflare R2 (10 GB free) or upgrade Supabase.

## Privacy and security notes
- Only `@vitstudent.ac.in` Google accounts can log in, enforced in the database too (row-level security).
- The first live selfie is locked to your email. Later searches must match that face.
- Face matching happens in the browser, so a determined technical user could bypass the check.
  It stops casual misuse, not a deliberate attacker. Any college user can technically fetch any photo
  if they dig into the API, so treat this as "college-private", not "locked vault".
- Delete the Supabase project after the event.
