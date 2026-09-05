import { describe, expect, it } from "vitest";
import { createApp, type TokenVerifier } from "../src/api/app.js";
import { DemoAwareTokenVerifier, issueDemoGoogleSession } from "../src/api/demo-auth.js";
import { DisputeService } from "../src/service/dispute-service.js";
import { TradeService } from "../src/service/trade-service.js";
import { MemoryDisputeStore } from "../src/store/store.js";
import { MemoryTradeStore } from "../src/store/trade-store.js";
import { ARBITRATOR, BUYER, SUPPLIER, controlledContext } from "./fixtures.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

describe("trade lifecycle API", () => {
  it("stores an exact milestone allocation and rejects plans that do not conserve the order value", async () => {
    const control = controlledContext();
    const trades = new TradeService(new MemoryTradeStore(), new DisputeService(new MemoryDisputeStore(), control.ctx), control.ctx);
    const buyer = { id: BUYER, email: "buyer-plan@example.com", name: "Buyer" };
    const base = { reference: "PLAN-1", supplierEmail: "supplier-plan@example.com", arbitratorId: ARBITRATOR, assetType: "USDC", amountUnits: "100000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ", lineItems: [{ id: "1", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "100000" }] };
    const created = await trades.createOrder({ ...base, releasePlan: { depositUnits: "20000", dispatchUnits: "40000", deliveryUnits: "40000" } }, buyer);
    expect(created.releasePlan).toEqual({ depositUnits: "20000", dispatchUnits: "40000", deliveryUnits: "40000" });
    await expect(trades.createOrder({ ...base, reference: "PLAN-2", releasePlan: { depositUnits: "20000", dispatchUnits: "40000", deliveryUnits: "39999" } }, buyer))
      .rejects.toMatchObject({ code: "INVALID_RELEASE_PLAN", status: 400 });
  });
  it("issues a demo Google session and completes invite, funding, and dispute transitions", async () => {
    const control = controlledContext();
    const fallback: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const verifier = new DemoAwareTokenVerifier(fallback, true);
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx, "http://localhost:3000/workspace");
    const app = createApp(disputes, verifier, undefined, undefined, undefined, trades, true);

    const login = await app.request("/auth/demo/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "buyer@example.com", name: "Buyer Example" }) });
    expect(login.status).toBe(200);
    const buyerSession = await login.json() as { accessToken: string; user: { id: string } };
    const buyerHeaders = auth(buyerSession.accessToken);

    const created = await app.request("/v1/orders", { method: "POST", headers: buyerHeaders, body: JSON.stringify({
      reference: "PO-100", supplierEmail: "supplier@example.com", supplierName: "Supplier Example", arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "100000000", description: "100 cartons of cooking oil", deliveryDate: "2026-09-04", deliveryLocation: "PJ receiving bay",
      lineItems: [{ id: "line-1", description: "Cooking oil", quantity: "100", unit: "carton", unitPriceUnits: "1000000" }],
    }) });
    expect(created.status).toBe(201);
    const order = await created.json() as any;

    const inviteResponse = await app.request(`/v1/orders/${order.id}/invite`, { method: "POST", headers: buyerHeaders });
    expect(inviteResponse.status).toBe(200);
    const invite = await inviteResponse.json() as any;
    expect(invite.inviteToken).toEqual(expect.any(String));
    expect(invite.inviteUrl).toContain("invite=");

    const resentResponse = await app.request(`/v1/orders/${order.id}/invite`, { method: "POST", headers: buyerHeaders });
    expect(resentResponse.status).toBe(200);
    const resent = await resentResponse.json() as any;
    expect(resent.inviteToken).not.toBe(invite.inviteToken);

    const supplierSession = issueDemoGoogleSession("supplier@example.com", "Supplier Example");
    const accepted = await app.request(`/v1/invites/${encodeURIComponent(invite.inviteToken)}/accept`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ email: "supplier@example.com", name: "Supplier Example" }) });
    expect(accepted.status).toBe(410);
    const acceptedFresh = await app.request(`/v1/invites/${encodeURIComponent(resent.inviteToken)}/accept`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ email: "supplier@example.com", name: "Supplier Example" }) });
    expect(acceptedFresh.status).toBe(200);
    expect((await acceptedFresh.json() as any).status).toBe("supplier_confirmed");

    const funded = await app.request(`/v1/orders/${order.id}/funding`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({
      packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "funding-reference", buyerAddress: `0x${"a".repeat(64)}`,
      supplierAddress: `0x${"b".repeat(64)}`, arbitratorAddress: `0x${"c".repeat(64)}`,
    }) });
    expect(funded.status).toBe(200);
    expect((await funded.json() as any).status).toBe("funded");
    const fundingBody = { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "funding-reference", buyerAddress: `0x${"a".repeat(64)}`, supplierAddress: `0x${"b".repeat(64)}`, arbitratorAddress: `0x${"c".repeat(64)}` };
    const retryFunding = await app.request(`/v1/orders/${order.id}/funding`, { method: "POST", headers: buyerHeaders, body: JSON.stringify(fundingBody) });
    expect(retryFunding.status).toBe(200);
    const replacementFunding = await app.request(`/v1/orders/${order.id}/funding`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({ ...fundingBody, escrowObjectId: `0x${"e".repeat(64)}` }) });
    expect(replacementFunding.status).toBe(409);

    expect((await app.request(`/v1/orders/${order.id}/shipment`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ carrier: "GDEX", trackingNumber: "GD-API-1", dispatchedAt: "2026-09-01T00:00:00.000Z", transactionDigest: "shipment-reference", evidenceSha256: "03".repeat(32) }) })).status).toBe(200);
    expect((await app.request(`/v1/orders/${order.id}/delivery`, { method: "POST", headers: buyerHeaders })).status).toBe(200);

    const opened = await app.request(`/v1/orders/${order.id}/dispute`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({
      disputeTransactionDigest: "111111111111111111111111", disputedUnits: "30000000", requestedBuyerUnits: "20000000",
      claim: "13 cartons were damaged", evidenceStatement: "Receiving photos show damage", negotiationDeadline: "2026-09-03T00:00:00.000Z",
    }) });
    expect(opened.status).toBe(200);
    const payload = await opened.json() as any;
    expect(payload.dispute.status).toBe("supplier_review");
    expect(payload.order.status).toBe("dispute_open");

    // The claim transaction itself pays the undisputed value, so the order records the release at once.
    expect(payload.order.undisputedRelease).toMatchObject({ transactionDigest: "111111111111111111111111", verificationStatus: "external_reference" });
    const lateRefund = await app.request(`/v1/orders/${order.id}/deadline-settlement`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({ kind: "refund_unshipped", transactionDigest: "8h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ" }) });
    expect(lateRefund.status).toBe(409);

    const responded = await app.request(`/v1/disputes/${payload.dispute.id}/supplier-response`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ agrees: false, statement: "Dispatch evidence shows the goods left intact." }) });
    expect(responded.status).toBe(200);
    expect((await responded.json() as any).status).toBe("negotiation_open");
  });

  it("does not allow invite reuse by a different account", async () => {
    const control = controlledContext();
    const fallback: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const verifier = new DemoAwareTokenVerifier(fallback, true);
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const app = createApp(disputes, verifier, undefined, undefined, undefined, trades, true);
    const buyer = issueDemoGoogleSession("buyer2@example.com", "Buyer Two");
    const created = await app.request("/v1/orders", { method: "POST", headers: auth(buyer.accessToken), body: JSON.stringify({ reference: "PO-101", supplierEmail: "supplier2@example.com", supplierName: "Supplier Two", arbitratorId: ARBITRATOR, assetType: "USDC", amountUnits: "1", description: "A sample item", deliveryDate: "2026-09-04", deliveryLocation: "PJ", lineItems: [{ id: "1", description: "Sample", quantity: "1", unit: "unit", unitPriceUnits: "1" }] }) });
    const order = await created.json() as any;
    const invite = await (await app.request(`/v1/orders/${order.id}/invite`, { method: "POST", headers: auth(buyer.accessToken) })).json() as any;
    const first = issueDemoGoogleSession("supplier2@example.com", "Supplier Two");
    expect((await app.request(`/v1/invites/${invite.inviteToken}/accept`, { method: "POST", headers: auth(first.accessToken), body: "{}" })).status).toBe(200);
    const other = issueDemoGoogleSession("other@example.com", "Other");
    expect((await app.request(`/v1/invites/${invite.inviteToken}/accept`, { method: "POST", headers: auth(other.accessToken), body: "{}" })).status).toBe(409);
  });

  it("requires a verified email before accepting an email-bound invite", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-email@example.com", name: "Buyer" };
    const created = await trades.createOrder({
      reference: "PO-EMAIL", supplierEmail: "supplier-email@example.com", arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "1", description: "Email-bound item", deliveryDate: "2026-09-04", deliveryLocation: "PJ",
      lineItems: [{ id: "1", description: "Item", quantity: "1", unit: "unit", unitPriceUnits: "1" }],
    }, buyer);
    const invite = await trades.createInvite(created.id, buyer);
    await expect(trades.acceptInvite(invite.inviteToken!, { id: SUPPLIER })).rejects.toMatchObject({ code: "INVITE_EMAIL_REQUIRED" });
  });

  it("syncs a direct supplier agreement into a settlement-pending order", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-direct@example.com", name: "Direct Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-direct@example.com", name: "Direct Supplier" };
    const order = await trades.createOrder({ reference: "DIRECT-PO", supplierEmail: supplier.email, supplierName: supplier.name, arbitratorId: ARBITRATOR, assetType: "USDC", amountUnits: "100000", description: "Direct settlement goods", deliveryDate: "2026-09-04", deliveryLocation: "PJ", lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "100000" }] }, buyer);
    const invite = await trades.createInvite(order.id, buyer);
    await trades.acceptInvite(invite.inviteToken!, supplier, { email: supplier.email, name: supplier.name });
    await trades.recordFunding(order.id, buyer, { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "funding-direct", buyerAddress: "0xa", supplierAddress: "0xb", arbitratorAddress: "0xc" });
    await trades.markShipment(order.id, supplier, { carrier: "GDEX", trackingNumber: "DIRECT-1", dispatchedAt: "2026-09-01T00:00:00.000Z", transactionDigest: "ship-direct", evidenceSha256: "03".repeat(32) });
    await trades.markDelivered(order.id, buyer);
    const opened = await trades.openDispute(order.id, buyer, { disputeTransactionDigest: "dispute-direct", disputedUnits: "30000", requestedBuyerUnits: "20000", claim: "Direct agreement claim", evidenceStatement: "Buyer evidence", negotiationDeadline: "2026-09-03T00:00:00.000Z" });
    const agreed = await disputes.respond(opened.dispute.id, supplier, { agrees: true });
    await trades.syncDispute(agreed.id);
    const saved = await trades.getOrder(order.id, buyer);
    expect(agreed.settlement).toMatchObject({ source: "supplier_agreement", buyerUnits: "20000", supplierUnits: "10000" });
    expect(agreed.settlement?.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.status).toBe("settlement_pending");
  });
  it("surfaces a pending invitation to the invited email and accepts it without the emailed token", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-workspace@example.com", name: "Workspace Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-workspace@example.com", name: "Workspace Supplier" };
    const order = await trades.createOrder({
      reference: "PO-WORKSPACE", supplierEmail: supplier.email!, supplierName: supplier.name, arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "500000", description: "Invited goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "500000" }],
    }, buyer);
    await trades.createInvite(order.id, buyer);

    const invitations = await trades.listInvitations(supplier);
    expect(invitations).toMatchObject([{ orderId: order.id, reference: "PO-WORKSPACE", buyerName: "Workspace Buyer", amountUnits: "500000" }]);
    expect(await trades.listInvitations({ id: "44444444-4444-4444-8444-444444444444", email: "someone-else@example.com" })).toEqual([]);

    // The invited supplier reads the order without ever holding the token.
    expect((await trades.getOrder(order.id, supplier)).reference).toBe("PO-WORKSPACE");

    const accepted = await trades.acceptInvitation(order.id, supplier);
    expect(accepted.status).toBe("supplier_confirmed");
    expect(accepted.supplierId).toBe(SUPPLIER);
    expect(await trades.listInvitations(supplier)).toEqual([]);
  });

  it("refuses a token-free acceptance from an account with no verified email", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-unverified@example.com", name: "Buyer" };
    const order = await trades.createOrder({
      reference: "PO-UNVERIFIED", supplierEmail: "supplier-unverified@example.com", arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "1000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "1000" }],
    }, buyer);
    await trades.createInvite(order.id, buyer);
    await expect(trades.acceptInvitation(order.id, { id: SUPPLIER }, { email: "supplier-unverified@example.com" }))
      .rejects.toMatchObject({ code: "INVITE_EMAIL_REQUIRED" });
    await expect(trades.getOrder(order.id, { id: SUPPLIER })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cancels an outstanding invitation and withdraws its access", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-cancel@example.com", name: "Cancelling Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-cancel@example.com", name: "Cancelled Supplier" };
    const order = await trades.createOrder({
      reference: "PO-CANCEL", supplierEmail: supplier.email!, arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "1000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "1000" }],
    }, buyer);
    const invited = await trades.createInvite(order.id, buyer);

    const cancelled = await trades.cancelInvite(order.id, buyer);
    expect(cancelled.inviteId).toBeUndefined();
    expect(await trades.listInvitations(supplier)).toEqual([]);
    await expect(trades.acceptInvite(invited.inviteToken!, supplier)).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    await expect(trades.acceptInvitation(order.id, supplier)).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    await expect(trades.getOrder(order.id, supplier)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(trades.cancelInvite(order.id, buyer)).rejects.toMatchObject({ code: "NO_PENDING_INVITATION" });
  });

  it("lets a supplier issue the order and the invited buyer confirm it", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const supplier = { id: SUPPLIER, email: "supplier-init@example.com", name: "FreshSource" };
    const buyer = { id: BUYER, email: "buyer-init@example.com", name: "GreenBite" };
    const order = await trades.createOrder({
      reference: "PO-SUP-1", initiatorRole: "supplier", buyerEmail: buyer.email, buyerName: "GreenBite Trading", arbitratorId: ARBITRATOR,
      supplierWalletAddress: `0x${"b".repeat(64)}`,
      assetType: "USDC", amountUnits: "5000", description: "Olive oil", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Olive oil 5L", quantity: "50", unit: "tins", unitPriceUnits: "100" }],
    }, supplier);
    expect(order.status).toBe("awaiting_buyer");
    expect(order.initiatorRole).toBe("supplier");
    expect(order.supplierId).toBe(SUPPLIER);
    expect(order.buyerId).toBeUndefined();

    await expect(trades.createInvite(order.id, buyer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const invited = await trades.createInvite(order.id, supplier);
    expect(invited.inviteUrl).toContain("invite=");

    const pending = await trades.listInvitations(buyer);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ orderId: order.id, invitedRole: "buyer", counterpartyName: "FreshSource" });
    expect((await trades.getOrder(order.id, buyer)).status).toBe("awaiting_buyer");

    const confirmed = await trades.acceptInvitation(order.id, buyer);
    expect(confirmed.status).toBe("supplier_confirmed");
    expect(confirmed.buyerId).toBe(BUYER);
    expect(confirmed.buyerEmail).toBe(buyer.email);
    expect(confirmed.confirmation).toMatchObject({ confirmedBy: BUYER, confirmedRole: "buyer", termsVersion: "1.1", orderVersion: 1 });
    expect(await trades.listInvitations(buyer)).toEqual([]);

    const funded = await trades.recordFunding(order.id, buyer, {
      packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "funding-reference", buyerAddress: `0x${"a".repeat(64)}`,
      supplierAddress: `0x${"b".repeat(64)}`, arbitratorAddress: `0x${"c".repeat(64)}`,
    });
    expect(funded.status).toBe("funded");
    await expect(trades.recordFunding(order.id, supplier, {
      packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "funding-reference", buyerAddress: `0x${"a".repeat(64)}`,
      supplierAddress: `0x${"b".repeat(64)}`, arbitratorAddress: `0x${"c".repeat(64)}`,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records the supplier's confirmation with the accepted terms version", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-terms@example.com", name: "Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-terms@example.com", name: "Supplier" };
    const order = await trades.createOrder({
      reference: "PO-TERMS", supplierEmail: supplier.email, arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "1000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "1000" }],
    }, buyer);
    await trades.createInvite(order.id, buyer);
    const confirmed = await trades.acceptInvitation(order.id, supplier);
    expect(confirmed.confirmation).toMatchObject({ confirmedBy: SUPPLIER, confirmedRole: "supplier", email: supplier.email, termsVersion: "1.1" });
  });

  it("settles a fully accepted delivery against the release transaction", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-accept@example.com", name: "Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-accept@example.com", name: "Supplier" };
    const order = await trades.createOrder({
      reference: "PO-ACCEPT", supplierEmail: supplier.email, arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "3000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "a", description: "Oil", quantity: "10", unit: "drums", unitPriceUnits: "200" }, { id: "b", description: "Flour", quantity: "5", unit: "bags", unitPriceUnits: "200" }],
    }, buyer);
    await trades.createInvite(order.id, buyer);
    await trades.acceptInvitation(order.id, supplier);
    await trades.recordFunding(order.id, buyer, { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "fund", buyerAddress: `0x${"a".repeat(64)}`, supplierAddress: `0x${"b".repeat(64)}`, arbitratorAddress: `0x${"c".repeat(64)}` });
    await expect(trades.acceptDelivery(order.id, buyer, { transactionDigest: "release-1" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await trades.markShipment(order.id, supplier, { carrier: "GDEX", trackingNumber: "ACCEPT-1", dispatchedAt: "2026-09-01T00:00:00.000Z", transactionDigest: "ship-accept", evidenceSha256: "03".repeat(32) });
    await trades.markDelivered(order.id, buyer);

    await expect(trades.acceptDelivery(order.id, supplier, { transactionDigest: "release-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(trades.acceptDelivery(order.id, buyer, {
      transactionDigest: "release-1", inspection: { lines: [{ lineId: "a", accepted: "9", missing: "1", damaged: "0" }, { lineId: "b", accepted: "5", missing: "0", damaged: "0" }] },
    })).rejects.toMatchObject({ code: "INVALID_INSPECTION" });

    const settled = await trades.acceptDelivery(order.id, buyer, {
      transactionDigest: "release-1", receiptObjectId: "0x9",
      inspection: { lines: [{ lineId: "a", accepted: "10", missing: "0", damaged: "0" }, { lineId: "b", accepted: "5", missing: "0", damaged: "0" }], note: "All good" },
    });
    expect(settled.status).toBe("settled");
    expect(settled.settlement).toMatchObject({ buyerUnits: "0", supplierUnits: "3000", transactionDigest: "release-1", receiptObjectId: "0x9", verifiedOnChain: false, source: "full_acceptance" });
    expect(settled.inspection?.lines).toHaveLength(2);
    expect(settled.inspection?.note).toBe("All good");
    await expect(trades.acceptDelivery(order.id, buyer, { transactionDigest: "release-2" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("stores an attached document and serves it to both parties only", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-doc@example.com", name: "Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-doc@example.com", name: "Supplier" };
    const stranger = { id: "44444444-4444-4444-8444-444444444444", email: "other@example.com", name: "Other" };
    const order = await trades.createOrder({
      reference: "PO-DOC", supplierEmail: supplier.email, arbitratorId: ARBITRATOR,
      assetType: "USDC", amountUnits: "1000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ",
      lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "1000" }],
    }, buyer);
    await trades.createInvite(order.id, buyer);
    await trades.acceptInvitation(order.id, supplier);

    const bytes = new TextEncoder().encode("DELIVERY ORDER DO-1 damaged cartons: 13");
    const withDocument = await trades.attachDocument(order.id, buyer, { kind: "claim_evidence", name: "delivery order.txt", mimeType: "text/plain", bytes, transcript: "DELIVERY ORDER DO-1" });
    expect(withDocument.documents).toHaveLength(1);
    const document = withDocument.documents![0]!;
    expect(document).toMatchObject({ kind: "claim_evidence", name: "delivery order.txt", uploadedBy: BUYER, uploadedRole: "buyer", sizeBytes: bytes.byteLength, transcript: "DELIVERY ORDER DO-1" });
    expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(document.storagePath).toBe(`orders/${order.id}/${document.id}`);

    const read = await trades.readDocument(order.id, supplier, document.id);
    expect(new TextDecoder().decode(read.bytes)).toContain("damaged cartons: 13");
    expect(read.mimeType).toBe("text/plain");
    await expect(trades.readDocument(order.id, stranger, document.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(trades.attachDocument(order.id, supplier, { kind: "poster" as never, name: "x", mimeType: "text/plain", bytes })).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    await expect(trades.attachDocument(order.id, supplier, { kind: "dispatch_evidence", name: "empty.txt", mimeType: "text/plain", bytes: new Uint8Array() })).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    const supplierDoc = await trades.attachDocument(order.id, supplier, { kind: "dispatch_evidence", name: "dispatch.txt", mimeType: "text/plain", bytes });
    expect(supplierDoc.documents).toHaveLength(2);
    expect(supplierDoc.documents![1]!.uploadedRole).toBe("supplier");
    await expect(trades.attachDocument(order.id, supplier, { kind: "dispatch_evidence", name: "anchored.txt", mimeType: "text/plain", bytes, anchorTransactionDigest: "anchor-1" })).rejects.toMatchObject({ code: "FUNDING_REQUIRED" });
  });

  it("records the undisputed release from the claim transaction and keeps the escrow deadlines", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-claim@example.com", name: "Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-claim@example.com", name: "Supplier" };
    const order = await trades.createOrder({ reference: "PO-CLAIM", supplierEmail: supplier.email, arbitratorId: ARBITRATOR, assetType: "USDC", amountUnits: "100000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ", lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "100000" }] }, buyer);
    await trades.createInvite(order.id, buyer);
    await trades.acceptInvitation(order.id, supplier);
    const deadline = control.ctx.now().getTime() + 5 * 24 * 60 * 60 * 1000;
    const funded = await trades.recordFunding(order.id, buyer, { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "fund-claim", buyerAddress: "0xa", supplierAddress: "0xb", arbitratorAddress: "0xc", deliveryDeadlineMs: deadline, inspectionWindowMs: 7 * 24 * 60 * 60 * 1000 });
    expect(funded.funding).toMatchObject({ deliveryDeadlineMs: deadline, inspectionWindowMs: 7 * 24 * 60 * 60 * 1000 });
    const shipped = await trades.markShipment(order.id, supplier, { carrier: "GDEX", trackingNumber: "GD1", dispatchedAt: "2026-09-01T00:00:00.000Z", transactionDigest: "ship-claim", evidenceSha256: "03".repeat(32) });
    expect(shipped.shipment).toMatchObject({ carrier: "GDEX", transactionDigest: "ship-claim", verificationStatus: "external_reference" });
    await trades.markDelivered(order.id, buyer);
    const opened = await trades.openDispute(order.id, buyer, { disputeTransactionDigest: "dispute-claim", disputedUnits: "30000", requestedBuyerUnits: "20000", claim: "Short delivery", evidenceStatement: "Buyer evidence", negotiationDeadline: "2026-09-03T00:00:00.000Z" });
    expect(opened.order.undisputedRelease).toMatchObject({ transactionDigest: "dispute-claim", verificationStatus: "external_reference" });
    expect(opened.dispute.undisputedReleasedUnits).toBe("70000");
  });

  it("settles by deadline only for the entitled party once the escrow deadline has passed", async () => {
    const control = controlledContext();
    const disputes = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const trades = new TradeService(new MemoryTradeStore(), disputes, control.ctx);
    const buyer = { id: BUYER, email: "buyer-deadline@example.com", name: "Buyer" };
    const supplier = { id: SUPPLIER, email: "supplier-deadline@example.com", name: "Supplier" };
    const create = async (reference: string) => {
      const order = await trades.createOrder({ reference, supplierEmail: supplier.email, arbitratorId: ARBITRATOR, assetType: "USDC", amountUnits: "5000", description: "Goods", deliveryDate: "2026-09-20", deliveryLocation: "PJ", lineItems: [{ id: "line", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "5000" }] }, buyer);
      await trades.createInvite(order.id, buyer);
      await trades.acceptInvitation(order.id, supplier);
      return order;
    };
    const day = 24 * 60 * 60 * 1000;
    const now = control.ctx.now().getTime();

    const unshipped = await create("PO-UNSHIPPED");
    await trades.recordFunding(unshipped.id, buyer, { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "fund-u", buyerAddress: "0xa", supplierAddress: "0xb", arbitratorAddress: "0xc", deliveryDeadlineMs: now + day, inspectionWindowMs: 7 * day });
    await expect(trades.settleByDeadline(unshipped.id, buyer, { kind: "refund_unshipped", transactionDigest: "refund-1" })).rejects.toMatchObject({ code: "DEADLINE_NOT_REACHED" });
    await expect(trades.settleByDeadline(unshipped.id, supplier, { kind: "refund_unshipped", transactionDigest: "refund-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    control.set(new Date(now + 2 * day).toISOString());
    await expect(trades.settleByDeadline(unshipped.id, supplier, { kind: "claim_uninspected", transactionDigest: "claim-1" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const refunded = await trades.settleByDeadline(unshipped.id, buyer, { kind: "refund_unshipped", transactionDigest: "refund-1", receiptObjectId: "0x9" });
    expect(refunded.status).toBe("settled");
    expect(refunded.settlement).toMatchObject({ buyerUnits: "5000", supplierUnits: "0", source: "refund_unshipped", receiptObjectId: "0x9", verifiedOnChain: false });
    // Nothing further reached the supplier, so the reclaim adds no release record.
    expect(refunded.releaseRecords?.filter((record) => record.stage === "delivery")).toEqual([]);

    const uninspected = await create("PO-UNINSPECTED");
    const later = control.ctx.now().getTime();
    await trades.recordFunding(uninspected.id, buyer, { packageId: "0x1", escrowObjectId: "0x3", transactionDigest: "fund-i", buyerAddress: "0xa", supplierAddress: "0xb", arbitratorAddress: "0xc", deliveryDeadlineMs: later + day, inspectionWindowMs: 7 * day });
    await trades.markShipment(uninspected.id, supplier, { carrier: "GDEX", trackingNumber: "GD2", dispatchedAt: "2026-09-01T00:00:00.000Z", transactionDigest: "ship-i", evidenceSha256: "03".repeat(32) });
    await expect(trades.settleByDeadline(uninspected.id, buyer, { kind: "refund_unshipped", transactionDigest: "refund-2" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(trades.settleByDeadline(uninspected.id, supplier, { kind: "claim_uninspected", transactionDigest: "claim-2" })).rejects.toMatchObject({ code: "DEADLINE_NOT_REACHED" });
    control.set(new Date(later + 9 * day).toISOString());
    const claimed = await trades.settleByDeadline(uninspected.id, supplier, { kind: "claim_uninspected", transactionDigest: "claim-2" });
    expect(claimed.settlement).toMatchObject({ buyerUnits: "0", supplierUnits: "5000", source: "claim_uninspected" });
    // The supplier was actually paid the delivery balance, so the release trail must show it.
    expect(claimed.releaseRecords?.at(-1)).toMatchObject({ stage: "delivery", amountUnits: "5000", cumulativeReleasedUnits: "5000", remainingUnits: "0", transactionDigest: "claim-2" });
  });
});
