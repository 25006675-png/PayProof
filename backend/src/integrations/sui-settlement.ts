import type { DisputeAggregate, SettlementExecution } from "../domain/types.js";

export interface SettlementExecutionProof {
  transactionDigest: string;
  packageId: string;
  escrowObjectId: string;
  receiptObjectId: string;
}

/**
 * Production implementations must read the transaction and object effects from a
 * trusted Sui RPC, verify the expected escrow package and object, and verify the
 * exact buyer/supplier allocation before returning. Merely receiving a digest from
 * a client is never sufficient.
 */
export interface SuiSettlementVerifier {
  verify(
    dispute: DisputeAggregate,
    proof: SettlementExecutionProof,
  ): Promise<Omit<SettlementExecution, "verifiedAt">>;
}
