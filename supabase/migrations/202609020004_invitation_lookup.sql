-- Pending invitations are looked up by the invited email so an invited supplier
-- finds the order after signing in through any route, not only the emailed link.
create index if not exists trade_invites_invited_email_idx
  on public.trade_invites (invited_email, created_at desc);
