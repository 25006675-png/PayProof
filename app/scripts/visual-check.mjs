import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const appUrl = "http://127.0.0.1:4173";
let localServer;
try {
  await fetch(appUrl);
} catch {
  localServer = spawn(
    process.execPath,
    [
      resolve("node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(appUrl);
      if (response.ok) break;
    } catch {
      if (attempt === 39) throw new Error("The visual-check server did not start.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});

const outputDir = resolve("..", "artifacts");
const axePath = resolve("node_modules", "axe-core", "axe.min.js");
await mkdir(outputDir, { recursive: true });
const results = [];

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.addScriptTag({ path: axePath });
  const diagnostics = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    unnamedButtons: [...document.querySelectorAll("button")]
      .filter(
        (button) =>
          !(button.getAttribute("aria-label") || button.textContent?.trim()),
      )
      .length,
    inputsWithoutLabel: [...document.querySelectorAll("input, textarea")]
      .filter((input) => !input.closest("label") && !input.getAttribute("aria-label"))
      .length,
  }));
  const paymentA11y = await page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return report.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.length,
    }));
  });

  await page.screenshot({
    path: resolve(outputDir, `${viewport.name}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Verify" }).click();
  await page.getByRole("heading", { name: "Verify a receipt" }).waitFor();
  const verifyA11y = await page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return report.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.length,
    }));
  });
  await page.screenshot({
    path: resolve(outputDir, `${viewport.name}-verify.png`),
    fullPage: true,
  });

  results.push({
    viewport: viewport.name,
    diagnostics,
    accessibility: { payment: paymentA11y, verify: verifyA11y },
    errors,
  });
  await page.close();
}

await browser.close();
localServer?.kill();
console.log(JSON.stringify(results, null, 2));

const failed = results.some(
  ({ diagnostics, accessibility, errors }) =>
    diagnostics.horizontalOverflow ||
    diagnostics.unnamedButtons > 0 ||
    diagnostics.inputsWithoutLabel > 0 ||
    accessibility.payment.length > 0 ||
    accessibility.verify.length > 0 ||
    errors.length > 0,
);
if (failed) process.exitCode = 1;
