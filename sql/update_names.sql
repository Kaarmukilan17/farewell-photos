-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- Adds the uploader's name to each photo (used for credits and download file names).

alter table public.photos add column if not exists uploader_name text;

-- refresh the API so the new column is available straight away
notify pgrst, 'reload schema';
