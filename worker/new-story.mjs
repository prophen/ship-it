#!/usr/bin/env node
// Ship It: the agent finds NEW stories, verifies them, drafts, queues.
//   node new-story.mjs [--count=3] [--schedule] [--start=08:00] [--end=20:00]
//   node new-story.mjs --topic="Port Chicago sailors" [--schedule]
//   node new-story.mjs --count=12 [--schedule]
// --count is stories; each story drafts one post per platform in --platforms
// (default: instagram,facebook). Her daily cadence: --count=12
// (12 stories mirrored to both platforms = 24 posts).
// --schedule spreads the drafts evenly across the day window (Pacific).
// --topic skips ideation and builds facts for your chosen topic instead;
// verification, drafting, and all other gates still run.
// Pipeline per story: dedupe -> ideate (OpenAI) -> verify (Exa, 2+ sources)
//           -> draft (OpenAI) -> Supabase publish_queue (status: draft).
// A story that fails verification is skipped; the batch continues.
// No unverified story ever reaches the queue.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('./.env', import.meta.url) });
import { supabase } from './lib/db.mjs';
import { exaSearch, distinctDomains } from './lib/exa.mjs';
import { upcomingSlots } from './lib/schedule.mjs';

const {
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  SANITY_PROJECT_ID = 'bq2hoxdt',
  SANITY_DATASET = 'production',
  SANITY_TYPE = 'story',
} = process.env;
for (const [k, v] of Object.entries({
  OPENAI_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  EXA_API_KEY: process.env.EXA_API_KEY,
})) {
  if (!v) { console.error(`Missing ${k} in worker/.env`); process.exit(1); }
}

async function openaiJson(system, user) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned nothing: ' + JSON.stringify(json).slice(0, 300));
  return JSON.parse(content);
}

// 1. Dedupe: what has she already covered?
// Prefers the local covered.json export (no API dependency at runtime);
// falls back to the live Sanity query if the file is missing.
async function existingStories() {
  try {
    const { readFileSync } = await import('node:fs');
    const titles = JSON.parse(readFileSync(new URL('./covered.json', import.meta.url), 'utf8'));
    if (Array.isArray(titles) && titles.length) {
      console.log(`dedupe: ${titles.length} existing stories loaded (local covered.json)`);
      return titles;
    }
  } catch { /* fall through to Sanity */ }
  const q = encodeURIComponent(`*[_type == "${SANITY_TYPE}"]{title}`);
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${q}`;
  const res = await fetch(url);
  const json = await res.json();
  const titles = (json.result || []).map((d) => d.title).filter(Boolean);
  console.log(`dedupe: ${titles.length} existing stories loaded (Sanity API fallback)`);
  return titles;
}

// 2. Ideate: one new, real story candidate the list does not contain.
async function ideate(alreadyCovered) {
  const system = `You research new stories for "California Black Stories": short, verified stories from Black history in California.
Propose ONE real person or event NOT on the already-covered list. Only propose stories you have reasonable confidence are real; a verification step runs next and kills anything it cannot corroborate.
Return JSON only: {"title": "...", "person": "...", "facts": ["4-6 specific facts with dates and places"], "why_it_matters": "..."}`;
  const idea = await openaiJson(system, 'Already covered (do not repeat):\n' + alreadyCovered.slice(0, 150).join('\n'));
  if (!idea.person || !Array.isArray(idea.facts) || !idea.facts.length) {
    throw new Error('Ideation returned an unusable candidate: ' + JSON.stringify(idea).slice(0, 300));
  }
  return idea;
}

// 2b. Topic-first: she chose the topic; OpenAI builds the fact set for it.
// Verification still runs next and kills anything it cannot corroborate.
async function factsFor(topic, alreadyCovered) {
  const system = `You research for "California Black Stories": short, verified stories from Black history in California.
The user chose this topic: "${topic}". Return JSON only: {"title": "...", "person": "...", "facts": ["4-6 specific facts with dates and places"], "why_it_matters": "..."}.
Only include facts you have reasonable confidence are real; a verification step runs next and kills anything it cannot corroborate.`;
  const idea = await openaiJson(system, 'Already covered (avoid overlap):\n' + alreadyCovered.slice(0, 150).join('\n'));
  if (!idea.person || !Array.isArray(idea.facts) || !idea.facts.length) {
    throw new Error('Could not build a fact set for the topic: ' + JSON.stringify(idea).slice(0, 200));
  }
  return idea;
}

// 3. Verify: Exa must corroborate with 2+ independent sources, or the run stops.
async function verify(idea) {
  const sources = await exaSearch(`${idea.person} California Black history`, 8);
  const domains = distinctDomains(sources);
  if (sources.length < 2 || domains.size < 2) {
    throw new Error(
      `Verification failed for "${idea.person}": only ${sources.length} result(s) across ${domains.size} domain(s). Run stopped, nothing queued.`
    );
  }
  return sources.slice(0, 5);
}

// 4. Draft: house caption spec (PROMPT_TEMPLATES.md #4) from the verified facts only.
async function draft(idea, sources) {
  const system = `You draft social posts for "California Black Stories".
Voice: direct and practical, warm, authoritative, proud. Natural, never marketing copy. Never use em-dashes; use commas, periods, or colons.
Accuracy first: use ONLY the verified facts below. Never invent dates, places, or quotes.
Caption rules:
- At least three paragraphs. Open with a concrete, scroll-stopping hook, never generic "hidden history" hype.
- Establish who, what, where, and the meaningful historical contribution.
- Connect the documented story to identity, community, or present relevance. No invented causation, no personal memories.
- Readable sentences, line breaks, a few appropriate emojis (use the 🏾 tone for human/hand emojis).
- End with a genuine engagement invitation.
- Include this disclosure line: Image generated with AI; not an archival photograph.
- No hashtags anywhere in the caption.
Hashtags: exactly five distinct relevant hashtags, no more, no fewer.
First comment: 1-2 sentences, warm fan-to-fan, one verified memorable detail, invite readers to tag a friend or share. No hashtags.
Return JSON only: {"instagram": {"caption": "...", "hashtags": ["#...", "#...", "#...", "#...", "#..."], "first_comment": "..."}, "facebook": {"caption": "...", "hashtags": ["#...", "#...", "#...", "#...", "#..."], "first_comment": "..."}}.`;
  const user = `Verified facts about ${idea.person} (${idea.title}):\n` +
    idea.facts.map((f) => '- ' + f).join('\n') +
    `\nWhy it matters: ${idea.why_it_matters}\nSources:\n` +
    sources.map((s) => `- ${s.title} (${s.url})`).join('\n');
  return openaiJson(system, user);
}

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) args[m[1]] = m[2];
  else if (a.startsWith('--')) args[a.slice(2)] = true; // bare flags like --schedule
}
const scheduling = args.schedule === true || args.schedule === 'true';
const covered = await existingStories();
let count = Math.max(1, parseInt(args.count ?? '1', 10) || 1);
const ALL_PLATFORMS = ['instagram', 'facebook'];
const platforms = (args.platforms
  ? String(args.platforms).split(',').map((s) => s.trim().toLowerCase())
  : ALL_PLATFORMS
).filter((p) => ALL_PLATFORMS.includes(p));
if (!platforms.length) {
  console.error('No valid platforms in --platforms. Choose from: ' + ALL_PLATFORMS.join(', '));
  process.exit(1);
}
if (args.topic) {
  if (count !== 1) console.log('--topic given: running one story');
  count = 1;
  const needle = String(args.topic).toLowerCase();
  const hit = covered.find((t) => {
    const n = t.toLowerCase();
    return n.includes(needle) || needle.includes(n);
  });
  if (hit) console.log(`heads up: already covered -> "${hit}"`);
}
const freshTitles = []; // intra-batch dedupe: don't repeat within one run
const draftIds = []; // ids in creation order, for slot assignment
let queued = 0;

for (let i = 0; i < count; i++) {
  console.log(`\n--- story ${i + 1}/${count} ---`);
  try {
    const idea = args.topic
      ? await factsFor(args.topic, [...covered, ...freshTitles])
      : await ideate([...covered, ...freshTitles]);
    console.log(`candidate: ${idea.person} — ${idea.title}`);
    const sources = await verify(idea);
    console.log(`verified: ${sources.length} sources across ${distinctDomains(sources).size} domains`);
    const drafts = await draft(idea, sources);
    for (const p of platforms) {
      const d = drafts[p];
      if (!d || typeof d.caption !== 'string' || !Array.isArray(d.hashtags) ||
          d.hashtags.length !== 5 || typeof d.first_comment !== 'string') {
        throw new Error(`draft for ${p} did not match the caption spec`);
      }
    }

    // 5. Queue (one row per platform in --platforms).
    const targets = platforms.filter((p) => drafts[p]);
    for (const platform of targets) {
      const d = drafts[platform];
      const { data: inserted, error: insertError } = await supabase
        .from('publish_queue')
        .insert({
          source_type: 'new_story',
          source_ref: idea.person,
          platform,
          copy: d.caption.trim() + '\n\n' + d.hashtags.join(' '),
          first_comment: d.first_comment,
          status: 'draft',
          sources,
        })
        .select('id, platform')
        .single();
      if (insertError) throw insertError;
      console.log(`  queued ${inserted.platform}: ${inserted.id}`);
      draftIds.push(inserted.id);
      queued++;
    }
    freshTitles.push(idea.title);
  } catch (e) {
    console.log(`  skipped: ${String(e?.message || e).slice(0, 200)}`);
  }
}

// 6. Schedule: spread drafts evenly across the day window (default 8am-8pm PT).
if (scheduling && draftIds.length) {
  const slots = upcomingSlots(draftIds.length, args.start || '08:00', args.end || '20:00');
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  for (let i = 0; i < draftIds.length; i++) {
    const { error: slotError } = await supabase
      .from('publish_queue')
      .update({ scheduled_for: slots[i].toISOString() })
      .eq('id', draftIds[i]);
    if (slotError) throw slotError;
  }
  console.log(`scheduled ${draftIds.length} drafts: ${fmt.format(slots[0])} -> ${fmt.format(slots[slots.length - 1])} PT`);
}
console.log(`\ndone: ${queued} drafts queued from ${freshTitles.length} ${freshTitles.length === 1 ? 'story' : 'stories'}. Approve them in the dashboard, then wake the agent.`);
