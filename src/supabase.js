import { createClient } from '@supabase/supabase-js'

export const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_DOMAIN || 'vitstudent.ac.in'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export const isCollegeEmail = (email) =>
  !!email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)
