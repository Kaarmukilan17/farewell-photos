-- Run ONCE in Supabase: SQL Editor -> New query (clear the editor first) -> paste -> Run

create table if not exists public.match_feedback (
  id bigserial primary key,
  user_email text not null,
  photo_id uuid not null references public.photos(id) on delete cascade,
  distance float8,
  created_at timestamptz not null default now(),
  unique (user_email, photo_id)
);

create table if not exists public.search_log (
  id bigserial primary key,
  user_email text not null,
  shown int not null,
  created_at timestamptz not null default now()
);

alter table public.match_feedback enable row level security;
alter table public.search_log enable row level security;

create policy "own feedback read" on public.match_feedback for select to authenticated
  using (public.is_college() and user_email = lower(auth.jwt() ->> 'email'));
create policy "own feedback insert" on public.match_feedback for insert to authenticated
  with check (public.is_college() and user_email = lower(auth.jwt() ->> 'email'));

create policy "own search insert" on public.search_log for insert to authenticated
  with check (public.is_college() and user_email = lower(auth.jwt() ->> 'email'));

notify pgrst, 'reload schema';
