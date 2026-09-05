alter table public.payproof_organizations
  add column if not exists trust_profile_published_at timestamptz;

comment on column public.payproof_organizations.trust_profile_published_at is
  'Owner/admin opt-in timestamp. Public trust endpoints expose only derived verified aggregates.';

-- Release plans and release records live in the private trade aggregate. Keep the indexed
-- lifecycle columns unchanged so existing v3 orders and RLS policies remain compatible.
