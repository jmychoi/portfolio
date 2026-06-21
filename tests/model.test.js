const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const Model = require(path.join(__dirname, "..", "explorer", "model.js"));

const CSV = [
  "Asset,Type,Market,Sector,Risk,Currency,FX Rate CAD,Yield,Total,Total CAD,% Holding,Projected Annual Income,URL,Cash,Cash (Joint),RRSP,RRSP (Spousal),LIRA",
  '"Fund, A",ETF,US,Mixed,Medium,USD,1.4,4.00,160,224,0,0,https://finance.yahoo.com/quote/FUND,100,50,0,10,0',
  "Bank,Stock,Canada,Finance,Low,CAD,1,2.00,350,350,0,0,,200,0,100,0,50",
].join("\n");

test("CSV parser handles quoted commas", () => {
  const rows = Model.parseCsv(CSV);
  assert.equal(rows[1][0], "Fund, A");
});

test("portfolio loader discovers accounts and reads explicit exchange rates", () => {
  const portfolio = Model.loadPortfolio(CSV);
  assert.deepEqual(portfolio.accounts, [
    "Cash", "Cash (Joint)", "RRSP", "RRSP (Spousal)", "LIRA",
  ]);
  assert.equal(portfolio.rates.CAD, 1);
  assert.equal(portfolio.rates.USD, 1.4);
  assert.equal(portfolio.rows[0].url, "https://finance.yahoo.com/quote/FUND");
  assert.equal(portfolio.rows[1].url, null);
});

test("portfolio loader rejects unsafe asset URLs", () => {
  assert.throws(
    () => Model.loadPortfolio(CSV.replace("https://finance.yahoo.com/quote/FUND", "javascript:alert(1)")),
    /absolute HTTP or HTTPS URL/
  );
});

test("trailing account columns do not require an Account suffix", () => {
  const csv = CSV
    .replace("Cash (Joint)", "Beta")
    .replace("RRSP (Spousal)", "Delta")
    .replace("Cash", "Alpha")
    .replace("RRSP", "Gamma")
    .replace("LIRA", "Epsilon");
  assert.deepEqual(Model.loadPortfolio(csv).accounts, [
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  ]);
});

test("explicit rates remain available when a currency has only zero-value rows", () => {
  const csv = CSV.replace("160,224", "0,0").replace("100,50,0,10,0", "0,0,0,0,0");
  const portfolio = Model.loadPortfolio(csv);
  assert.equal(portfolio.rates.USD, 1.4);
});

test("selected accounts dynamically recalculate totals and income", () => {
  const portfolio = Model.loadPortfolio(CSV);
  const derived = Model.deriveAssets(portfolio, new Set(["Cash (Joint)"]));
  assert.equal(derived.rows.length, 1);
  assert.equal(derived.rows[0].asset, "Fund, A");
  assert.equal(derived.rows[0].total, 50);
  assert.equal(derived.rows[0].totalCad, 70);
  assert.equal(derived.rows[0].holdingPct, 100);
  assert.equal(derived.rows[0].projectedIncome, 2.8);
  assert.equal(Model.summarize(derived).accountTotalsCad["Cash (Joint)"], 70);
});

test("grouping recalculates weighted yield and portfolio share", () => {
  const portfolio = Model.loadPortfolio(CSV);
  const derived = Model.deriveAssets(portfolio, new Set(portfolio.accounts));
  const groups = Model.groupAssets(derived, "Market");
  const us = groups.find((group) => group.label === "US");
  assert.equal(us.assetCount, 1);
  assert.equal(us.totalCad, 224);
  assert.equal(us.yieldPct, 4);
  assert.equal(us.projectedIncome, 8.96);
});

test("multi-column sorting honors priority and direction", () => {
  const rows = [
    { type: "ETF", value: 10 },
    { type: "Stock", value: 50 },
    { type: "ETF", value: 30 },
  ];
  const sorted = Model.sortRows(rows, [
    { key: "type", direction: "asc" },
    { key: "value", direction: "desc" },
  ]);
  assert.deepEqual(sorted.map((row) => row.value), [30, 10, 50]);
});
