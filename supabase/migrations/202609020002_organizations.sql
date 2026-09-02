create table if not exists public.payproof_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  created_by_account_id uuid not null references public.payproof_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payproof_organization_memberships (
  organization_id uuid not null references public.payproof_organizations(id) on delete cascade,
  account_id uuid not null references public.payproof_accounts(id) on delete cascade,
  authority text not null check (authority in ('owner', 'admin', 'member')),
  can_buy boolean not null default false,
  can_supply boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, account_id)
);

create index if not exists payproof_memberships_account_idx
  on public.payproof_organization_memberships (account_id, organization_id);

alter table public.trade_orders
  add column if not exists buyer_organization_id uuid references public.payproof_organizations(id),
  add column if not exists supplier_organization_id uuid references public.payproof_organizations(id);

create index if not exists trade_orders_buyer_org_idx
  on public.trade_orders (buyer_organization_id, updated_at desc);
create index if not exists trade_orders_supplier_org_idx
  on public.trade_orders (supplier_organization_id, updated_at desc);

alter table public.payproof_organizations enable row level security;
alter table public.payproof_organization_memberships enable row level security;
revoke all on public.payproof_organizations, public.payproof_organization_memberships from public, anon;
revoke insert, update, delete on public.payproof_organizations, public.payproof_organization_memberships from authenticated;
grant select on public.payproof_organizations, public.payproof_organization_memberships to authenticated;

create or replace function public.current_payproof_account_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.payproof_accounts where supabase_user_id = auth.uid()
$$;

drop policy if exists "members can read their organizations" on public.payproof_organizations;
create policy "members can read their organizations" on public.payproof_organizations
for select to authenticated using (
  exists (select 1 from public.payproof_organization_memberships m
    where m.organization_id = id and m.account_id = public.current_payproof_account_id())
);
drop policy if exists "members can read their memberships" on public.payproof_organization_memberships;
create policy "members can read their memberships" on public.payproof_organization_memberships
for select to authenticated using (account_id = public.current_payproof_account_id());

create or replace function public.ensure_personal_organization(
  p_account_id uuid,
  p_name text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  result uuid;
  base_slug text;
begin
  select organization_id into result
  from public.payproof_organization_memberships
  where account_id = p_account_id
  order by created_at
  limit 1;
  if found then return result; end if;

  base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(p_name, ''), 'payproof-workspace')), '[^a-z0-9]+', '-', 'g'));
  if char_length(base_slug) < 3 then base_slug := 'payproof-workspace'; end if;
  base_slug := left(base_slug, 68) || '-' || left(replace(p_account_id::text, '-', ''), 8);
  insert into public.payproof_organizations (name, slug, created_by_account_id)
  values (coalesce(nullif(trim(p_name), ''), 'My PayProof workspace'), base_slug, p_account_id)
  returning id into result;
  insert into public.payproof_organization_memberships
    (organization_id, account_id, authority, can_buy, can_supply)
  values (result, p_account_id, 'owner', true, true);
  return result;
end;
$$;

create or replace function public.create_payproof_organization(
  p_account_id uuid,
  p_name text
) returns public.payproof_organizations
language plpgsql security definer set search_path = ''
as $$
declare result public.payproof_organizations;
declare result_slug text;
begin
  if not exists (select 1 from public.payproof_accounts where id = p_account_id) then
    raise exception 'PAYPROOF_ACCOUNT_NOT_FOUND';
  end if;
  result_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(result_slug) < 3 then result_slug := 'workspace'; end if;
  result_slug := left(result_slug, 68) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
  insert into public.payproof_organizations (name, slug, created_by_account_id)
  values (trim(p_name), result_slug, p_account_id) returning * into result;
  insert into public.payproof_organization_memberships
    (organization_id, account_id, authority, can_buy, can_supply)
  values (result.id, p_account_id, 'owner', true, true);
  return result;
end;
$$;

create or replace function public.save_trade_order(
  p_id uuid,
  p_expected_version integer,
  p_status text,
  p_supplier_id text,
  p_supplier_organization_id uuid,
  p_aggregate jsonb
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.trade_orders
  set status = p_status,
      supplier_id = p_supplier_id,
      supplier_organization_id = p_supplier_organization_id,
      version = (p_aggregate->>'version')::integer,
      aggregate = p_aggregate,
      updated_at = now()
  where id = p_id and version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.current_payproof_account_id() from public, anon;
revoke all on function public.ensure_personal_organization(uuid, text) from public, anon, authenticated;
revoke all on function public.create_payproof_organization(uuid, text) from public, anon, authenticated;
revoke all on function public.save_trade_order(uuid, integer, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.current_payproof_account_id() to authenticated;
grant execute on function public.ensure_personal_organization(uuid, text) to service_role;
grant execute on function public.create_payproof_organization(uuid, text) to service_role;
grant execute on function public.save_trade_order(uuid, integer, text, text, uuid, jsonb) to service_role;

drop policy if exists "trade parties can read" on public.trade_orders;
create policy "trade parties can read" on public.trade_orders
for select to authenticated using (
  exists (
    select 1 from public.payproof_accounts account
    where account.supabase_user_id = auth.uid()
      and (
        account.id::text in (buyer_id, supplier_id, arbitrator_id)
        or exists (
          select 1 from public.payproof_organization_memberships membership
          where membership.account_id = account.id
            and membership.organization_id in (buyer_organization_id, supplier_organization_id)
        )
      )
  )
);

comment on table public.payproof_organizations is 'PayProof company/workspace records; private commercial authority is defined by membership.';
comment on table public.payproof_organization_memberships is 'Server-enforced authority and buy/supply capabilities for a PayProof organization.';
