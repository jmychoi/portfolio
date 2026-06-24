const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const Model = require(path.join(__dirname, "..", "explorer", "model.js"));

const DOCUMENT = {
  schemaVersion: 2,
  configuration: {
    account_columns: ["Cash", "Cash (Joint)", "RRSP", "RRSP (Spousal)", "LIRA"],
    allowed_currencies: ["CAD", "USD"],
    assets: {
      "Fund, A": { type: "ETF", market: "US", sector: "Mixed", risk: "Medium", currency: "USD" },
      Bank: { type: "Stock", market: "Canada", sector: "Finance", risk: "Low", currency: "CAD" },
    },
  },
  exchangeRates: {
    CAD: { rateToCad: 1, date: null, source: null },
    USD: { rateToCad: 1.4, date: "2026-06-19", source: "Bank of Canada" },
  },
  yields: {
    "Fund, A": { providerSymbol: "FUND", percent: 4, asOf: null, source: "test", status: "ok" },
    Bank: { providerSymbol: "BANK.TO", percent: 2, asOf: null, source: "test", status: "ok" },
  },
  supplementalAssets: {},
  holdings: [
    { asset: "Fund, A", accounts: { Cash: 100, "Cash (Joint)": 50, "RRSP (Spousal)": 10 } },
    { asset: "Bank", accounts: { Cash: 200, RRSP: 100, LIRA: 50 } },
  ],
};

function json(document = DOCUMENT) {
  return JSON.stringify(document);
}

function copyDocument() {
  return JSON.parse(json());
}

test("portfolio loader rejects malformed JSON", () => {
  assert.throws(() => Model.loadPortfolio("not json"), /not valid JSON/);
});

test("portfolio loader reads accounts, rates, metadata, yields, and derived URLs", () => {
  const portfolio = Model.loadPortfolio(json());
  assert.deepEqual(portfolio.accounts, ["Cash", "Cash (Joint)", "RRSP", "RRSP (Spousal)", "LIRA"]);
  assert.equal(portfolio.rates.CAD, 1);
  assert.equal(portfolio.rates.USD, 1.4);
  assert.equal(portfolio.rows[0].currency, "USD");
  assert.equal(portfolio.rows[0].url, "https://finance.yahoo.com/quote/FUND");
  assert.equal(portfolio.rows[1].yieldPct, 2);
});

test("portfolio loader rejects metadata currencies outside configuration", () => {
  const document = copyDocument();
  document.configuration.assets.Bank.currency = "EUR";
  assert.throws(() => Model.loadPortfolio(json(document)), /unsupported currency EUR/);
});

test("portfolio loader rejects unsafe supplemental asset URLs", () => {
  const document = copyDocument();
  document.supplementalAssets.Property = {
    type: "Real Estate", market: "Canada", sector: "Real Estate", risk: "Medium",
    currency: "CAD",
    url: "javascript:alert(1)",
  };
  document.holdings.push({ asset: "Property", accounts: { Cash: 100 } });
  assert.throws(() => Model.loadPortfolio(json(document)), /absolute HTTP or HTTPS URL/);
});

test("account names are data-driven", () => {
  const document = copyDocument();
  document.configuration.account_columns = ["Alpha", "Beta"];
  document.holdings[0].accounts = { Alpha: 100 };
  document.holdings[1].accounts = { Beta: 200 };
  assert.deepEqual(Model.loadPortfolio(json(document)).accounts, ["Alpha", "Beta"]);
});

test("explicit rates remain available when a currency has only zero-value rows", () => {
  const document = copyDocument();
  document.holdings[0].accounts = {};
  const portfolio = Model.loadPortfolio(json(document));
  assert.equal(portfolio.rates.USD, 1.4);
});

test("selected accounts dynamically recalculate totals and income", () => {
  const portfolio = Model.loadPortfolio(json());
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
  const portfolio = Model.loadPortfolio(json());
  const derived = Model.deriveAssets(portfolio, new Set(portfolio.accounts));
  const us = Model.groupAssets(derived, "Market").find((group) => group.label === "US");
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
