-- Supplier-initiated orders: the buyer is unknown until they confirm, so buyer_id
-- becomes nullable and the save function can bind the buyer on confirmation.
-- Also admits the awaiting_buyer status and the full-acceptance settlement path.

alter table public.trade_orders alter column buyer_id drop not null;

alter table public.trade_orders drop constraint if exists trade_orders_status_check;
alter table public.trade_orders add constraint trade_orders_status_check
  check (status in ('awaiting_supplier','awaiting_buyer','supplier_confirmed','funded','in_transit','delivered','dispute_open','negotiation_open','arbitration_pending','settlement_pending','settled'));

alter table public.trade_orders drop constraint if exists trade_orders_check;
alter table public.trade_orders drop constraint if exists trade_orders_check1;
alter table public.trade_orders drop constraint if exists trade_orders_parties_distinct;
alter table public.trade_orders add constraint trade_orders_parties_distinct
  check (
    (buyer_id is null or buyer_id <> arbitrator_id)
    and (supplier_id is null or supplier_id <> arbitrator_id)
    and (buyer_id is null or supplier_id is null or buyer_id <> supplier_id)
    and (buyer_id is not null or supplier_id is not null)
  );

drop function if exists public.save_trade_order(uuid, integer, text, text, uuid, jsonb);

create or replace function public.save_trade_order(
  p_id uuid,
  p_expected_version integer,
  p_status text,
  p_buyer_id text,
  p_buyer_organization_id uuid,
  p_supplier_id text,
  p_supplier_organization_id uuid,
  p_aggregate jsonb
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.trade_orders
  set status = p_status,
      buyer_id = p_buyer_id,
      buyer_organization_id = p_buyer_organization_id,
      supplier_id = p_supplier_id,
      supplier_organization_id = p_supplier_organization_id,
      version = (p_aggregate->>'version')::integer,
      aggregate = p_aggregate,
      updated_at = now()
  where id = p_id and version = p_expected_version;
  return found;
end;
$$;

revoke all on function public.save_trade_order(uuid, integer, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_trade_order(uuid, integer, text, text, uuid, text, uuid, jsonb) to service_role;

comment on column public.trade_orders.buyer_id is 'Null until the buyer confirms a supplier-initiated order.';
