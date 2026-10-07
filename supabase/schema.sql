-- Ship It: publish queue + receipt log.
-- RLS enabled with no public policies: only the service role (server-side) can read/write.
create table if not exists publish_queue (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'new_story',
  source_ref text not null,
  platform text not null check (platform in ('x', 'instagram', 'facebook', 'linkedin')),
  copy text not null,
  image_url text,
  sources jsonb not null default '[]',
  scheduled_for timestamptz,
  qa jsonb not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'publishing', 'scheduled', 'published', 'failed')),
  receipt_id text,
  receipt_url text,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

alter table publish_queue enable row level security;
create index if not exists publish_queue_status_idx on publish_queue (status, created_at desc);
