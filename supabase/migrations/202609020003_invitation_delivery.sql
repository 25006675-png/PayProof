alter table public.trade_invites
  add column if not exists delivery_status text check (delivery_status in ('sent', 'failed', 'not_configured')),
  add column if not exists delivery_message_id text,
  add column if not exists delivery_attempted_at timestamptz;

comment on column public.trade_invites.delivery_status is 'Last automatic invitation email delivery result. Order creation never depends on email availability.';
