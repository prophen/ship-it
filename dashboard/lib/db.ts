import { createClient } from '@supabase/supabase-js';

// Server-only client (service role). Never import this into client components.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
export const supabase = createClient(url, key);

export type QueueRow = {
  id: string;
  source_type: string;
  source_ref: string;
  platform: string;
  copy: string;
  first_comment: string | null;
  qa: { decision: string; reasons?: string[] } | null;
  image_url: string | null;
  sources: { title: string; url: string }[] | null;
  scheduled_for: string | null;
  status: string;
  receipt_id: string | null;
  receipt_url: string | null;
  error: string | null;
  created_at: string;
  published_at: string | null;
};
