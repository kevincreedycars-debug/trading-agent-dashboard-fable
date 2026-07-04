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

    const browserPairContract = await page.evaluate(() => {
      const result = globalThis.Layer2PairLogic.deriveLayer2PairSignal({
        instrument: "TEST/USD",
        targetDirection: "BEARISH",
        usdDirection: "BULLISH",
        targetConfidence: 42,
        usdConfidence: 86
      });

      return {
        tradable: result.tradable,
        direction: result.direction,
        combinedConfidence: result.combinedConfidence,
        strengthBucket: result.strengthBucket,
        strengthBucketKey: result.strengthBucketKey
      };
    });

    if (
      browserPairContract.tradable !== true
      || browserPairContract.direction !== "SELL"
      || browserPairContract.combinedConfidence !== 42
      || browserPairContract.strengthBucketKey !== "WEAK"
      || browserPairContract.strengthBucket !== "Weak"
    ) {
      throw new Error(`Browser Layer 2 pair contract failed.\n${JSON.stringify(browserPairContract, null, 2)}`);
    }

    await page.getByRole("button", { name: "Pair Analysis" }).click();
    await page.waitForSelector("text=Layer 2 Trade Selection", { timeout: 15000 });
    const layer2Text = await page.locator("#layer2View").innerText();
    const normalizedLayer2Text = layer2Text.toLowerCase();

    if (!normalizedLayer2Text.includes("combined confidence is always the lower layer 1 confidence")) {
      throw new Error(`Layer 2 live summary did not render the min-confidence invariant.\n${layer2Text}`);
    }

    if (!normalizedLayer2Text.includes("no trade") || !normalizedLayer2Text.includes("target 24h signal is non-directional")) {
      throw new Error(`Layer 2 live cards did not render expected tradable/no-trade state.\n${layer2Text}`);
    }

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

    if (!normalizedPairTradeText.includes("trade days % = the share of matched historical days where the pair logic produced an actual tradable signal")) {
      throw new Error(`Layer 2 Pair Summary helper copy did not render.\n${pairTradeText}`);
    }

    const topSummaryRowCount = await page.locator("[data-layer2-pair-summary-row]").count();
    if (topSummaryRowCount !== 4) {
      throw new Error(`Expected 4 Layer 2 summary rows, found ${topSummaryRowCount}.`);
    }

    const topSummaryGridColumns = await page.locator("[data-layer2-pair-summary='comparison-grid']").evaluate((element) => {
      const columns = getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean);
      return columns.length;
    });
    if (topSummaryGridColumns < 3) {
      throw new Error(`Layer 2 Pair Summary did not render as a compact comparison grid.\nColumns: ${topSummaryGridColumns}`);
    }

    const legacySummaryTableCount = await page.locator("[data-layer2-pair-summary='true'], .layer2-pair-summary-table").count();
    if (legacySummaryTableCount !== 0) {
      throw new Error(`Legacy Layer 2 summary table still rendered.\nCount: ${legacySummaryTableCount}`);
    }

    const legacySummaryCardCount = await page.locator("[data-layer2-pair-summary-card]").count();
    if (legacySummaryCardCount !== 0) {
      throw new Error(`Legacy Layer 2 summary cards still rendered.\nCount: ${legacySummaryCardCount}`);
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

    await page.getByRole("button", { name: "ADR Reach Research" }).click();
    await page.waitForSelector("[data-adr-reach-layer1-summary='true']", { timeout: 15000 });
    const adrReachText = await page.locator("#backtestPanel").innerText();
    const normalizedAdrReachText = adrReachText.toLowerCase();

    if (!adrReachText.includes("Intraday target-reach research from existing checker artifacts")) {
      throw new Error(`ADR Reach Research tab header did not render.\n${adrReachText}`);
    }

    if (!normalizedAdrReachText.includes("layer 1 adr reach summary") || !normalizedAdrReachText.includes("layer 2 adr reach summary")) {
      throw new Error(`ADR Reach Research summary tables did not render.\n${adrReachText}`);
    }

    if (!normalizedAdrReachText.includes("50% rolling adr20 target in the predicted direction")) {
      throw new Error(`ADR Reach Research did not render the expected research note copy.\n${adrReachText}`);
    }

    if (!normalizedAdrReachText.includes("nq adr reach from layer 1 checker artifacts") || !normalizedAdrReachText.includes("nq/usd from existing pair trade research signal selection")) {
      throw new Error(`ADR Reach Research did not render the supported NQ detail sections.\n${adrReachText}`);
    }

    if (!normalizedAdrReachText.includes("confidence breakdown") || !normalizedAdrReachText.includes("weekday totals across all confidence buckets") || !normalizedAdrReachText.includes("by confidence bucket and weekday")) {
      throw new Error(`ADR Reach Research did not render the required detail tables.\n${adrReachText}`);
    }

    for (const expectedAvailableText of [
      "eur adr reach from layer 1 checker artifacts",
      "nq adr reach from layer 1 checker artifacts",
      "btc adr reach from layer 1 checker artifacts",
      "eur/usd from existing pair trade research signal selection",
      "nq/usd from existing pair trade research signal selection",
      "btc/usd from existing pair trade research signal selection"
    ]) {
      if (!normalizedAdrReachText.includes(expectedAvailableText)) {
        throw new Error(`ADR Reach Research did not render expected available section: ${expectedAvailableText}\n${adrReachText}`);
      }
    }

    for (const expectedUnavailableText of [
      "layer 1 unavailable reasons",
      "layer 2 unavailable reasons",
      "adr unavailable source blockers"
    ]) {
      if (!normalizedAdrReachText.includes(expectedUnavailableText)) {
        throw new Error(`ADR Reach Research did not preserve expected unavailable section: ${expectedUnavailableText}\n${adrReachText}`);
      }
    }

    const adrUnavailableAuditText = (await page.locator("[data-adr-unavailable-audit='true']").textContent() || "").toLowerCase();
    if (!adrUnavailableAuditText.includes("no repo-local dxy ohlc export is available")) {
      throw new Error(`ADR unavailable audit details did not preserve the USD/DXY blocker.\n${adrUnavailableAuditText}`);
    }

    if (normalizedAdrReachText.includes("no repo-local eurusd ohlc source") || normalizedAdrReachText.includes("repository evidence only includes eurusd close-only lineage")) {
      throw new Error(`ADR Reach Research still rendered stale EUR unavailable copy.\n${adrReachText}`);
    }

    if (normalizedAdrReachText.includes("no repo-local btc ohlc source") || normalizedAdrReachText.includes("repository evidence only includes btc close-only coinbase spot lineage")) {
      throw new Error(`ADR Reach Research still rendered stale BTC unavailable copy.\n${adrReachText}`);
    }

    const adrAuditText = (await page.locator("[data-adr-reach-layer1-summary='true']").innerText()).toLowerCase();
    for (const expectedAuditText of [
      "eur/usd daily ohlc csv from alpha vantage fx_daily",
      "btc/usd daily ohlc csv from coinbase exchange candles",
      "qqq ohlc daily proxy csv"
    ]) {
      if (!adrAuditText.includes(expectedAuditText)) {
        throw new Error(`Warehouse Audit did not render current OHLC source text: ${expectedAuditText}\n${adrAuditText}`);
      }
    }

    const adrSummaryTableText = (await page.locator(".adr-summary-table").allInnerTexts()).join("\n").toLowerCase();
    for (const forbiddenAdrTableString of [
      "50% adr20 target",
      "stored displayed headline confidence",
      "combined confidence bucket",
      " losses",
      " total",
      "65+ confidence"
    ]) {
      if (adrSummaryTableText.includes(forbiddenAdrTableString)) {
        throw new Error(`ADR summary tables still included verbose repeated copy: ${forbiddenAdrTableString}\n${adrSummaryTableText}`);
      }
    }

    const adrConfidenceTableText = (await page.locator(".adr-confidence-table").allInnerTexts()).join("\n").toLowerCase();
    for (const forbiddenConfidenceTableString of [
      "50% adr20 target",
      "stored displayed headline confidence",
      "combined confidence bucket"
    ]) {
      if (adrConfidenceTableText.includes(forbiddenConfidenceTableString)) {
        throw new Error(`ADR confidence tables still included verbose repeated copy: ${forbiddenConfidenceTableString}\n${adrConfidenceTableText}`);
      }
    }

    const adrHeadingMatches = adrReachText.match(/ADR Reach Research/g) || [];
    if (adrHeadingMatches.length > 1) {
      throw new Error(`ADR Reach Research heading was repeated too many times.\nCount: ${adrHeadingMatches.length}\n${adrReachText}`);
    }

    const adrReachNqHeaders = await page.locator("[data-adr-reach-asset='NQ'] thead th").allInnerTexts();
    const normalizedAdrReachNqHeaders = adrReachNqHeaders.map(text => text.trim().toLowerCase());
    if (normalizedAdrReachNqHeaders.includes("saturday") || normalizedAdrReachNqHeaders.includes("sunday")) {
      throw new Error(`NQ ADR weekday table unexpectedly included weekend columns.\n${adrReachNqHeaders.join(" | ")}`);
    }

    const adrReachPairHeaders = await page.locator("[data-adr-reach-pair='NQ_USD'] thead th").allInnerTexts();
    const normalizedAdrReachPairHeaders = adrReachPairHeaders.map(text => text.trim().toLowerCase());
    if (normalizedAdrReachPairHeaders.includes("saturday") || normalizedAdrReachPairHeaders.includes("sunday")) {
      throw new Error(`NQ/USD ADR weekday table unexpectedly included weekend columns.\n${adrReachPairHeaders.join(" | ")}`);
    }

    const adrSummaryOverflow = await page.locator(".adr-summary-scroll").first().evaluate((element) => getComputedStyle(element).overflowX);
    if (adrSummaryOverflow !== "auto" && adrSummaryOverflow !== "scroll") {
      throw new Error(`ADR summary table wrapper did not allow horizontal scrolling.\nOverflowX: ${adrSummaryOverflow}`);
    }

    const adrSummaryPercentWhiteSpace = await page.locator(".adr-summary-table .adr-table-tight-cell strong").first().evaluate((element) => getComputedStyle(element).whiteSpace);
    if (adrSummaryPercentWhiteSpace !== "nowrap") {
      throw new Error(`ADR summary percentage values were still wrapping.\nwhite-space: ${adrSummaryPercentWhiteSpace}`);
    }

    const adrSummaryLastCellPadding = await page.locator(".adr-summary-table td:last-child").first().evaluate((element) => getComputedStyle(element).paddingRight);
    if (parseFloat(adrSummaryLastCellPadding) < 16) {
      throw new Error(`ADR summary last column padding is too small.\nPaddingRight: ${adrSummaryLastCellPadding}`);
    }

    if (consoleErrors.length) {
      throw new Error(`Console errors were emitted during dashboard smoke.\n${consoleErrors.join("\n")}`);
    }

    console.log(JSON.stringify({
      status: "PASS",
      target: "Accuracy tables, checker, weekday, pair trade, and ADR reach research",
      matrix_summary_excerpt: summaryText,
      btc_weekday_headers: btcWeekdayHeaders,
      usd_weekday_headers: usdWeekdayHeaders,
      pair_trade_btc_headers: pairTradeBtcHeaders,
      adr_reach_nq_headers: adrReachNqHeaders,
      adr_reach_pair_headers: adrReachPairHeaders,
      pair_trade_grid_columns: firstPairGridColumns,
      pair_trade_overflow_x: pairBucketOverflow,
      top_summary_row_count: topSummaryRowCount,
      top_summary_grid_columns: topSummaryGridColumns
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
