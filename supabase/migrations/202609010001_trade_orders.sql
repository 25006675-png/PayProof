create table if not exists public.trade_orders (
  id uuid primary key,
  -- IDs are opaque auth subject strings so the demo identity provider and
  -- Supabase/Google identities can share the same aggregate schema.
  buyer_id text not null,
  supplier_id text,
  arbitrator_id text not null,
  status text not null check (status in ('awaiting_supplier','supplier_confirmed','funded','in_transit','delivered','dispute_open','negotiation_open','arbitration_pending','settlement_pending','settled')),
  version integer not null check (version >= 0),
  aggregate jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> arbitrator_id),
  check (supplier_id is null or (buyer_id <> supplier_id and supplier_id <> arbitrator_id))
);

create index if not exists trade_orders_buyer_idx on public.trade_orders (buyer_id, updated_at desc);
create index if not exists trade_orders_supplier_idx on public.trade_orders (supplier_id, updated_at desc);
create index if not exists trade_orders_arbitrator_idx on public.trade_orders (arbitrator_id, updated_at desc);

alter table public.trade_orders enable row level security;
revoke all on public.trade_orders from anon;
revoke insert, update, delete on public.trade_orders from authenticated;
grant select on public.trade_orders to authenticated;

drop policy if exists "trade parties can read" on public.trade_orders;
create policy "trade parties can read" on public.trade_orders
for select to authenticated
using (auth.uid()::text in (buyer_id, supplier_id, arbitrator_id));

create or replace function public.save_trade_order(
  p_id uuid,
  p_expected_version integer,
  p_status text,
  p_supplier_id text,
  p_aggregate jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.trade_orders
  set status = p_status,
      supplier_id = p_supplier_id,
      version = (p_aggregate->>'version')::integer,
      aggregate = p_aggregate,
      updated_at = now()
  where id = p_id and version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.save_trade_order(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_trade_order(uuid, integer, text, text, jsonb) to service_role;

create table if not exists public.trade_invites (
  id uuid primary key,
  order_id uuid not null references public.trade_orders(id) on delete cascade,
  token_hash text not null unique,
  invited_email text not null,
  expires_at timestamptz not null,
  accepted_by text,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trade_invites_order_idx on public.trade_invites (order_id, created_at desc);

alter table public.trade_invites enable row level security;
revoke all on public.trade_invites from anon;
revoke all on public.trade_invites from authenticated;
revoke all on public.trade_invites from public;

comment on table public.trade_orders is 'Durable order lifecycle aggregate. Commercial details remain in aggregate JSON and are served only to authenticated trade parties.';
comment on table public.trade_invites is 'Single-use hashed invitation tokens for supplier acceptance.';
