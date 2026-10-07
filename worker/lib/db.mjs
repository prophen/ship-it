import dotenv from 'dotenv';
// Load first: ESM evaluates imports before the entry script's body runs,
// so dotenv.config() in new-story.mjs / poll-once.mjs would come too late.
dotenv.config({ path: new URL('../.env', import.meta.url) });
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client (service role). RLS is enabled on
// publish_queue with no public policies, so only this key can read/write.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in worker/.env');
  process.exit(1);
}
export const supabase = createClient(url, key);
