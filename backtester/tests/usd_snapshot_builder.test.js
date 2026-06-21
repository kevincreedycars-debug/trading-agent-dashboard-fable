const test = require("node:test");
const assert = require("node:assert/strict");

const builder = require("../builders/usd/build_usd_historical_snapshots");

function makeSeries(valuesByDate) {
  const rows = Object.entries(valuesByDate).map(([observation_date, value_numeric]) => ({
    observation_date,
    value_numeric
  }));
  return builder.buildSeriesMap(rows);
}

test("Snapshot builder uses real de_2y_yield and calculates US-DE 2Y spread correctly", () => {
  const context = {
    events: [],
    logicDocumentVersion: "test-version",
    series: {
      us_2y_yield: makeSeries({
        "2024-01-02": 4.33,
        "2024-01-03": 4.36,
        "2024-01-04": 4.37,
        "2024-01-05": 4.38,
        "2024-01-08": 4.40,
        "2024-01-09": 4.45
      }),
      us_10y_yield: makeSeries({
        "2024-01-02": 3.95,
        "2024-01-03": 3.97,
        "2024-01-04": 3.96,
        "2024-01-05": 3.98,
        "2024-01-08": 4.00,
        "2024-01-09": 4.02
      }),
      us_10y_real_yield: makeSeries({
        "2024-01-02": 1.80,
        "2024-01-03": 1.81,
        "2024-01-04": 1.83,
        "2024-01-05": 1.84,
        "2024-01-08": 1.86,
        "2024-01-09": 1.88
      }),
      vix_level: makeSeries({
        "2024-01-02": 13.2,
        "2024-01-03": 13.4,
        "2024-01-04": 13.7,
        "2024-01-05": 13.1,
        "2024-01-08": 12.9,
        "2024-01-09": 13.0
      }),
      dxy_level: makeSeries({
        "2024-01-02": 101.0,
        "2024-01-03": 101.2,
        "2024-01-04": 101.3,
        "2024-01-05": 101.4,
        "2024-01-08": 101.5,
        "2024-01-09": 101.7
      }),
      de_2y_yield: makeSeries({
        "2024-01-02": 2.33,
        "2024-01-03": 2.34,
        "2024-01-04": 2.35,
        "2024-01-05": 2.36,
        "2024-01-08": 2.37,
        "2024-01-09": 2.40
      }),
      gold_spot_usd: makeSeries({
        "2024-01-02": 2060,
        "2024-01-03": 2058,
        "2024-01-04": 2062,
        "2024-01-05": 2068,
        "2024-01-08": 2070,
        "2024-01-09": 2065
      }),
      qqq_nq_proxy: makeSeries({
        "2024-01-02": 400,
        "2024-01-03": 401,
        "2024-01-04": 402,
        "2024-01-05": 404,
        "2024-01-08": 406,
        "2024-01-09": 407
      })
    }
  };

  const row = builder.buildSnapshotRow("2024-01-09", context);

  assert.equal(row.de_2y_yield, 2.4);
  assert.ok(Math.abs(row.us_de_2y_spread - 2.05) < 1e-9);
  assert.ok(Math.abs(row.us_de_2y_spread_d5_bps - 5) < 1e-9);
  assert.equal(row.history_rows_used.de_2y_yield, 1);
  assert.ok(!row.warnings.includes("missing_de_2y_yield"));
});

test("Snapshot builder does not silently fall back to placeholder Germany 2Y data", () => {
  const context = {
    events: [],
    logicDocumentVersion: "test-version",
    series: {
      us_2y_yield: makeSeries({
        "2024-01-02": 4.33,
        "2024-01-03": 4.36,
        "2024-01-04": 4.37,
        "2024-01-05": 4.38,
        "2024-01-08": 4.40,
        "2024-01-09": 4.45
      }),
      us_10y_yield: makeSeries({ "2024-01-09": 4.02 }),
      us_10y_real_yield: makeSeries({
        "2024-01-02": 1.80,
        "2024-01-03": 1.81,
        "2024-01-04": 1.83,
        "2024-01-05": 1.84,
        "2024-01-08": 1.86,
        "2024-01-09": 1.88
      }),
      vix_level: makeSeries({
        "2024-01-02": 13.2,
        "2024-01-03": 13.4,
        "2024-01-04": 13.7,
        "2024-01-05": 13.1,
        "2024-01-08": 12.9,
        "2024-01-09": 13.0
      }),
      dxy_level: makeSeries({
        "2024-01-02": 101.0,
        "2024-01-03": 101.2,
        "2024-01-04": 101.3,
        "2024-01-05": 101.4,
        "2024-01-08": 101.5,
        "2024-01-09": 101.7
      }),
      de_2y_yield: makeSeries({}),
      gold_spot_usd: makeSeries({
        "2024-01-02": 2060,
        "2024-01-03": 2058,
        "2024-01-04": 2062,
        "2024-01-05": 2068,
        "2024-01-08": 2070,
        "2024-01-09": 2065
      }),
      qqq_nq_proxy: makeSeries({
        "2024-01-02": 400,
        "2024-01-03": 401,
        "2024-01-04": 402,
        "2024-01-05": 404,
        "2024-01-08": 406,
        "2024-01-09": 407
      })
    }
  };

  const row = builder.buildSnapshotRow("2024-01-09", context);

  assert.equal(row.de_2y_yield, null);
  assert.equal(row.us_de_2y_spread, null);
  assert.equal(row.us_de_2y_spread_d5_bps, null);
  assert.ok(row.missing_raw_series.includes("de_2y_yield"));
  assert.ok(row.warnings.includes("missing_de_2y_yield"));
});
