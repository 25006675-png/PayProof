import { describe, expect, it } from "vitest";
import { openDispute } from "../src/domain/dispute-machine.js";
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
});
