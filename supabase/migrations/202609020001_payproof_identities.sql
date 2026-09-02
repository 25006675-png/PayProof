create table if not exists public.payproof_accounts (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supabase_user_id is not null or email is null)
);

create table if not exists public.payproof_sui_identities (
  address text primary key check (address ~ '^0x[0-9a-f]{64}$'),
  account_id uuid not null references public.payproof_accounts(id) on delete cascade,
  kind text not null check (kind in ('zklogin', 'wallet')),
  issuer text,
  audience text,
  verified_at timestamptz not null default now(),
  unique (account_id, kind),
  check ((kind = 'zklogin' and issuer is not null and audience is not null) or kind = 'wallet')
);

create table if not exists public.wallet_auth_challenges (
  id uuid primary key,
  address text not null check (address ~ '^0x[0-9a-f]{64}$'),
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payproof_sui_account_idx on public.payproof_sui_identities (account_id);
create index if not exists wallet_challenge_expiry_idx on public.wallet_auth_challenges (expires_at) where used_at is null;

alter table public.payproof_accounts enable row level security;
alter table public.payproof_sui_identities enable row level security;
alter table public.wallet_auth_challenges enable row level security;

revoke all on public.payproof_accounts, public.payproof_sui_identities, public.wallet_auth_challenges from public, anon, authenticated;
grant select on public.payproof_accounts, public.payproof_sui_identities to authenticated;

drop policy if exists "users can read their PayProof account" on public.payproof_accounts;
create policy "users can read their PayProof account" on public.payproof_accounts
for select to authenticated using (supabase_user_id = auth.uid());

drop policy if exists "users can read their Sui identities" on public.payproof_sui_identities;
create policy "users can read their Sui identities" on public.payproof_sui_identities
for select to authenticated using (
  exists (
    select 1 from public.payproof_accounts account
    where account.id = account_id and account.supabase_user_id = auth.uid()
  )
);

create or replace function public.resolve_supabase_account(
  p_supabase_user_id uuid,
  p_email text,
  p_display_name text
) returns public.payproof_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare result public.payproof_accounts;
begin
  insert into public.payproof_accounts (supabase_user_id, email, display_name)
  values (p_supabase_user_id, p_email, p_display_name)
  on conflict (supabase_user_id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.resolve_wallet_account(p_address text)
returns public.payproof_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare result public.payproof_accounts;
begin
  select account.* into result
  from public.payproof_accounts account
  join public.payproof_sui_identities identity on identity.account_id = account.id
  where identity.address = p_address;
  if found then return result; end if;

  insert into public.payproof_accounts default values returning * into result;
  insert into public.payproof_sui_identities (address, account_id, kind)
  values (p_address, result.id, 'wallet');
  return result;
end;
$$;

create or replace function public.link_sui_identity(
  p_account_id uuid,
  p_address text,
  p_kind text,
  p_issuer text,
  p_audience text
) returns public.payproof_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare result public.payproof_accounts;
begin
  insert into public.payproof_sui_identities (address, account_id, kind, issuer, audience)
  values (p_address, p_account_id, p_kind, p_issuer, p_audience)
  on conflict (account_id, kind) do update
  set address = excluded.address,
      issuer = excluded.issuer,
      audience = excluded.audience,
      verified_at = now();
  select * into result from public.payproof_accounts where id = p_account_id;
  return result;
end;
$$;

create or replace function public.consume_wallet_challenge(p_id uuid, p_used_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wallet_auth_challenges
  set used_at = p_used_at
  where id = p_id and used_at is null and expires_at > p_used_at;
  return found;
end;
$$;

revoke all on function public.resolve_supabase_account(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_wallet_account(text) from public, anon, authenticated;
revoke all on function public.link_sui_identity(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_wallet_challenge(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_supabase_account(uuid, text, text) to service_role;
grant execute on function public.resolve_wallet_account(text) to service_role;
grant execute on function public.link_sui_identity(uuid, text, text, text, text) to service_role;
grant execute on function public.consume_wallet_challenge(uuid, timestamptz) to service_role;

drop policy if exists "trade parties can read" on public.trade_orders;
create policy "trade parties can read" on public.trade_orders
for select to authenticated using (
  exists (
    select 1 from public.payproof_accounts account
    where account.supabase_user_id = auth.uid()
      and account.id::text in (buyer_id, supplier_id, arbitrator_id)
  )
);

comment on table public.payproof_accounts is 'Stable PayProof account shared by Supabase and verified Sui identity paths.';
comment on table public.payproof_sui_identities is 'Verified zkLogin or wallet addresses mapped to PayProof accounts.';
comment on table public.wallet_auth_challenges is 'Short-lived, single-use challenges for Sui wallet ownership verification.';
