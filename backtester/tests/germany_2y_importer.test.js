const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const importer = require("../importers/germany_2y/import_germany_2y");

const fixturePath = path.join(__dirname, "fixtures", "bundesbank_de2y_sample.csv");
const fixtureText = fs.readFileSync(fixturePath, "utf8");

test("Germany 2Y importer parses Bundesbank CSV format", () => {
  const parsed = importer.parseSourceRecords(fixtureText, {
    vendorName: "Bundesbank",
    vendorSymbol: "BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A"
  });

  assert.equal(parsed.sourceFormat, "bundesbank_csv");
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(parsed.records[0], {
    date: "2018-01-02",
    value: "-0.64",
    source_symbol: "BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A",
    source_name: "Yields"
  });
});

test("Germany 2Y importer rejects rows with missing dates or values and normalizes to de_2y_yield", () => {
  const records = [
    { date: "2018-01-02", value: "2.41", source_symbol: "DE2Y", source_name: "Bundesbank" },
    { date: "", value: "2.42", source_symbol: "DE2Y", source_name: "Bundesbank" },
    { date: "2018-01-03", value: ".", source_symbol: "DE2Y", source_name: "Bundesbank" }
  ];

  const result = importer.buildRows(records, "manifest-1", {
    decimalComma: false,
    endDate: "2018-12-31",
    startDate: "2018-01-01",
    valueScale: "percent",
    vendorSymbol: "DE2Y"
  });

  assert.equal(result.prepared.length, 1);
  assert.equal(result.skippedMissing, 1);
  assert.equal(result.prepared[0].series_key, "de_2y_yield");
  assert.equal(result.prepared[0].value_numeric, 2.41);
});

test("Germany 2Y importer applies percent scaling from basis points correctly", () => {
  const result = importer.buildRows(
    [{ date: "2018-01-02", value: "241", source_symbol: "DE2Y", source_name: "Bundesbank" }],
    "manifest-1",
    {
      decimalComma: false,
      endDate: "2018-12-31",
      startDate: "2018-01-01",
      valueScale: "bps",
      vendorSymbol: "DE2Y"
    }
  );

  assert.equal(result.prepared.length, 1);
  assert.equal(result.prepared[0].value_numeric, 2.41);
});

test("Germany 2Y preview mode does not require Supabase", () => {
  const output = childProcess.execFileSync(
    process.execPath,
    [
      path.join(__dirname, "..", "importers", "germany_2y", "import_germany_2y.js"),
      `--file=${fixturePath}`,
      "--preview-only=true",
      "--start=2018-01-01",
      "--end=2018-12-31"
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      env: {}
    }
  ).toString();

  const parsed = JSON.parse(output);
  assert.equal(parsed.mode, "preview");
  assert.equal(parsed.source_format, "bundesbank_csv");
  assert.equal(parsed.prepared_rows, 3);
  assert.equal(parsed.skipped_missing, 1);
});
