const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const rootDir = __dirname;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(rootDir, relativePath);

    if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(fs.readFileSync(filePath));
  });
}

async function run() {
  const server = createServer();
  await new Promise((resolve) => server.listen(4173, "127.0.0.1", resolve));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Backtest / Accuracy" }).click();
    await page.getByRole("button", { name: "Accuracy Tables" }).click();

    await page.waitForSelector("text=Gold 24H direction by strength", { timeout: 15000 });
    await page.waitForSelector("text=NQ 24H direction by strength", { timeout: 15000 });
    await page.waitForSelector("text=BTC 24H direction by strength", { timeout: 15000 });
    await page.waitForTimeout(2000);
    const backtestText = await page.locator("#backtestPanel").innerText();

    if (backtestText.includes("Research view unavailable") || backtestText.includes("Research data unavailable")) {
      throw new Error(`Backtest panel fell back to full error state after ancillary 500.\n${backtestText}`);
    }

    const goldMatrixIndex = 2;
    const summaryText = await page.locator(".matrix-summary-grid").nth(goldMatrixIndex).innerText();
    const normalizedSummary = summaryText.toUpperCase();

    if (
      !normalizedSummary.includes("CORRECT") || !normalizedSummary.includes("223")
      || !normalizedSummary.includes("WRONG") || !normalizedSummary.includes("173")
      || !normalizedSummary.includes("FLAT") || !normalizedSummary.includes("141")
      || !normalizedSummary.includes("NO CALL") || !normalizedSummary.includes("26")
      || !normalizedSummary.includes("NOT EVALUABLE") || !normalizedSummary.includes("45")
    ) {
      throw new Error(`Gold matrix summary did not include expected totals.\n${summaryText}`);
    }

    if (!backtestText.includes("BTC 24H direction by strength")) {
      throw new Error(`BTC matrix section did not render.\n${backtestText}`);
    }

    await page.getByRole("button", { name: "Backtest Checker" }).click();
    await page.waitForSelector("text=BTC 24H", { timeout: 15000 });
    const checkerText = await page.locator("#backtestPanel").innerText();

    if (!checkerText.includes("BTC 24H")) {
      throw new Error(`BTC checker section did not render.\n${checkerText}`);
    }

    await page.getByRole("button", { name: "Weekday Breakdown" }).click();
    await page.waitForSelector("[data-weekday-breakdown-asset='BTC']", { timeout: 15000 });
    const weekdayText = await page.locator("#backtestPanel").innerText();

    if (!weekdayText.includes("Day-of-week performance by displayed headline confidence")) {
      throw new Error(`Weekday Breakdown tab header did not render.\n${weekdayText}`);
    }

    const btcWeekdayHeaders = await page.locator("[data-weekday-breakdown-asset='BTC'] thead th").allInnerTexts();
    const usdWeekdayHeaders = await page.locator("[data-weekday-breakdown-asset='USD'] thead th").allInnerTexts();

    const normalizedBtcHeaders = btcWeekdayHeaders.map(text => text.trim().toLowerCase());
    const normalizedUsdHeaders = usdWeekdayHeaders.map(text => text.trim().toLowerCase());

    if (!normalizedBtcHeaders.includes("saturday") || !normalizedBtcHeaders.includes("sunday")) {
      throw new Error(`BTC weekday table did not include weekend columns.\n${btcWeekdayHeaders.join(" | ")}`);
    }

    if (normalizedUsdHeaders.includes("saturday") || normalizedUsdHeaders.includes("sunday")) {
      throw new Error(`USD weekday table unexpectedly included weekend columns.\n${usdWeekdayHeaders.join(" | ")}`);
    }

    if (consoleErrors.length) {
      throw new Error(`Console errors were emitted during dashboard smoke.\n${consoleErrors.join("\n")}`);
    }

    console.log(JSON.stringify({
      status: "PASS",
      target: "Accuracy tables, checker, and weekday breakdown",
      matrix_summary_excerpt: summaryText,
      btc_weekday_headers: btcWeekdayHeaders,
      usd_weekday_headers: usdWeekdayHeaders
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error("Dashboard smoke failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
