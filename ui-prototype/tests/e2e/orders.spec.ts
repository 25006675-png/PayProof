import { expect, test } from "@playwright/test";

test("preserves a secure order invitation until the invited party signs in", async ({ page }) => {
  await page.goto("/orders/live-order-id?invite=secure-invite-token");

  await expect(page.getByRole("heading", { name: "Sign in to review this order" })).toBeVisible();
  await expect(page.getByText(/invitation stays attached/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText("Order not available", { exact: true })).toHaveCount(0);
});

test("explains when an invitation is opened with the wrong account", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("proofpay_demo_session", JSON.stringify({
    accessToken: "buyer-token",
    mode: "supabase",
    suiAddress: "0x1",
    user: { id: "buyer-id", email: "buyer@example.com", name: "Buyer" },
  })));
  await page.route("http://localhost:8787/v1/invites/**", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ error: "INVITE_EMAIL_MISMATCH", message: "Sign in with the supplier email that received this invitation" }),
  }));

  await page.goto("/orders/live-order-id?invite=secure-invite-token");

  await expect(page.getByRole("heading", { name: "Switch account to review this order" })).toBeVisible();
  await expect(page.getByText("buyer@example.com", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch Google account" })).toBeVisible();
});

test("creates a purchase order as buyer with an agreement and multiple line items", async ({ page }) => {
  await page.goto("/orders?action=create");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /is buying/ })).toBeChecked();

  await page.getByLabel("Supplier company name").fill("FreshSource Foods");
  await page.getByLabel("Supplier contact email").fill("supplier@example.com");
  await page.getByLabel("Expected delivery").fill("2026-09-18");
  await page.getByLabel("Delivery location").fill("GreenBite receiving dock");
  await page.getByLabel("Product 1").fill("Sunflower oil 20L");
  await page.getByLabel("Quantity 1").fill("10");
  await page.getByLabel("Unit price 1").fill("125");
  await page.getByRole("button", { name: "Add line item" }).click();
  await page.getByLabel("Product 2").fill("Canola oil 20L");
  await page.getByLabel("Quantity 2").fill("5");
  await page.getByLabel("Unit price 2").fill("140");

  await expect(dialog.getByText("1,950 USDC", { exact: true })).toBeVisible();
  const send = page.getByRole("button", { name: "Send for supplier confirmation" });
  await expect(send).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
  await send.click();
  await expect(page.getByRole("heading", { name: /sent for confirmation/i })).toBeVisible();
  await expect(page.getByText("Confirmation link", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/was sent to FreshSource Foods for confirmation/i)).toBeVisible();
  await expect(page.getByText("Sunflower oil 20L and 1 more", { exact: false }).first()).toBeVisible();
});

test("creates a purchase order as supplier that invites the buyer", async ({ page }) => {
  await page.goto("/orders?action=create");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /is supplying/ }).check();
  await page.getByLabel("Buyer company name").fill("Harvest Table");
  await page.getByLabel("Buyer contact email").fill("purchasing@harvest.example");
  await page.getByLabel("Expected delivery").fill("2026-09-20");
  await page.getByLabel("Delivery location").fill("Harvest Table central kitchen");
  await page.getByLabel("Product 1").fill("Olive oil 5L");
  await page.getByLabel("Quantity 1").fill("40");
  await page.getByLabel("Unit price 1").fill("95");
  await dialog.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
  await page.getByRole("button", { name: "Send for buyer confirmation" }).click();
  await expect(page.getByRole("heading", { name: /sent for confirmation/i })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/was sent to Harvest Table for confirmation/i)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Harvest Table" }).filter({ hasText: "Supplying" }).first();
  await expect(row.getByText("Awaiting confirmation")).toBeVisible();
});

test("shows a sample order for every stage with phase tabs and a preview sheet", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByRole("row").filter({ has: page.getByText("Sample") })).toHaveCount(11);
  for (const label of ["Ready to fund", "Funds secured", "In transit", "Inspection due", "Claim opened", "In negotiation", "Settlement ready", "Settled"]) {
    await expect(page.getByRole("row").filter({ hasText: label }).first()).toBeVisible();
  }
  await page.getByRole("tab", { name: /Claims/ }).click();
  await expect(page.getByRole("row").filter({ has: page.getByText("Sample") })).toHaveCount(3);
  await page.getByRole("tab", { name: /^All/ }).click();

  await page.getByRole("button", { name: "Open PO-2480" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "PO-2480" })).toBeVisible();
  await expect(sheet.getByText("Review and confirm the order").first()).toBeVisible();
  await sheet.getByRole("link", { name: "Review full order" }).click();
  await expect(page).toHaveURL(/\/orders\/sample-po-2480$/);
  await expect(page.getByRole("heading", { name: "PO-2480" })).toBeVisible();
});

test("requires review and agreement before a supplier confirms a sample order", async ({ page }) => {
  await page.goto("/orders/sample-po-2480");
  await expect(page.getByRole("heading", { name: "Review and confirm the order" })).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm and accept terms" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have reviewed every line/ }).check();
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
  await confirm.click();
  await expect(page.getByText("Ready to fund", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Confirmed by .* terms version 1\.0/).first()).toBeVisible();
});

test("lets the invited buyer confirm a supplier-initiated sample order", async ({ page }) => {
  await page.goto("/orders/sample-po-2479");
  await expect(page.getByText("Waiting for buyer confirmation")).toBeVisible();
  await expect(page.getByText("Issued by").locator("..").getByText("Your company")).toBeVisible();
});

test("opens the full order directly from the mobile register", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/orders");
  await page.getByRole("button", { name: "Open PO-2480" }).click();
  await expect(page).toHaveURL(/\/orders\/sample-po-2480$/);
  await expect(page.getByRole("heading", { name: "PO-2480" })).toBeVisible();
});

test("recovers a lost invitation from the order record", async ({ page }) => {
  const liveOrder = {
    id: "live-order-id", reference: "PO-3001", buyerId: "buyer-id", buyerOrganizationId: "org-1",
    buyerName: "GreenBite Trading", supplierEmail: "supplier@example.com", supplierName: "FreshSource Foods",
    arbitratorId: "arbitrator-id", assetType: "Testnet USDC", amountUnits: "1250000000", orderHash: "order-hash",
    description: "Sunflower oil 20L", deliveryDate: "2026-09-18", deliveryLocation: "GreenBite receiving dock",
    lineItems: [{ id: "1", description: "Sunflower oil 20L", quantity: "10", unit: "drums", unitPriceUnits: "125000000" }],
    status: "awaiting_supplier", version: 1, createdAt: "2026-09-01T03:06:00.000Z", updatedAt: "2026-09-01T03:06:00.000Z",
  };
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.addInitScript(() => localStorage.setItem("proofpay_demo_session", JSON.stringify({
    accessToken: "buyer-token",
    mode: "supabase",
    user: { id: "buyer-id", email: "buyer@example.com", name: "Buyer" },
  })));
  await page.route("http://localhost:8787/v1/workspace", (route) => route.fulfill(json({
    primary: { organizationId: "org-1", organizationName: "GreenBite Trading", organizationSlug: "greenbite", accountId: "account-1", authority: "owner", canBuy: true, canSupply: true },
    organizations: [{ organizationId: "org-1", organizationName: "GreenBite Trading", organizationSlug: "greenbite", accountId: "account-1", authority: "owner", canBuy: true, canSupply: true }],
  })));
  await page.route("http://localhost:8787/v1/orders", (route) => route.fulfill(json([])));
  await page.route("http://localhost:8787/v1/invitations", (route) => route.fulfill(json([])));
  await page.route("http://localhost:8787/v1/orders/live-order-id", (route) => route.fulfill(json(liveOrder)));
  let inviteRequests = 0;
  await page.route("http://localhost:8787/v1/orders/live-order-id/invite", (route) => {
    inviteRequests += 1;
    return route.fulfill(json({
      ...liveOrder, version: 2, inviteId: "invite-2", inviteExpiresAt: "2026-09-09T03:06:00.000Z",
      inviteUrl: "http://localhost:3000/orders/live-order-id?invite=fresh-token",
      inviteDelivery: { status: "sent", messageId: "message-2", attemptedAt: "2026-09-02T03:06:00.000Z" },
    }));
  });

  await page.goto("/orders/live-order-id");
  await expect(page.getByRole("heading", { name: "PO-3001" })).toBeVisible();
  await expect(page.getByText(/Earlier links are not shown again/i)).toBeVisible();
  await page.getByRole("button", { name: "Send new invitation" }).click();
  await expect(page.getByText("http://localhost:3000/orders/live-order-id?invite=fresh-token", { exact: true })).toBeVisible();
  await expect(page.getByText(/The invitation email was sent\. Any earlier link no longer works\./)).toBeVisible();
  expect(inviteRequests).toBe(1);
});
