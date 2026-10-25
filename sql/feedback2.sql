-- Run ONCE in Supabase: SQL Editor -> New query (clear the editor first) -> paste -> Run
-- Lets a person restore photos they marked as "Not me".

create policy "own feedback delete" on public.match_feedback for delete to authenticated
  using (public.is_college() and user_email = lower(auth.jwt() ->> 'email'));

notify pgrst, 'reload schema';
