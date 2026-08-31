create extension if not exists pgcrypto;

create table if not exists public.dispute_aggregates (
  id uuid primary key,
  buyer_id uuid not null references auth.users(id),
  supplier_id uuid not null references auth.users(id),
  arbitrator_id uuid not null references auth.users(id),
  status text not null check (status in ('supplier_review','negotiation_open','arbitration_pending','settled')),
  version integer not null check (version >= 0),
  aggregate jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> supplier_id and buyer_id <> arbitrator_id and supplier_id <> arbitrator_id)
);

create index if not exists dispute_aggregates_buyer_idx on public.dispute_aggregates (buyer_id, updated_at desc);
create index if not exists dispute_aggregates_supplier_idx on public.dispute_aggregates (supplier_id, updated_at desc);
create index if not exists dispute_aggregates_arbitrator_idx on public.dispute_aggregates (arbitrator_id, updated_at desc);

alter table public.dispute_aggregates enable row level security;
revoke all on public.dispute_aggregates from anon;
revoke insert, update, delete on public.dispute_aggregates from authenticated;
grant select on public.dispute_aggregates to authenticated;

drop policy if exists "dispute parties can read" on public.dispute_aggregates;
create policy "dispute parties can read" on public.dispute_aggregates
for select to authenticated
using (auth.uid() in (buyer_id, supplier_id, arbitrator_id));

create or replace function public.save_dispute_aggregate(
  p_id uuid,
  p_expected_version integer,
  p_status text,
  p_aggregate jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.dispute_aggregates
  set status = p_status,
      version = (p_aggregate->>'version')::integer,
      aggregate = p_aggregate,
      updated_at = now()
  where id = p_id and version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.save_dispute_aggregate(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_dispute_aggregate(uuid, integer, text, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dispute-evidence',
  'dispute-evidence',
  false,
  20971520,
  array['application/pdf','image/jpeg','image/png','text/plain','text/csv']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated evidence upload" on storage.objects;
create policy "authenticated evidence upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'dispute-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owner evidence read" on storage.objects;
create policy "owner evidence read" on storage.objects
for select to authenticated
using (
  bucket_id = 'dispute-evidence'
  and owner_id = auth.uid()::text
);

comment on table public.dispute_aggregates is
'Append-only semantics are enforced by the PayProof backend state machine; optimistic versioning prevents lost updates. Evidence bucket objects are private.';
