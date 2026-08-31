import { describe, expect, it } from "vitest";
import { openDispute } from "../src/domain/dispute-machine.js";
import { DisputeService } from "../src/service/dispute-service.js";
import { MemoryDisputeStore } from "../src/store/store.js";
import { buyer, controlledContext, openInput } from "./fixtures.js";

describe("memory store", () => {
  it("returns clones and rejects stale concurrent writes", async () => {
    const control = controlledContext();
    const dispute = openDispute(openInput(), buyer, control.ctx);
    const store = new MemoryDisputeStore();
    await store.create(dispute);
    const first = (await store.get(dispute.id))!;
    const stale = (await store.get(dispute.id))!;
    first.version += 1;
    await store.save(first, dispute.version);
    stale.version += 1;
    await expect(store.save(stale, dispute.version)).rejects.toThrow("OPTIMISTIC_LOCK_CONFLICT");
  });

  it("prevents one bound escrow from being attached to two disputes", async () => {
    const control = controlledContext();
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const binding = {
      packageId: "0x1",
      escrowObjectId: `0x${"e".repeat(64)}`,
      fundingTransactionDigest: "funding-reference",
      disputeTransactionDigest: "dispute-reference",
      buyerAddress: `0x${"a".repeat(64)}`,
      supplierAddress: `0x${"b".repeat(64)}`,
      arbitratorAddress: `0x${"c".repeat(64)}`,
    };
    await service.open(openInput({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", onchainEscrow: binding }), buyer);
    await expect(
      service.open(openInput({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", onchainEscrow: binding }), buyer),
    ).rejects.toMatchObject({ code: "ESCROW_ALREADY_BOUND" });
  });
});
