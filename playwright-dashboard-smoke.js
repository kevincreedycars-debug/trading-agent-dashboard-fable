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
    const normalizedWeekdayText = weekdayText.toLowerCase();

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

    if (!normalizedWeekdayText.includes("ex-flat")) {
      throw new Error(`Weekday Breakdown did not render ex-flat rate copy.\n${weekdayText}`);
    }

    if (!weekdayText.includes("W /") || !weekdayText.includes("L /") || !weekdayText.includes("F /") || !weekdayText.includes("T")) {
      throw new Error(`Weekday Breakdown did not render W/L/F/T count lines.\n${weekdayText}`);
    }

    if (!normalizedWeekdayText.includes("day totals") || !normalizedWeekdayText.includes("all confidence buckets")) {
      throw new Error(`Weekday Breakdown did not render day-level totals above the bucket table.\n${weekdayText}`);
    }

    if (!normalizedWeekdayText.includes("flat rate") || !normalizedWeekdayText.includes("ex-flat win rate")) {
      throw new Error(`Weekday Breakdown summary totals did not render flat-aware metrics.\n${weekdayText}`);
    }

    await page.getByRole("button", { name: "Pair Trade Research" }).click();
    await page.waitForSelector("[data-pair-trade-asset='EUR_USD']", { timeout: 15000 });
    const pairTradeText = await page.locator("#backtestPanel").innerText();
    const normalizedPairTradeText = pairTradeText.toLowerCase();

    if (!pairTradeText.includes("Layer 2 pair confirmation research from Layer 1 checker artifacts")) {
      throw new Error(`Pair Trade Research tab header did not render.\n${pairTradeText}`);
    }

    if (!pairTradeText.includes("EUR/USD") || !normalizedPairTradeText.includes("conflict / no-trade summary")) {
      throw new Error(`Pair Trade Research did not render expected pair sections.\n${pairTradeText}`);
    }

    if (!normalizedPairTradeText.includes("layer 2 pair summary") || !normalizedPairTradeText.includes("strong+")) {
      throw new Error(`Layer 2 Pair Summary did not render above the pair sections.\n${pairTradeText}`);
    }

    const pairSectionOrder = await page.locator("#backtestPanel .pair-trade-summary-section, #backtestPanel .pair-trade-section").evaluateAll((elements) => {
      return elements.map((element) => element.className);
    });
    if (!pairSectionOrder.length || !String(pairSectionOrder[0]).includes("pair-trade-summary-section")) {
      throw new Error(`Layer 2 Pair Summary did not appear before the detailed pair sections.\n${pairSectionOrder.join(" | ")}`);
    }

    const pairSummaryGridCount = await page.locator("[data-pair-trade-card-grid]").count();
    if (pairSummaryGridCount !== 4) {
      throw new Error(`Expected 4 pair summary-card grids, found ${pairSummaryGridCount}.`);
    }

    const firstPairGridColumns = await page.locator("[data-pair-trade-card-grid='EUR_USD']").evaluate((element) => {
      const columns = getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean);
      return columns.length;
    });
    if (firstPairGridColumns < 4) {
      throw new Error(`Pair summary cards did not render as a desktop multi-column grid.\nColumns: ${firstPairGridColumns}`);
    }

    const pairBucketOverflow = await page.locator(".pair-trade-table-scroll").first().evaluate((element) => getComputedStyle(element).overflowX);
    if (pairBucketOverflow !== "auto" && pairBucketOverflow !== "scroll") {
      throw new Error(`Pair confidence bucket table wrapper did not allow horizontal scrolling.\nOverflowX: ${pairBucketOverflow}`);
    }

    const pairBucketWhiteSpace = await page.locator(".pair-trade-bucket-table td:nth-child(3) .research-cell strong").first().evaluate((element) => getComputedStyle(element).whiteSpace);
    if (pairBucketWhiteSpace !== "nowrap") {
      throw new Error(`Pair confidence bucket percentage values were still wrapping.\nwhite-space: ${pairBucketWhiteSpace}`);
    }

    const pairTradeBtcHeaders = await page.locator("[data-pair-trade-asset='BTC_USD'] thead th").allInnerTexts();
    const normalizedPairTradeBtcHeaders = pairTradeBtcHeaders.map(text => text.trim().toLowerCase());

    if (!normalizedPairTradeBtcHeaders.includes("saturday") || !normalizedPairTradeBtcHeaders.includes("sunday")) {
      throw new Error(`BTC/USD pair trade breakdown did not include weekend columns.\n${pairTradeBtcHeaders.join(" | ")}`);
    }

    if (consoleErrors.length) {
      throw new Error(`Console errors were emitted during dashboard smoke.\n${consoleErrors.join("\n")}`);
    }

    console.log(JSON.stringify({
      status: "PASS",
      target: "Accuracy tables, checker, and weekday breakdown",
      matrix_summary_excerpt: summaryText,
      btc_weekday_headers: btcWeekdayHeaders,
      usd_weekday_headers: usdWeekdayHeaders,
      pair_trade_btc_headers: pairTradeBtcHeaders,
      pair_trade_grid_columns: firstPairGridColumns,
      pair_trade_overflow_x: pairBucketOverflow
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
