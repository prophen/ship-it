#!/usr/bin/env node
// Visual pipeline: image prompt -> likeness reference -> generate -> vision QA -> Storage.
// The agent does every step; the human approval gate stays in the dashboard.
//
//   node visual.mjs                            -> all draft stories missing images
//   node visual.mjs --source-ref="Name"        -> one story
//   node visual.mjs --reference-url="https://" -> explicit likeness reference
//
// Reference discovery order: --reference-url flag, REFERENCE_URL env, then
// Monid (MONID_API_KEY) best-effort via its CLI. No reference -> QA is
// recorded "unresolved" and the image is held, never shipped on a guess.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('./.env', import.meta.url) });
import { supabase } from './lib/db.mjs';

const {
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  VISION_MODEL = OPENAI_MODEL,
  IMAGE_MODEL = 'gpt-image-1',
  MONID_API_KEY,
  REFERENCE_URL,
} = process.env;
if (!OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY in worker/.env'); process.exit(1); }

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) args[m[1]] = m[2]; else args[a.replace(/^--/, '')] = true;
}

const BUCKET = 'cbs-visuals';

async function openaiChatJson({ model, system, content }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content },
      ],
    }),
  });
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned nothing: ' + JSON.stringify(json).slice(0, 300));
  return JSON.parse(text);
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ShipIt/1.0' } });
  if (!res.ok) throw new Error(`reference fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('reference fetch returned empty body');
  return buf;
}

// Monid reference discovery (best effort). Returns {url, source} or null.
async function tryMonidDiscovery(person) {
  if (!MONID_API_KEY) return null;
  try {
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise((resolve, reject) => {
      execFile('monid', ['discover', '-q', `${person} portrait`, '--json'],
        { timeout: 30000 }, (err, out) => (err ? reject(err) : resolve(out)));
    });
    const urls = [...String(stdout).matchAll(/https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)/gi)].map((m) => m[0]);
    if (urls.length) {
      console.log('  reference: Monid discovery');
      return { url: urls[0], source: 'monid' };
    }
  } catch (e) {
    console.log('  monid discovery unavailable (' + String(e?.message || e).slice(0, 100) + ')');
  }
  return null;
}

async function resolveReference(person) {
  if (args['reference-url']) return { url: args['reference-url'], source: 'manual' };
  if (REFERENCE_URL) return { url: REFERENCE_URL, source: 'manual' };
  return tryMonidDiscovery(person);
}

// Build the image prompt from verified facts + inspected likeness cues
// (PROMPT_TEMPLATES.md #3). Nothing enters the prompt that is not verified.
async function buildImagePrompt(person, facts, refB64) {
  const factList = facts.map((f) => '- ' + f).join('\n');
  const text = `You write image-generation prompts for "California Black Stories" about ${person}.
${refB64 ? 'First inspect the attached reference portrait and note concrete, observable likeness cues (approximate age, facial structure, hair, distinctive features). A black-and-white reference does not establish skin shade; lighting and age change apparent features. Do not inherit pose, attire, background, or photo damage from the reference.' : 'No reference portrait was available; derive likeness only from the verified facts and keep the description historically restrained.'}
Then write the prompt using ONLY the verified facts below for every scene detail (clothing, objects, setting, action, era). Never invent.
Verified facts:\n${factList}
Template: "Photorealistic cinematic depiction of [NAME], [AGE/PERIOD AND VERIFIED LIKENESS CUES], actively [ACTION] in [PLACE AND YEAR/PERIOD]; [RESEARCH-SUPPORTED CLOTHING, OBJECTS, ENVIRONMENT AND SECONDARY FIGURES], framed [SHOT SIZE/ANGLE/COMPOSITION] with [LIGHTING AND TEXTURE], preserving clear facial structure and the story's key gesture with safe portrait-crop margins; [SCENE-SPECIFIC EXCLUSIONS/PRESERVATION CONSTRAINTS]. Optimized for 1080x1350 format."
The prompt MUST end exactly with: Optimized for 1080x1350 format.
Return JSON: {"likeness_cues": "...", "image_prompt": "..."}.`;
  const content = refB64
    ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${refB64.toString('base64')}` } }]
    : text;
  const out = await openaiChatJson({ model: VISION_MODEL, content });
  if (!out.image_prompt || !out.image_prompt.endsWith('Optimized for 1080x1350 format.')) {
    throw new Error('image prompt did not match the required template');
  }
  return out;
}

async function generateImage(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: '1024x1536' }),
  });
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('image generation failed: ' + JSON.stringify(json).slice(0, 300));
  return Buffer.from(b64, 'base64');
}

// Vision QA against LIKENESS_QA.md: pass | revise | unresolved, never a score.
async function likenessQA(person, refB64, genBytes) {
  const text = `You are reviewing a generated historical portrait of ${person} against the attached credible reference.
This is an editorial comparison, NOT face recognition, biometric identification, or proof of what an event looked like. There is no percentage score. If an image cannot be read, say so.
Compare:
A. Identity resemblance: facial proportions, jaw/chin, cheeks, brow/eyes, nose, mouth, hairline/hair, facial hair, age cues, distinctive features. State what matches and what drifts. Do not accept a generic period-appropriate face as the named subject.
B. Era and action: do attire, setting, and gesture plausibly fit the person's era and story? Is the subject doing something meaningful that communicates their actual story?
C. Anatomy and artifacts: hands, fingers, eyes, teeth, limb joins, duplicate faces, impossible objects, faux writing, contemporary objects, inconsistent lighting.
D. Framing: 1080x1350 portrait; the principal face and key gesture must be clear.
Decide: "pass" (no material issue), "revise" (state concrete defects and what to change), or "unresolved" (inadequate reference, unreadable asset, or uncertain likeness; hold rather than invent certainty).
Return JSON: {"decision": "pass|revise|unresolved", "identity": "...", "era_action": "...", "anatomy": "...", "framing": "...", "reasons": ["..."]}.`;
  const out = await openaiChatJson({
    model: VISION_MODEL,
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${refB64.toString('base64')}` } },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${genBytes.toString('base64')}` } },
    ],
  });
  if (!['pass', 'revise', 'unresolved'].includes(out.decision)) {
    throw new Error('QA returned no usable decision: ' + JSON.stringify(out).slice(0, 200));
  }
  return out;
}

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) throw error;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function runStory(person) {
  console.log(`\n--- visual: ${person} ---`);
  const { data: rows, error } = await supabase
    .from('publish_queue')
    .select('id, facts, sources')
    .eq('source_ref', person)
    .eq('status', 'draft')
    .is('image_url', null)
    .limit(1);
  if (error) throw error;
  const row = rows?.[0];
  if (!row) { console.log('  nothing to do'); return; }
  if (!Array.isArray(row.facts) || !row.facts.length) {
    console.log('  skipped: no verified facts stored; re-run new-story.mjs first');
    return;
  }

  // 1. Reference.
  const ref = await resolveReference(person);
  let refB64 = null;
  if (ref?.url) {
    try {
      refB64 = await downloadImage(ref.url);
      console.log(`  reference: ${ref.source} (${ref.url.slice(0, 80)})`);
    } catch (e) {
      console.log('  reference fetch failed (' + String(e?.message || e).slice(0, 100) + '); QA will be unresolved');
    }
  } else {
    console.log('  no reference found; QA will be unresolved');
  }

  // 2. Image prompt from verified facts + inspected likeness.
  const { image_prompt, likeness_cues } = await buildImagePrompt(person, row.facts, refB64);
  console.log('  prompt built (' + image_prompt.length + ' chars)');

  // 3. Generate (paid; running this script is the approval).
  const genBytes = await generateImage(image_prompt);
  console.log(`  generated ${(genBytes.length / 1024).toFixed(0)} KB`);

  // 4. Vision QA.
  const qa = refB64
    ? await likenessQA(person, refB64, genBytes)
    : { decision: 'unresolved', reasons: ['no likeness reference available; holding for human review'] };
  console.log(`  QA: ${qa.decision}`);

  const qaRecord = {
    decision: qa.decision,
    reasons: qa.reasons || [],
    identity: qa.identity || null,
    era_action: qa.era_action || null,
    anatomy: qa.anatomy || null,
    framing: qa.framing || null,
    reference_url: ref?.url || null,
    reference_source: ref?.source || 'none',
    likeness_cues: likeness_cues || null,
    image_prompt,
    image_model: IMAGE_MODEL,
    vision_model: VISION_MODEL,
    created_at: new Date().toISOString(),
  };
  const { error: qaError } = await supabase
    .from('publish_queue')
    .update({ qa: qaRecord })
    .eq('source_ref', person)
    .eq('status', 'draft');
  if (qaError) throw qaError;

  // 5. Pass -> host on Supabase Storage and attach. Anything else holds.
  if (qa.decision === 'pass') {
    await ensureBucket();
    const path = `${slug(person)}-${Date.now()}.png`;
    const { error: upError } = await supabase.storage.from(BUCKET).upload(path, genBytes, {
      contentType: 'image/png',
      upsert: true,
    });
    if (upError) throw upError;
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { error: imgError } = await supabase
      .from('publish_queue')
      .update({ image_url: urlData.publicUrl })
      .eq('source_ref', person)
      .eq('status', 'draft');
    if (imgError) throw imgError;
    console.log('  image attached: ' + urlData.publicUrl.slice(0, 80));
  } else {
    console.log(`  image held (${qa.decision}); copy can still queue, flagged for review`);
  }
}

let stories;
if (args['source-ref']) {
  stories = [args['source-ref']];
} else {
  const { data, error } = await supabase
    .from('publish_queue')
    .select('source_ref')
    .eq('status', 'draft')
    .is('image_url', null);
  if (error) throw error;
  stories = [...new Set((data || []).map((r) => r.source_ref).filter(Boolean))];
}
if (!stories.length) { console.log('no draft stories missing images'); process.exit(0); }
console.log(`visual pipeline: ${stories.length} storie(s)`);
for (const person of stories) {
  try {
    await runStory(person);
  } catch (e) {
    console.log(`  failed: ${String(e?.message || e).slice(0, 200)}`);
  }
}
console.log('\ndone');
