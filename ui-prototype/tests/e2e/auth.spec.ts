import { expect, test } from "@playwright/test";

test("shows both authentication paths directly on the landing page", async ({ page }) => {
  await page.goto("/#access");
  const google = page.getByRole("button", { name: /continue with google/i });
  const wallet = page.getByText("Connect existing Sui wallet", { exact: true });
  await expect(google).toBeVisible();
  await expect(wallet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const googleBox = await google.boundingBox();
  const walletBox = await wallet.boundingBox();
  expect(googleBox).not.toBeNull();
  expect(walletBox).not.toBeNull();
  expect(googleBox!.y).toBeLessThan(walletBox!.y);
});

test("starts Google OIDC with a Sui-bound nonce and an app callback", async ({ page }) => {
  await page.goto("/#access");
  const appOrigin = new URL(page.url()).origin;
  const authorizationRequest = page.waitForRequest((request) =>
    request.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth"),
  );
  await page.getByRole("button", { name: /continue with google/i }).click();
  const request = await authorizationRequest;
  const requestUrl = new URL(request.url());
  expect(requestUrl.searchParams.get("client_id")).toMatch(/\.apps\.googleusercontent\.com$/);
  expect(requestUrl.searchParams.get("redirect_uri")).toBe(`${appOrigin}/auth/callback`);
  expect(requestUrl.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{27}$/);
  expect(requestUrl.searchParams.get("state")).toBeTruthy();

  await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
  await expect(page.getByText(/redirect_uri_mismatch/i)).toHaveCount(0);
});

test("authenticates an existing Sui wallet through a signed challenge", async ({ page }) => {
  await page.goto("/#access");
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: /unsafe burner wallet/i }).click();
  await expect(page.getByText("Connected address", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /sign in with this wallet/i }).click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("proofpay_demo_session"))).not.toBeNull();
});

test("shows a recoverable callback error for invalid OAuth state", async ({ page }) => {
  await page.goto("/auth/callback#id_token=invalid&state=invalid");
  await expect(page.getByRole("heading", { name: "Sign-in needs attention" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to sign in" })).toBeVisible();
});

test("explains how to recover from Supabase nonce configuration", async ({ page }) => {
  await page.route("**/auth/v1/token?grant_type=id_token", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ message: "Passed nonce and nonce in id_token should either both exist or not." }),
  }));
  await page.addInitScript(() => sessionStorage.setItem("payproof_zklogin_pending", JSON.stringify({
    state: "nonce-test",
    ephemeralSecretKey: "unused",
    ephemeralPublicKey: "unused",
    randomness: "1",
    maxEpoch: 1,
    returnTo: "/workspace",
  })));
  await page.goto(`/auth/callback#id_token=${"x".repeat(120)}&state=nonce-test`);
  await expect(page.getByText(/enable Skip nonce check/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to sign in" })).toBeVisible();
});

test("identifies an unavailable PayProof backend after Google succeeds", async ({ page }) => {
  await page.route("**/auth/v1/token?grant_type=id_token", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "buyer@example.com",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: { full_name: "Test Buyer" },
        created_at: new Date().toISOString(),
      },
    }),
  }));
  await page.route("http://localhost:8787/v1/auth/zklogin/complete", (route) => route.abort("connectionrefused"));
  await page.addInitScript(() => sessionStorage.setItem("payproof_zklogin_pending", JSON.stringify({
    state: "backend-test",
    ephemeralSecretKey: "unused",
    ephemeralPublicKey: "unused",
    randomness: "1",
    maxEpoch: 1,
    returnTo: "/workspace",
  })));

  await page.goto(`/auth/callback#id_token=${"x".repeat(120)}&state=backend-test`);

  await expect(page.getByText(/Google sign-in succeeded, but the PayProof service is unavailable/i)).toBeVisible();
  await expect(page.getByText(/port 8787/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to sign in" })).toBeVisible();
});

test("keeps both sign-in paths visible without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#access");
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.getByText("Connect existing Sui wallet", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
