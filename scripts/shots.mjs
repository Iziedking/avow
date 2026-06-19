// Drive the built dashboard with the system Chrome and capture submission screenshots:
// the loaded multi-user agent, the reasoning timeline (after a real verify), and the
// per-user "view as" isolation. Run a preview server first, then: node scripts/shots.mjs
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
  defaultViewport: { width: 1320, height: 1500, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  // Never show the intro.
  await page.evaluateOnNewDocument(() => {
    try {
      sessionStorage.setItem("avow-intro", "done");
    } catch {}
  });
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Reveal and load the demo agent.
  await page.waitForSelector(".demo-toggle", { timeout: 20000 });
  await page.click(".demo-toggle");
  await page.waitForSelector(".demo-pill", { timeout: 10000 });
  await page.click(".demo-pill");

  // Wait for the records + the view-as switcher (Owner view, all 6).
  await page.waitForSelector(".viewas", { timeout: 40000 });
  await page.waitForSelector(".records li", { timeout: 40000 });
  await wait(1200);
  await page.screenshot({ path: `${OUT}/01-agent-loaded.png` });
  console.log("shot 1: agent loaded (owner view)");

  // Verify the latest proof in the console; wait for the reasoning timeline to unseal.
  await page.click(".run-btn");
  await page.waitForSelector(".run-reasoning", { timeout: 90000 });
  await wait(1200);
  const run = await page.$(".run");
  await run.screenshot({ path: `${OUT}/02-reasoning.png` });
  console.log("shot 2: reasoning timeline");

  // Switch to "view as Alice" and re-verify, so the console shows HER reasoning, decrypted with
  // HER key, proving the per-user view is real.
  const tabs = await page.$$(".viewas-tab");
  if (tabs[1]) {
    await tabs[1].click();
    await wait(900);
    await page.click(".run-btn");
    await page.waitForFunction(
      () => {
        const g = document.querySelector(".reasoning-goal");
        return g && /Alice/.test(g.textContent || "");
      },
      { timeout: 90000 },
    );
    await wait(1000);
    await page.evaluate(() => {
      const el = document.querySelector(".viewas");
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80 });
    });
    await wait(500);
    await page.screenshot({ path: `${OUT}/03-viewas-alice.png` });
    console.log("shot 3: view as Alice (her own reasoning)");
  }

  // A clean crop of just the view-as block for the isolation note.
  const viewas = await page.$(".viewas");
  if (viewas) {
    await viewas.screenshot({ path: `${OUT}/04-viewas-note.png` });
    console.log("shot 4: view-as note");
  }
} finally {
  await browser.close();
}
