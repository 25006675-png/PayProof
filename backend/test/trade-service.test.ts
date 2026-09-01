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

    expect((await app.request(`/v1/orders/${order.id}/shipment`, { method: "POST", headers: auth(supplierSession.accessToken) })).status).toBe(200);
    expect((await app.request(`/v1/orders/${order.id}/delivery`, { method: "POST", headers: buyerHeaders })).status).toBe(200);

    const opened = await app.request(`/v1/orders/${order.id}/dispute`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({
      disputeTransactionDigest: "111111111111111111111111", disputedUnits: "30000000", requestedBuyerUnits: "20000000",
      claim: "13 cartons were damaged", evidenceStatement: "Receiving photos show damage", negotiationDeadline: "2026-09-03T00:00:00.000Z",
    }) });
    expect(opened.status).toBe(200);
    const payload = await opened.json() as any;
    expect(payload.dispute.status).toBe("supplier_review");
    expect(payload.order.status).toBe("dispute_open");

    const release = await app.request(`/v1/orders/${order.id}/undisputed-release`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ transactionDigest: "7h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ" }) });
    expect(release.status).toBe(200);
    expect((await release.json() as any).undisputedRelease.verificationStatus).toBe("external_reference");
    const releaseRetry = await app.request(`/v1/orders/${order.id}/undisputed-release`, { method: "POST", headers: auth(supplierSession.accessToken), body: JSON.stringify({ transactionDigest: "7h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ" }) });
    expect(releaseRetry.status).toBe(409);
    const buyerRelease = await app.request(`/v1/orders/${order.id}/undisputed-release`, { method: "POST", headers: buyerHeaders, body: JSON.stringify({ transactionDigest: "8h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ" }) });
    expect(buyerRelease.status).toBe(403);

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
    await trades.markShipment(order.id, supplier);
    await trades.markDelivered(order.id, buyer);
    const opened = await trades.openDispute(order.id, buyer, { disputeTransactionDigest: "dispute-direct", disputedUnits: "30000", requestedBuyerUnits: "20000", claim: "Direct agreement claim", evidenceStatement: "Buyer evidence", negotiationDeadline: "2026-09-03T00:00:00.000Z" });
    const agreed = await disputes.respond(opened.dispute.id, supplier, { agrees: true });
    await trades.syncDispute(agreed.id);
    const saved = await trades.getOrder(order.id, buyer);
    expect(agreed.settlement).toMatchObject({ source: "supplier_agreement", buyerUnits: "20000", supplierUnits: "10000" });
    expect(agreed.settlement?.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.status).toBe("settlement_pending");
  });
});
