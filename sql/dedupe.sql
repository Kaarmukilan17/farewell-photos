-- Run ONCE in Supabase: SQL Editor -> New query (clear the editor first) -> paste -> Run
-- Lets the site skip photos a login has already uploaded.

alter table public.photos add column if not exists file_hash text;

create unique index if not exists photos_uploader_hash_idx
  on public.photos (uploader, file_hash)
  where file_hash is not null;

notify pgrst, 'reload schema';
