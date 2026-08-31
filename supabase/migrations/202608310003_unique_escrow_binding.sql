-- One on-chain escrow must back at most one off-chain dispute. The partial
-- index leaves legacy disputes without a binding valid while preventing replay
-- of a funded escrow into multiple aggregates.
create unique index if not exists dispute_aggregates_escrow_object_idx
on public.dispute_aggregates ((aggregate->'onchainEscrow'->>'escrowObjectId'))
where aggregate->'onchainEscrow'->>'escrowObjectId' is not null;
