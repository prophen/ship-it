#!/usr/bin/env node
// Runs ON the Agent37 instance. Publishes every approved row via Buffer,
// writes receipts back to Supabase. Safe to run repeatedly; exits quietly
// when there is nothing approved (the agent goes back to sleep).
import dotenv from 'dotenv';
dotenv.config({ path: new URL('./.env', import.meta.url) });
import { supabase } from './lib/db.mjs';
import { createBufferPost } from './publishers/buffer.mjs';

const { BUFFER_ACCESS_TOKEN, BUFFER_CHANNELS, BUFFER_SHARE_MODE = 'shareNow' } = process.env;
if (!BUFFER_ACCESS_TOKEN || !BUFFER_CHANNELS) {
  console.error('Missing BUFFER_ACCESS_TOKEN / BUFFER_CHANNELS in worker/.env');
  process.exit(1);
}
const channels = JSON.parse(BUFFER_CHANNELS);

const { data: rows, error } = await supabase
  .from('publish_queue')
  .select('*')
  .eq('status', 'approved')
  .order('created_at', { ascending: true })
  .limit(10);
if (error) throw error;
if (!rows.length) {
  console.log('nothing approved. agent going back to sleep.');
  process.exit(0);
}

for (const row of rows) {
  const channelId = channels[row.platform];
  if (!channelId) {
    const msg = `no Buffer channel mapped for platform "${row.platform}"`;
    await supabase.from('publish_queue').update({ status: 'failed', error: msg }).eq('id', row.id);
    console.log(`  skip ${row.id}: ${msg}`);
    continue;
  }
  console.log(`publishing ${row.platform} (${row.id})...`);
  await supabase.from('publish_queue').update({ status: 'publishing' }).eq('id', row.id);
  try {
    const res = await createBufferPost({
      text: row.copy,
      imageUrl: row.image_url,
      channelId,
      token: BUFFER_ACCESS_TOKEN,
      mode: BUFFER_SHARE_MODE,
      dueAt: row.scheduled_for,
    });
    // A slotted row becomes 'scheduled' (Buffer owns the timing now);
    // an unslotted row goes out immediately as 'published'.
    const finalStatus = row.scheduled_for ? 'scheduled' : 'published';
    const { error: updateError } = await supabase
      .from('publish_queue')
      .update({
        status: finalStatus,
        receipt_id: res.id,
        published_at: row.scheduled_for ? null : new Date().toISOString(),
        error: null,
      })
      .eq('id', row.id);
    if (updateError) throw updateError;
    console.log(`  ${finalStatus}, buffer id ${res.id}` + (row.scheduled_for ? ` due ${row.scheduled_for}` : ''));
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    await supabase.from('publish_queue').update({ status: 'failed', error: msg }).eq('id', row.id);
    console.log(`  failed: ${msg}`);
  }
}
