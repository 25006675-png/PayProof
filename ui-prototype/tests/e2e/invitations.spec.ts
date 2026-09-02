import { expect, test } from "@playwright/test";

const member = {
  organizationId: "org-1", organizationName: "FreshSource Foods", organizationSlug: "freshsource",
  accountId: "account-1", authority: "owner", canBuy: true, canSupply: true,
};
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const invitedOrder = {
  id: "live-order-id", reference: "PO-3001", buyerId: "buyer-id", buyerName: "GreenBite Trading",
  supplierEmail: "supplier@example.com", supplierName: "FreshSource Foods", arbitratorId: "arbitrator-id",
  assetType: "Testnet USDC", amountUnits: "1250000000", orderHash: "order-hash", description: "Sunflower oil 20L",
  deliveryDate: "2026-09-18", deliveryLocation: "GreenBite receiving dock",
  lineItems: [{ id: "1", description: "Sunflower oil 20L", quantity: "10", unit: "drums", unitPriceUnits: "125000000" }],
  status: "awaiting_supplier", version: 2, inviteExpiresAt: "2026-09-09T03:06:00.000Z",
  createdAt: "2026-09-01T03:06:00.000Z", updatedAt: "2026-09-02T03:06:00.000Z",
};

const signIn = (user: { id: string; email: string; name: string }) => (page: import("@playwright/test").Page) =>
  page.addInitScript((value) => localStorage.setItem("proofpay_demo_session", JSON.stringify({
    accessToken: "session-token", mode: "supabase", user: value,
  })), user);

test("keeps the invitation when the visitor leaves the sign-in gate", async ({ page }) => {
  await page.goto("/orders/live-order-id?invite=secure-invite-token");
  await expect(page.getByRole("heading", { name: "Sign in to review this order" })).toBeVisible();

  const pending = await page.evaluate(() => localStorage.getItem("payproof_pending_invite"));
  expect(pending && JSON.parse(pending)).toMatchObject({ orderId: "live-order-id", token: "secure-invite-token" });

  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await page.getByRole("link", { name: "Return to ProofPay" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("payproof_pending_invite"))).not.toBeNull();
});

test("surfaces a pending invitation in the overview and confirms with the agreement", async ({ page }) => {
  await signIn({ id: "supplier-id", email: "supplier@example.com", name: "Supplier" })(page);
  await page.route("http://localhost:8787/v1/workspace", (route) => route.fulfill(json({ primary: member, organizations: [member] })));
  await page.route("http://localhost:8787/v1/orders", (route) => route.fulfill(json([])));
  await page.route("http://localhost:8787/v1/invitations", (route) => route.fulfill(json([{
    orderId: "live-order-id", reference: "PO-3001", buyerName: "GreenBite Trading", counterpartyName: "GreenBite Trading", invitedRole: "supplier", invitedEmail: "supplier@example.com",
    assetType: "Testnet USDC", amountUnits: "1250000000", deliveryDate: "2026-09-18",
    invitedAt: "2026-09-02T03:06:00.000Z", expiresAt: "2026-09-09T03:06:00.000Z",
  }])));
  await page.route("http://localhost:8787/v1/orders/live-order-id", (route) => route.fulfill(json(invitedOrder)));
  let accepted = 0;
  await page.route("http://localhost:8787/v1/orders/live-order-id/accept", (route) => {
    accepted += 1;
    return route.fulfill(json({ ...invitedOrder, supplierId: "supplier-id", status: "supplier_confirmed", version: 3, confirmation: { confirmedBy: "supplier-id", confirmedRole: "supplier", organizationName: "FreshSource Foods", orderVersion: 2, termsVersion: "1.0", confirmedAt: "2026-09-02T04:00:00.000Z" } }));
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Needs your action" })).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "PO-3001" });
  await expect(item.getByText("Review and confirm the order")).toBeVisible();
  await expect(item.getByText("1,250 USDC", { exact: true })).toBeVisible();
  await item.getByRole("link", { name: /Open order/ }).click();

  await expect(page).toHaveURL(/\/orders\/live-order-id$/);
  await page.getByRole("checkbox", { name: /I have reviewed every line/ }).check();
  await page.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
  await page.getByRole("button", { name: "Confirm and accept terms" }).click();
  await expect(page.getByText("Ready to fund", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Confirmed by FreshSource Foods, order version 3, terms version 1\.0/)).toBeVisible();
  expect(accepted).toBe(1);
});

test("lets the buyer cancel an outstanding invitation", async ({ page }) => {
  await signIn({ id: "buyer-id", email: "buyer@example.com", name: "Buyer" })(page);
  await page.route("http://localhost:8787/v1/workspace", (route) => route.fulfill(json({ primary: member, organizations: [member] })));
  await page.route("http://localhost:8787/v1/orders", (route) => route.fulfill(json([])));
  await page.route("http://localhost:8787/v1/invitations", (route) => route.fulfill(json([])));
  await page.route("http://localhost:8787/v1/orders/live-order-id", (route) => route.fulfill(json(invitedOrder)));
  let cancelled = 0;
  await page.route("http://localhost:8787/v1/orders/live-order-id/invite/cancel", (route) => {
    cancelled += 1;
    return route.fulfill(json({ ...invitedOrder, inviteExpiresAt: undefined, version: 3 }));
  });

  await page.goto("/orders/live-order-id");
  await expect(page.getByText(/can confirm from their own ProofPay workspace/i)).toBeVisible();
  await page.getByRole("button", { name: "Cancel invitation" }).click();

  await expect(page.getByRole("button", { name: "Cancel invitation" })).toHaveCount(0);
  await expect(page.getByText("The invitation was cancelled.")).toBeVisible();
  expect(cancelled).toBe(1);
});
