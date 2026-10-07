#!/usr/bin/env node
// Tiny Agent37 control-plane helper.
//   node agent37.mjs status            -> show instance status
//   node agent37.mjs exec "<cmd>"       -> run a shell command on the instance
//   node agent37.mjs push-code         -> git clone/pull ~/ship-it on the instance
//   node agent37.mjs push-env          -> write worker/.env onto the instance
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
dotenv.config({ path: new URL('./.env', import.meta.url) });

const KEY = process.env.AGENT37_API_KEY;
const ID = process.env.AGENT37_INSTANCE_ID;
const API = 'https://api.agent37.com/v1';
if (!KEY || !ID) {
  console.error('Set AGENT37_API_KEY and AGENT37_INSTANCE_ID in worker/.env');
  process.exit(1);
}

async function call(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

async function execCmd(command) {
  const { http, json } = await call(`/instances/${ID}/exec`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
  console.log(`http=${http} exit=${json.exit_code}`);
  if (json.stdout) console.log('--- stdout ---\n' + String(json.stdout).slice(0, 4000));
  if (json.stderr) console.log('--- stderr ---\n' + String(json.stderr).slice(0, 2000));
  if (json.exit_code !== 0) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'status') {
  const { http, json } = await call(`/instances/${ID}`);
  console.log(`http=${http}`, JSON.stringify({ id: json.id, status: json.status }, null, 2));
} else if (cmd === 'exec') {
  if (!rest.length) { console.error('usage: node agent37.mjs exec "<cmd>"'); process.exit(1); }
  await execCmd(rest.join(' '));
} else if (cmd === 'push-env') {
  const raw = readFileSync(new URL('./.env', import.meta.url), 'utf8');
  const b64 = Buffer.from(raw, 'utf8').toString('base64');
  await execCmd(
    `mkdir -p ~/ship-it/worker && echo ${b64} | base64 -d > ~/ship-it/worker/.env && chmod 600 ~/ship-it/worker/.env && echo env-written`
  );
} else if (cmd === 'push-code') {
  const repo = process.env.GITHUB_REPO || 'https://github.com/prophen/ship-it';
  await execCmd(
    `if [ -d ~/ship-it/.git ]; then cd ~/ship-it && git pull --ff-only; else git clone ${repo} ~/ship-it; fi`
  );
} else {
  console.log('usage: node agent37.mjs status | exec "<cmd>" | push-env | push-code');
}
