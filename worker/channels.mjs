#!/usr/bin/env node
// Buffer channel mapping.
//   node channels.mjs            -> list your organizations (copy the id)
//   node channels.mjs <org-id>   -> list channels: id, name, service
// Put the ids into BUFFER_CHANNELS in .env as {"x":"...","instagram":"...","facebook":"...","linkedin":"..."}.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('./.env', import.meta.url) });
import { listOrganizations, listChannels } from './publishers/buffer.mjs';

const token = process.env.BUFFER_ACCESS_TOKEN;
if (!token) { console.error('Set BUFFER_ACCESS_TOKEN in worker/.env'); process.exit(1); }

const [orgId] = process.argv.slice(2);
if (!orgId) {
  const orgs = await listOrganizations(token);
  console.log(JSON.stringify(orgs, null, 2));
  console.log('\nRe-run as: node channels.mjs <organization-id>');
} else {
  const chans = await listChannels(token, orgId);
  for (const c of chans) console.log(`${c.service}\t${c.id}\t${c.displayName || c.name}`);
}
