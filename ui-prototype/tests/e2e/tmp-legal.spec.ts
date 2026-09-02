import { expect, test } from "@playwright/test";

test("legal documents and consent", async ({ page }) => {
  await page.goto("/legal/dispute-policy");
  await expect(page.getByRole("heading", { name: "PayProof Dispute Resolution Policy" })).toBeVisible();
  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { name: "PayProof Platform Terms of Service" })).toBeVisible();
  await page.goto("/");
  const consent = page.getByText(/By continuing you agree to the/).first();
  await consent.scrollIntoViewIfNeeded();
  await expect(consent).toBeVisible();
  await expect(consent.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(consent.getByRole("link", { name: "Dispute Resolution Policy" })).toBeVisible();
});
