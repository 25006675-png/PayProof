import { DomainError, type SettlementAllocation } from "./types.js";

export function units(value: string, field = "amount"): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new DomainError("INVALID_AMOUNT", `${field} must be a non-negative integer string`, 400);
  }
  return BigInt(value);
}

export function validateAllocation(
  allocation: SettlementAllocation,
  disputedUnits: string,
): void {
  const buyer = units(allocation.buyerUnits, "buyerUnits");
  const supplier = units(allocation.supplierUnits, "supplierUnits");
  if (buyer + supplier !== units(disputedUnits, "disputedUnits")) {
    throw new DomainError(
      "UNBALANCED_ALLOCATION",
      "Buyer and supplier allocations must exactly equal the disputed amount",
      400,
    );
  }
}
