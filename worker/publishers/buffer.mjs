// Buffer GraphQL wrapper. Docs: https://developers.buffer.com
// Single endpoint, Bearer auth. The legacy REST v1 path (api.bufferapp.com/1)
// is deprecated and rejects new API keys, so this uses GraphQL throughout.
const API = 'https://api.buffer.com';

async function gql(token, query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({}));
  if (Array.isArray(json.errors) && json.errors.length) {
    const e = json.errors[0];
    throw new Error(`buffer api error (${e.extensions?.code || 'unknown'}): ${e.message}`);
  }
  if (!json.data) throw new Error(`buffer: no data in response: ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

export async function listOrganizations(token) {
  const data = await gql(token, `query { account { organizations { id name } } }`);
  return data.account.organizations;
}

export async function listChannels(token, organizationId) {
  const data = await gql(
    token,
    `query { channels(input: { organizationId: ${JSON.stringify(organizationId)} }) { id name displayName service } }`
  );
  return data.channels;
}

// mode: "shareNow" posts immediately (demo-friendly). If Buffer rejects the
// enum, its error names the valid values; fall back to "addToQueue".
// dueAt: ISO timestamp for a specific slot. Uses mode "customScheduled".
// (The field is dueAt, not scheduledAt, which does not exist on the API.)
// Buffer requires a per-network post type in `metadata` (e.g. "Facebook posts
// require a type"). Text-only Facebook post -> type: post.
const METADATA_BY_PLATFORM = {
  facebook: ', metadata: { facebook: { type: post } }',
  instagram: ', metadata: { instagram: { type: post, shouldShareToFeed: true } }',
};

export async function createBufferPost({ text, imageUrl, channelId, token, mode = 'shareNow', dueAt, platform }) {
  const assets = imageUrl ? `, assets: [{ image: { url: ${JSON.stringify(imageUrl)} } }]` : '';
  const metadata = (platform && METADATA_BY_PLATFORM[platform]) || '';
  const scheduling = dueAt
    ? `mode: customScheduled, dueAt: ${JSON.stringify(new Date(dueAt).toISOString())}`
    : `mode: ${mode}`;
  const data = await gql(
    token,
    `mutation CreatePost {
      createPost(input: {
        text: ${JSON.stringify(text)},
        channelId: ${JSON.stringify(channelId)},
        schedulingType: automatic,
        ${scheduling}${assets}${metadata}
      }) {
        ... on PostActionSuccess { post { id status } }
        ... on MutationError { message }
      }
    }`
  );
  const result = data.createPost;
  if (result.post) return { id: result.post.id, status: result.post.status, raw: result };
  throw new Error(`buffer failed: ${result.message || 'unknown error'}`);
}
