# Ship It

An agent that finds a story worth telling, verifies it, drafts it, and publishes it, with your approval in the middle.

Built for the "Build an Agent" hackathon, Oct 7 2026. The gap it closes: every previous version of this workflow started from stories she already had and stopped before the scary part. This one starts from nothing, finds something new, and goes all the way to published, with receipts.

## Vocabulary

- **Story**: one historical subject (a person or event). The unit of research: title, facts, sources.
- **Post**: one published unit on one platform. One story becomes one post per platform in `--platforms`.
- So `--count=12 --platforms=instagram,facebook` = 12 stories, 24 posts (her daily cadence: the same 12 stories to both platforms).

## The flow, end to end

1. **Dedupe**: `worker/new-story.mjs` reads `worker/covered.json`, a local export of 296 story titles (150 from Sanity + 146 from her Hermes scheduler), so the agent never repeats one (falls back to the live Sanity API if the file is missing). Sanity is her data, not a sponsor.
2. **Ideate (OpenAI)**: given the already-covered list, OpenAI proposes one new, real person or event from Black California history, with key facts.
3. **Verify (Exa)**: her own Exa key searches the candidate. It needs 2+ results across 2+ independent domains or the run stops cold. No unverified story ever reaches the queue. This is the accuracy gate, and it is very CBS.
4. **Draft (OpenAI)**: one post per platform (Instagram, Facebook), written from the verified facts only, in her voice: direct, natural, no em-dashes, no marketing copy. `--count` is stories, not posts. Her daily cadence is `--count=12`: 12 stories mirrored to both platforms, 24 posts.
5. **Visual (OpenAI, build-window slice)**: see "Build slice: visual pipeline" below. Native OpenAI image generation is the established CBS workflow (per the scheduler agent's export, do not substitute another provider). The worker generates the image, then runs likeness QA through OpenAI vision against an inspected reference, following `vendor/cbs-workflow/LIKENESS_QA.md`. Monid's job shifts to reference-portrait discovery (image search from its catalog). Final images live on Supabase Storage for public URLs.
6. **Queue (Supabase)**: rows in `publish_queue`, status `draft`, with the verification sources attached as JSON. With `--schedule`, each draft also gets a `scheduled_for` slot spread across 8am–8pm PT.
7. **Approve (dashboard)**: she reads the drafts and their sources, taps **Approve all** (or rejects duds individually). Nothing moves without this.
8. **Wake (Agent37)**: the dashboard fires `POST /v1/instances/{id}/exec`. The agent was asleep on its own cloud computer; the tap wakes it and runs `poll-once.mjs`.
9. **Publish (Buffer)**: her Hermes token posts each approved draft to its mapped channel via Buffer's GraphQL API. The legacy REST v1 path is deprecated and rejects new API keys, so `publishers/buffer.mjs` was rewritten against `POST https://api.buffer.com` before the window. Slotted rows use `mode: customScheduled` + `dueAt` (Buffer owns the timing, row becomes `scheduled`); unslotted rows follow `BUFFER_SHARE_MODE` (`shareNow` posts immediately, `addToQueue` follows the channel queue).
10. **Receipt (Supabase)**: the row flips to `scheduled` or `published` with the Buffer id and timestamp. The paper trail.

## What each sponsor does

- **Agent37** (required): the agent's computer. The worker lives on the instance, sleeps between runs, wakes on exec. This is the "agent" story for the judges: not a script on her laptop, a persistent agent with its own machine.
- **OpenAI**: the brains and the eyes. Ideation, drafting, image generation, and vision-based likeness QA.
- **Monid**: likeness reference discovery (image search from its catalog) for the visual QA step. Fills the gap she has no key for.
- **Supabase**: the queue and the receipts, RLS-locked to the service role. Also a sponsor, which is exactly why it's back: Agent37, OpenAI, Supabase, and Monid on the submission.
- **Her own stack, not sponsors**: Sanity (dedupe), Exa (verification), Buffer (publishing).

## Build slice: visual pipeline (OpenAI)

Source of truth: `vendor/cbs-workflow/` (her scheduler agent's export). Not implemented yet on purpose; this is the 2:50–3:20 slice.

1. **Caption spec**: update the draft prompt in `worker/new-story.mjs` to the house style from `PROMPT_TEMPLATES.md` #4: at least three paragraphs, exactly five unique hashtags in their own section, a separate hashtag-free first comment, and the disclosure line "Image generated with AI; not an archival photograph."
2. **`worker/visual.mjs`** (new): for each queued story, build the image prompt from the verified facts + inspected likeness cues (`PROMPT_TEMPLATES.md` #3, ending exactly "Optimized for 1080x1350 format."), then call `POST https://api.openai.com/v1/images/generations` with `model: gpt-image-1`, `size: 1024x1536`. Save the bytes locally, record dimensions.
3. **Reference discovery**: find a credible likeness reference (institutional collection or historical record) with attribution URL. Monid image search is the sponsor-friendly path: `monid discover -q "historical portrait image search"`. For the demo, pre-picking 1–2 references is fine.
4. **Likeness QA**: send the reference + generated image to a vision-capable OpenAI model with the `LIKENESS_QA.md` rubric; expect back pass / revise / unresolved with reasons. Never a numeric score. Store the record in the row's `qa` column.
5. **Hosting**: upload the final 1080x1350 to Supabase Storage (public bucket), set `image_url` on the rows.
6. **Gating**: revise/unresolved means the image does not queue; the copy still can, flagged. Her dashboard approval stays the final gate regardless.

## 2-hour build plan (2:30 - 4:40 PM PDT)

| Time | Slice |
|---|---|
| 2:30 - 2:50 | Supabase: new project (or reuse an existing one), run `supabase/schema.sql` in the SQL editor, copy the URL + service role key. Agent37: create one instance in the dashboard, copy the ID. Fill `worker/.env` and `dashboard/.env`. `npm i` in both dirs. |
| 2:50 - 3:20 | `node worker/new-story.mjs --count=3 --schedule`. Confirm verified candidates land drafts in the queue with day slots (a failed verification skips that story, the batch continues). Then the visual slice above: OpenAI image gen + vision likeness QA per story, Supabase Storage for URLs. |
| 3:20 - 3:50 | Dashboard approve/reject working. `node worker/agent37.mjs push-code` + `push-env`, then approve one row and hit **Wake agent**. Verify the Buffer post lands; map platform to channel id first via `node worker/channels.mjs`. If nothing is approved yet, `worker/fallback-candidates.md` has two pre-verified stories you can feed straight into verify + draft. |
| 3:50 - 4:10 | Full-loop rehearsal on camera: new story found, verified, approved, published. |
| 4:10 - 4:40 | Record the demo video, submit the form. |

## Pre-2:30 checklist (hers, about 20 min)

- [ ] Register on the Luma page, save the Zoom link.
- [ ] agent37.com: API key (Cloud -> API keys), fund the wallet (Cloud -> Billing), create one instance, copy the ID.
- [ ] app.monid.ai: API key (image step only).
- [ ] Buffer: `node worker/channels.mjs` for the org id, then `node worker/channels.mjs <org-id>` to list channels, note the channel IDs into `BUFFER_CHANNELS`.
- [ ] Supabase: create the project (or reuse one), run `supabase/schema.sql`, copy the URL + service role key.
- [ ] `covered.json` is already exported (all 150 titles); add any stories you published outside Sanity as extra lines if you want them deduped too.

## Pushing code to the instance

```bash
cd worker
node agent37.mjs status              # instance is up
node agent37.mjs push-code            # git clone/pull ~/ship-it on the instance
node agent37.mjs exec "cd ~/ship-it/worker && npm i --no-audit --no-fund"
node agent37.mjs push-env            # writes worker/.env onto the instance
# rotate the secrets after the hackathon; they travel in exec calls
```

## Demo script (about 2 min)

1. **The problem** (15s): "I have built this pipeline three times. Every version started from stories I already had and stopped before publishing."
2. **The agent works** (30s): show the autonomous run live. The agent proposes new topics against 296 covered titles, verifies each with Exa, drafts both platforms. If a verification fails and the run kills that story, show it, that's the judgment beat. The `--topic` path is the fallback if ideation stalls in the window.
3. **Approve + wake** (25s): scan the drafts and their sources in the dashboard, tap **Approve all**, tap Wake agent. The agent was asleep on Agent37.
4. **Published** (30s): refresh the live profile, the post is there. Supabase row flips to `scheduled` or `published` with receipt id and timestamp.
5. **The sell** (15s): "Every creator has a drafts folder and a research backlog. This is research in, published posts out, with your approval in the middle."

## Submission checklist

Google form by 4:40 PM: team members, the workflow replaced, demo video link (YouTube unlisted), sponsor integrations (Agent37, OpenAI, Supabase, Monid), repo link, live dashboard link. Up to 5 files, 10 MB each. Judges must open links without requesting access.
