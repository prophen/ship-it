// Exa search wrapper. Uses her own Exa key directly (not Monid),
// per Monid's precedence rule: Monid fills gaps, it does not replace her keys.
const API = 'https://api.exa.ai';

export async function exaSearch(query, numResults = 8) {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('Missing EXA_API_KEY in worker/.env');
  const res = await fetch(`${API}/search`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, numResults }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`exa failed: ${JSON.stringify(json).slice(0, 200)}`);
  return (json.results || []).map((r) => ({ title: r.title, url: r.url }));
}

export function distinctDomains(sources) {
  return new Set(
    sources.map((s) => {
      try {
        return new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        return s.url;
      }
    })
  );
}
