alter table public.dispute_aggregates
drop constraint if exists dispute_aggregates_status_check;

alter table public.dispute_aggregates
add constraint dispute_aggregates_status_check
check (status in ('supplier_review','negotiation_open','arbitration_pending','settlement_pending','settled'));

comment on column public.dispute_aggregates.status is
'Workflow state. settlement_pending means human agreement exists but verified Sui escrow execution has not yet been recorded.';
