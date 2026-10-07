import { supabase, QueueRow } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

const fmtPT = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

async function setStatus(id: string, status: string) {
  'use server';
  await supabase.from('publish_queue').update({ status, error: null }).eq('id', id);
  revalidatePath('/');
}

// Batch approval: everything still in draft goes to approved in one tap.
// Failed rows are left alone; they need individual attention via Re-queue.
async function approveAll() {
  'use server';
  await supabase.from('publish_queue').update({ status: 'approved', error: null }).eq('status', 'draft');
  revalidatePath('/');
}

// Wakes the Agent37 instance via exec. A sleeping instance wakes first
// (adds ~10s), then poll-once.mjs publishes everything approved.
async function wakeAgent() {
  'use server';
  const res = await fetch(
    `https://api.agent37.com/v1/instances/${process.env.AGENT37_INSTANCE_ID}/exec`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AGENT37_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'cd ~/ship-it/worker && node poll-once.mjs' }),
    }
  );
  const json = await res.json().catch(() => ({}));
  console.log('wake result:', json.exit_code, String(json.stdout || '').slice(0, 400));
  revalidatePath('/');
}

function Sources({ row }: { row: QueueRow }) {
  const sources = row.sources || [];
  if (!sources.length) return null;
  return (
    <div className="meta">
      Verified against: {sources.map((s, i) => (
        <span key={i}>
          <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
          {i < sources.length - 1 ? ', ' : ''}
        </span>
      ))}
    </div>
  );
}

function Card({ row }: { row: QueueRow }) {
  return (
    <div className="card">
      <span className={`badge ${row.platform}`}>{row.platform}</span>
      <p className="copy">{row.copy}</p>
      {row.first_comment && (
        <p className="first-comment">
          <strong>First comment:</strong> {row.first_comment}
        </p>
      )}
      {row.image_url && <img className="preview" src={row.image_url} alt="post visual" />}
      <div className="meta">
        new story: {row.source_ref} &middot; {row.status}
        {row.published_at && ` &middot; ${fmtPT(row.published_at)}`}
        {row.scheduled_for && ` · goes out ${fmtPT(row.scheduled_for)} PT`}
      </div>
      <Sources row={row} />
      {row.error && <div className="error">{row.error}</div>}
      {row.status === 'published' && row.receipt_id && (
        <div className="receipt">Published, Buffer id {row.receipt_id}</div>
      )}
      <div className="row">
        {(row.status === 'draft' || row.status === 'failed') && (
          <form action={setStatus.bind(null, row.id, 'approved')}>
            <button className="primary" type="submit">Approve</button>
          </form>
        )}
        {row.status === 'draft' && (
          <form action={setStatus.bind(null, row.id, 'rejected')}>
            <button className="warn" type="submit">Reject</button>
          </form>
        )}
        {row.status === 'failed' && (
          <form action={setStatus.bind(null, row.id, 'approved')}>
            <button type="submit">Re-queue</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default async function Home() {
  const { data } = await supabase
    .from('publish_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  const rows: QueueRow[] = data || [];
  const needsApproval = rows.filter((r) => ['draft', 'failed'].includes(r.status));
  const queued = rows.filter((r) => ['approved', 'publishing'].includes(r.status));
  const scheduled = rows.filter((r) => r.status === 'scheduled');
  const published = rows.filter((r) => r.status === 'published');

  return (
    <main>
      <h1>Ship It</h1>
      <p className="sub">Nothing publishes without your tap. Approve below, then wake the agent.</p>

      <h2>Needs approval ({needsApproval.length})</h2>
      {needsApproval.length > 0 && (
        <form action={approveAll} style={{ marginBottom: '12px' }}>
          <button className="primary" type="submit">
            Approve all ({needsApproval.length})
          </button>
        </form>
      )}
      {needsApproval.length === 0 && <div className="empty">Queue is clear.</div>}
      {needsApproval.map((r) => (
        <Card key={r.id} row={r} />
      ))}

      <h2>Approved, waiting for the agent ({queued.length})</h2>
      {queued.length === 0 && <div className="empty">Nothing waiting.</div>}
      {queued.map((r) => (
        <Card key={r.id} row={r} />
      ))}
      {queued.length > 0 && (
        <form className="wake" action={wakeAgent}>
          <button className="primary" type="submit">Wake agent and publish</button>
        </form>
      )}

      <h2>Scheduled ({scheduled.length})</h2>
      {scheduled.length === 0 && <div className="empty">Nothing scheduled.</div>}
      {scheduled.map((r) => (
        <Card key={r.id} row={r} />
      ))}

      <h2>Published ({published.length})</h2>
      {published.length === 0 && <div className="empty">Nothing published yet.</div>}
      {published.map((r) => (
        <Card key={r.id} row={r} />
      ))}
    </main>
  );
}
