// Capture the in-app docs (the Overview, including the "Why this matters" pull-quote).
// Preview on :4400, then: node scripts/shot-docs.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.env.SHOT_URL || "http://localhost:4400/?app";
const OUT = ".firecrawl/shots";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  defaultViewport: { width: 1320, height: 1450, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      sessionStorage.setItem("avow-intro", "done");
    } catch {}
  });
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector(".foot-docs", { timeout: 20000 });
  await page.click(".foot-docs");
  await page.waitForSelector(".doc-quote", { timeout: 10000 });
  await wait(700);

  const shell = await page.$(".doc-shell");
  await shell.screenshot({ path: `${OUT}/05-docs-overview.png` });
  console.log("shot 5: docs overview");

  // Scroll to the "Why this matters" quote and capture it in context.
  await page.evaluate(() => {
    const main = document.querySelector(".doc-main");
    const q = document.querySelector(".doc-quote");
    if (main && q) main.scrollTop = q.offsetTop - 120;
  });
  await wait(500);
  await shell.screenshot({ path: `${OUT}/06-docs-why.png` });
  console.log("shot 6: docs why-this-matters");
} finally {
  await browser.close();
}
