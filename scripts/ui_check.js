// Browser smoke test of the deployed page (real Pyodide worker).
//   python -m http.server -d web 8000 &  node scripts/ui_check.js http://127.0.0.1:8000/
const { chromium } = require("playwright");
(async () => {
  const url = process.argv[2] || "http://127.0.0.1:8000/";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector("#loader", { state: "hidden", timeout: 240000 });
  console.log(`engine ready after ${(Date.now() - t0) / 1000} s:`, await page.textContent("#status"));
  await page.waitForSelector("#tiles .tile", { timeout: 120000 });
  console.log("first result:", await page.textContent("#timing"), "|", await page.textContent("#trap-banner"));
  // warm recompute after a parameter change (beam cached)
  await page.fill("#radius", "120");
  await page.waitForSelector("#spinner", { state: "visible", timeout: 5000 }).catch(() => {});
  await page.waitForSelector("#spinner", { state: "hidden", timeout: 120000 });
  console.log("after radius change:", await page.textContent("#timing"));
  await page.screenshot({ path: "ui_check.png", fullPage: true });
  await browser.close();
  if (errors.length) { console.error("page errors:", errors); process.exit(1); }
})();
