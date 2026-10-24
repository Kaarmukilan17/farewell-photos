-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run
-- Change the domain below if needed.

create or replace function public.is_college() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@vitstudent.ac.in', false)
$$;

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  uploader text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.faces (
  id bigserial primary key,
  photo_id uuid not null references public.photos(id) on delete cascade,
  descriptor float8[] not null
);
create index if not exists faces_photo_idx on public.faces(photo_id);

create table if not exists public.profiles (
  email text primary key,
  descriptors jsonb not null,
  last_download timestamptz,
  created_at timestamptz not null default now()
);

alter table public.photos   enable row level security;
alter table public.faces    enable row level security;
alter table public.profiles enable row level security;

-- photos
create policy "college read photos"   on public.photos for select to authenticated using (public.is_college());
create policy "college insert photos" on public.photos for insert to authenticated
  with check (public.is_college() and uploader = lower(auth.jwt() ->> 'email'));
create policy "delete own photos"     on public.photos for delete to authenticated
  using (public.is_college() and uploader = lower(auth.jwt() ->> 'email'));

-- faces (needed by every user's browser to do the matching)
create policy "college read faces"   on public.faces for select to authenticated using (public.is_college());
create policy "college insert faces" on public.faces for insert to authenticated with check (public.is_college());

-- profiles: each person sees and edits only their own row
create policy "own profile read"   on public.profiles for select to authenticated
  using (public.is_college() and email = lower(auth.jwt() ->> 'email'));
create policy "own profile insert" on public.profiles for insert to authenticated
  with check (public.is_college() and email = lower(auth.jwt() ->> 'email'));
create policy "own profile update" on public.profiles for update to authenticated
  using (email = lower(auth.jwt() ->> 'email')) with check (email = lower(auth.jwt() ->> 'email'));

-- private storage bucket, 5 MB max per file, images only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "college read files"   on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_college());
create policy "college upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_college());
