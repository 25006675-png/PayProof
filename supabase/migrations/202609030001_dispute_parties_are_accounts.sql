-- Dispute parties moved to the PayProof identity model: buyer_id and supplier_id are
-- payproof_accounts ids, and arbitrator_id is a configured id that is not an account at all.
-- The original foreign keys into auth.users can therefore never hold, and they block every
-- claim with dispute_aggregates_buyer_id_fkey. trade_orders already stores parties without
-- a foreign key for the same reason.

alter table public.dispute_aggregates drop constraint if exists dispute_aggregates_buyer_id_fkey;
alter table public.dispute_aggregates drop constraint if exists dispute_aggregates_supplier_id_fkey;
alter table public.dispute_aggregates drop constraint if exists dispute_aggregates_arbitrator_id_fkey;

comment on column public.dispute_aggregates.buyer_id is 'PayProof account id, not an auth.users id.';
comment on column public.dispute_aggregates.supplier_id is 'PayProof account id, not an auth.users id.';
comment on column public.dispute_aggregates.arbitrator_id is 'Configured arbitrator id. Not an account.';
