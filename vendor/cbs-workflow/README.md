# California Black Stories — Agent37 starter export

## Start here
1. Paste AGENT_INSTRUCTIONS.md into the new agent's instruction/system field, or use it as the canonical instruction document if that platform supports file-based instructions.
2. Add PROMPT_TEMPLATES.md and LIKENESS_QA.md to its knowledge/files if supported. These are plain Markdown and can also be pasted into prompts.
3. Use package.template.json as an internal review-record starting point, NOT as an Agent37 configuration file or a social/dashboard API payload.
4. Configure capabilities separately: web research and page extraction, actual image vision, image generation, private artifact storage, persistent structured records, and optional audio/video production. Social publishing is optional and must remain approval-gated.
5. Import the actual concept history and pending reservations before selecting the next prompt number. This export intentionally does not contain the historical ledger, reference portraits, historical packages or old approvals. The new agent must not claim it checked the 200-prompt window without that history.
6. Run a draft-only test: one sourced concept, reference inspection, image prompt, caption, five hashtags, first comment, and unresolved QA until an actual generated asset has been viewed. No posting or spending implied.

## Included
- AGENT_INSTRUCTIONS.md — editorial identity, rotation, research, image/banner/video rules, approval boundaries and output requirements.
- PROMPT_TEMPLATES.md — reusable research, reference inspection, image prompting, caption drafting, copy review, visual QA, motion and review-request prompts.
- LIKENESS_QA.md — the concrete visual comparison rubric and review-record template.
- package.template.json — deliberately incomplete, provider-neutral draft record.
- README.md — setup and portability limits.

## How the workflow works in practice
Research determines what we can claim and what action we can depict. Reference inspection supplies observed facial cues. The image prompt combines those cues with era, action, setting, composition and exclusions. Caption drafting uses the same verified claim set, not a story inferred from the generated image. Visual QA then checks the actual result against the reference, historical context and final crop. Failed outputs are revised under the authorized production scope and re-reviewed.

A text-only agent cannot honestly perform likeness inspection. A prompt that says 'accurate likeness' is not a likeness check. No automated numeric likeness score is used here.

## Important portability limits
This is a curated, platform-neutral export of the working California Black Stories playbook, not an Agent37-native installer, a verbatim dump of private conversations, a trained model, or a transfer of tools. Agent37-specific fields, uploads, tool availability and compatibility have not been tested. The templates are newly organized expressions of the established workflow, not claims about exact historical prompts.

No credentials, cookies, private voice IDs, original local machine paths, historical authorization evidence or publishing tokens are included. Existing integrations and paid-provider entitlements do not transfer. Configure services and commercial-use permissions independently. Production lessons are preserved; host-specific troubleshooting scripts and old operational incidents are omitted.

The existing source skill contains some older provider wording. This portable document resolves it in favor of the explicit selected video mode, scoped production authorization and final external-action approval boundary. Tool availability never constitutes permission to spend or publish.

## Record guidance
Populate factCheck with individual claims, source URLs, supporting excerpts and any uncertainty. Populate likenessReferences with attribution URL, inspected visible cues and era caveats. Populate assets with relative path, role, decoded dimensions, hash, source/version lineage and review state. Record exact approval text/message provenance only when new applicable approval exists; never copy old approval into a new agent. Keep provider receipts separate from local draft status.

For final validation, check paragraph count, exactly five unique hashtags in the final outgoing payload, a hashtag-free first comment, the required AI disclosure, image-prompt suffix, exact prompt-number set, actual image dimensions, actual file readability and final visual inspection. Code can validate structural fields; it cannot establish historical truth, commercial rights or likeness by itself.
