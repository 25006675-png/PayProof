import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Full trade lifecycle against the running backend (PAYPROOF_DEMO_MODE=true,
 * BACKEND_STORE=memory, SUI_ESCROW_VERIFIER_ENABLED=false), including a live
 * AI mediation run, plus the sample flows that run entirely in the browser.
 */
const API = process.env.PAYPROOF_API_URL ?? "http://localhost:8787";
const stamp = Date.now().toString(36);
const buyer = { email: `buyer.${stamp}@payproof.test`, name: `GreenBite ${stamp}` };
const supplier = { email: `supplier.${stamp}@payproof.test`, name: `FreshSource ${stamp}` };
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

async function demoSession(user: { email: string; name: string }) {
  const response = await fetch(`${API}/auth/demo/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) });
  if (!response.ok) throw new Error(`Demo login failed (${response.status}). Start the backend with PAYPROOF_DEMO_MODE=true.`);
  return { ...(await response.json()), mode: "demo-google" };
}

async function signedInPage(browser: Browser, user: { email: string; name: string }): Promise<Page> {
  const session = await demoSession(user);
  const context = await browser.newContext();
  await context.addInitScript((value) => localStorage.setItem("proofpay_demo_session", JSON.stringify(value)), session);
  return context.newPage();
}

/** Ticks every checkbox in the open dialog (agreement plus attestations) and presses the confirm button. */
async function agree(page: Page, confirmLabel: RegExp | string) {
  const dialog = page.getByRole("dialog").last();
  for (const box of await dialog.getByRole("checkbox").all()) await box.check();
  await dialog.getByRole("button", { name: confirmLabel }).click();
}

test.describe.serial("live order lifecycle", () => {
  let inviteUrl = "";
  let orderUrl = "";

  test("buyer creates an order with an internal agreement and receives a confirmation link", async ({ browser }) => {
    const page = await signedInPage(browser, buyer);
    await page.goto("/orders?action=create");
    const dialog = page.getByRole("dialog");
    await page.getByLabel("Supplier company name").fill(supplier.name);
    await page.getByLabel("Supplier contact email").fill(supplier.email);
    await page.getByLabel("PO reference").fill(`PO-${stamp.toUpperCase()}`);
    await page.getByLabel("Expected delivery").fill("2026-09-25");
    await page.getByLabel("Delivery location").fill("GreenBite receiving dock");
    await page.getByLabel("Product 1").fill("Cooking oil 5L");
    await page.getByLabel("Quantity 1").fill("100");
    await page.getByLabel("Unit 1").fill("cartons");
    await page.getByLabel("Unit price 1").fill("300");
    await dialog.locator("input[type=file]").first().setInputFiles(fixture("purchase-order.txt"));
    await expect(dialog.getByText("30,000 USDC", { exact: true })).toBeVisible();
    await dialog.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
    await page.getByRole("button", { name: "Send for supplier confirmation" }).click();
    await expect(page.getByRole("heading", { name: /sent for confirmation/ })).toBeVisible();
    inviteUrl = (await page.getByRole("dialog").locator("code").first().textContent()) ?? "";
    expect(inviteUrl).toMatch(/\/orders\/.+\?invite=/);
    await page.getByRole("link", { name: "Open order" }).click();
    await expect(page.getByRole("heading", { name: `PO-${stamp.toUpperCase()}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for supplier confirmation" })).toBeVisible();
    await expect(page.getByText(/Internal agreement, \d+ KB/)).toBeVisible();
    orderUrl = page.url();
    await page.context().close();
  });

  test("supplier confirms through the invitation link and the confirmation is recorded", async ({ browser }) => {
    const page = await signedInPage(browser, supplier);
    await page.goto(inviteUrl);
    await expect(page.getByRole("heading", { name: "Review and confirm the order" })).toBeVisible();
    await page.getByRole("checkbox", { name: /I have reviewed every line/ }).check();
    await page.getByRole("checkbox", { name: /I accept these terms on behalf of/ }).check();
    await page.getByRole("button", { name: "Confirm and accept terms" }).click();
    await expect(page.getByText("The order is confirmed. The buyer funds escrow next.")).toBeVisible();
    await expect(page.getByText(/Confirmed by .*terms version 1\.0/).first()).toBeVisible();
    const buyerOnlySkip = page.getByRole("button", { name: /Only the buyer can use the demo control/ });
    await expect(buyerOnlySkip).toBeDisabled();
    await page.context().close();
  });

  test("buyer funds with the demo control and the supplier ships with carrier details", async ({ browser }) => {
    const page = await signedInPage(browser, buyer);
    await page.goto(orderUrl);
    await expect(page.getByRole("heading", { name: "Fund escrow" })).toBeVisible();
    await page.getByRole("button", { name: "Skip to next step" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for dispatch" })).toBeVisible();
    await page.context().close();

    const supplierPage = await signedInPage(browser, supplier);
    await supplierPage.goto(orderUrl);
    await expect(supplierPage.getByRole("heading", { name: "Ship the goods" })).toBeVisible();
    await supplierPage.getByPlaceholder("DHL 4471 2290 MY").fill("DHL 8812 0044 MY");
    await supplierPage.getByRole("button", { name: "Mark as shipped" }).click();
    await agree(supplierPage, "Mark as shipped");
    await expect(supplierPage.getByText("The order is marked in transit.")).toBeVisible();
    await expect(supplierPage.getByText("DHL 8812 0044 MY").first()).toBeVisible();
    await supplierPage.context().close();
  });

  test("buyer records arrival and opens a claim with evidence from the guided inspection", async ({ browser }) => {
    const page = await signedInPage(browser, buyer);
    await page.goto(orderUrl);
    await expect(page.getByText(/Shipped by DHL Express/)).toBeVisible();
    await page.getByRole("button", { name: "The goods have arrived" }).click();
    await page.getByPlaceholder("DO-2471").fill("DO-9911");
    await agree(page, "Record delivery");
    await expect(page.getByRole("heading", { name: "Check the delivery" })).toBeVisible();
    await expect(page.getByText(/Delivery order DO-9911/).first()).toBeVisible();

    await page.getByRole("radio", { name: /Some items missing or damaged/ }).click();
    await page.getByLabel(/Damaged quantity for Cooking oil 5L/).fill("13");
    await expect(page.getByLabel(/Accepted quantity for Cooking oil 5L/)).toHaveText(/87 cartons/);
    await expect(page.getByText("Held for claim").locator("..").getByText("3,900 USDC")).toBeVisible();
    await page.getByPlaceholder(/13 cartons arrived crushed/).fill("13 cartons arrived crushed and leaking. The driver noted the damage on the signed delivery order.");
    await page.locator("input[type=file]").last().setInputFiles(fixture("delivery-order.txt"));
    await page.getByRole("button", { name: "Open claim without signing (demo)" }).click();
    await agree(page, "Open claim (demo)");
    await expect(page.locator("#claim-title")).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText("Claim opened").first()).toBeVisible();
    await expect(page.getByText(/3,900 USDC/).first()).toBeVisible();
    await page.context().close();
  });

  test("supplier disputes the claim, the AI mediator runs, and the parties can act on the result", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser, supplier);
    await page.goto(orderUrl);
    await expect(page.locator("#claim-title")).toBeVisible();
    await page.getByRole("button", { name: "Dispute with evidence" }).click();
    await page.getByRole("dialog").locator("textarea").fill("Dispatch photos show every carton intact when the goods left our warehouse on 27 August. The carrier signed for them undamaged.");
    await page.getByRole("dialog").locator("input[type=file]").setInputFiles(fixture("dispatch-note.txt"));
    await agree(page, "Submit response");
    await expect(page.getByText("Your response and evidence were recorded. Negotiation is open.")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("In negotiation").first()).toBeVisible();

    await page.getByRole("button", { name: "Request AI mediation" }).click();
    await expect(page.getByText("Mediator is analysing")).toBeVisible();
    await expect(page.getByText("Mediator is analysing")).toHaveCount(0, { timeout: 180_000 });
    const proposal = page.locator(".proposal-ai").first();
    const abstained = page.getByText("The AI mediator did not propose a split.");
    await expect(proposal.or(abstained)).toBeVisible();
    if (await proposal.isVisible()) {
      await expect(proposal.getByText("AI proposal, not binding")).toBeVisible();
      await proposal.getByRole("button", { name: /View mediation report|Show reasoning/ }).click();
      await expect(proposal.getByText(/Findings|DP-|Determination/i).first()).toBeVisible();
      await page.getByRole("button", { name: "Accept proposal" }).click();
      await expect(page.getByText("You accepted the proposal.")).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Propose a split" })).toBeVisible();
    }
    await page.screenshot({ path: "test-results/live-claim.png", fullPage: true });
    await page.context().close();
  });
});

test.describe("sample orders", () => {
  test("buyer funds a confirmed sample order through the agreement dialog", async ({ page }) => {
    await page.goto("/orders/sample-po-2478");
    await expect(page.getByRole("heading", { name: "Fund escrow" })).toBeVisible();
    await page.getByRole("button", { name: "Fund escrow" }).click();
    await agree(page, "Fund escrow");
    await expect(page.getByText("Escrow is funded. The supplier can ship now.")).toBeVisible();
  });

  test("buyer accepts a sample delivery in full and the order settles", async ({ page }) => {
    await page.goto("/orders/sample-po-2471");
    await expect(page.getByRole("heading", { name: "Check the delivery" })).toBeVisible();
    await page.getByRole("radio", { name: /Yes, everything intact/ }).click();
    await page.getByRole("button", { name: /Accept delivery and release 30,000 USDC/ }).click();
    await agree(page, "Release payment");
    await expect(page.getByText("Delivery accepted in full. The whole escrow was released to the supplier.").first()).toBeVisible();
    await expect(page.getByText("Settled", { exact: true }).first()).toBeVisible();
  });

  test("supplier answers a sample claim and both parties settle through mediation", async ({ page }) => {
    await page.goto("/orders/sample-po-2469");
    await expect(page.locator("#claim-title")).toBeVisible();
    await expect(page.getByText("Released to supplier").first()).toBeVisible();
    await page.getByRole("button", { name: "Dispute with evidence" }).click();
    await page.getByRole("dialog").locator("textarea").fill("Dispatch photos show the cartons intact at handover.");
    await agree(page, "Submit response");
    await expect(page.getByText("In negotiation").first()).toBeVisible();
    await page.getByRole("button", { name: "Request AI mediation" }).click();
    await expect(page.locator(".proposal-ai").first()).toBeVisible();
    await page.getByRole("button", { name: "Accept proposal" }).click();
    await expect(page.getByText("You accepted the proposal.")).toBeVisible();
  });

  test("a negotiated sample claim can be countered and escalated", async ({ page }) => {
    await page.goto("/orders/sample-po-2466");
    await expect(page.getByText("Review the AI proposal")).toBeVisible();
    await page.getByRole("button", { name: "Counter with another split" }).click();
    await agree(page, "Send proposal");
    await expect(page.getByText("Your proposal was sent. The other party can accept, reject or counter it.")).toBeVisible();
    await expect(page.getByText(/Waiting for Nordic Cold Chain/)).toBeVisible();
    await page.getByRole("button", { name: "Send to arbitrator" }).click();
    await expect(page.getByText("With arbitrator").first()).toBeVisible();
  });

  test("a settlement-ready sample claim executes", async ({ page }) => {
    await page.goto("/orders/sample-po-2463");
    await expect(page.getByText("Agreed split", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign as supplier" }).click();
    await expect(page.getByRole("button", { name: "Signed", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Execute settlement" }).click();
    await expect(page.getByText("Settlement executed. The record is final.")).toBeVisible();
  });

  test("wallet top-up walks through a card payment and records a pending movement", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByRole("button", { name: /Top up/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("5,000.00").fill("500");
    await dialog.getByRole("radio", { name: /Debit or credit card/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByPlaceholder("4242 4242 4242 4242").fill("4242424242424242");
    await dialog.getByPlaceholder("MM/YY").fill("12/28");
    await dialog.getByPlaceholder("123").fill("123");
    await dialog.locator("input[autocomplete=cc-name]").fill("GreenBite Trading");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: /Pay 507\.5 USDC/ }).click();
    await expect(dialog.getByRole("heading", { name: "Top-up submitted" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Top-ups in progress")).toBeVisible();
  });
});
