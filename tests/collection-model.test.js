const test = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../explorer/collection-model.js");

function portfolio(date, fundValue, bankValue, fundYield = 4) {
  return {
    schemaVersion: 3,
    date,
    configuration: {
      account_columns: ["Cash", "RRSP"],
      allowed_currencies: ["CAD", "USD"],
      assets: {
        Fund: {
          type: "ETF", sector: "Mixed", market: "US", risk: "Medium",
          currency: "USD", region: "North America",
        },
        Bank: {
          type: "Stock", sector: "Finance", market: "Canada", risk: "Low",
          currency: "CAD", region: "North America",
        },
      },
    },
    exchangeRates: {
      CAD: { rateToCad: 1 },
      USD: { rateToCad: 1.4 },
    },
    yields: {
      Fund: { percent: fundYield, providerSymbol: "FUND" },
      Bank: { percent: 2, providerSymbol: "BANK.TO" },
    },
    supplementalAssets: {},
    holdings: [
      { asset: "Fund", accounts: { Cash: fundValue, RRSP: 10 } },
      { asset: "Bank", accounts: { Cash: bankValue } },
    ],
  };
}

function history() {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "portfolioCollection",
    portfolios: [
      portfolio("2026-01-31", 100, 200, null),
      portfolio("2026-02-28", 150, 300, 4),
    ],
  });
}

test("history loader validates portfolios and discovers accounts and dimensions", () => {
  const loaded = Model.loadCollection(history());
  assert.deepEqual(loaded.accounts, ["Cash", "RRSP"]);
  assert.deepEqual(loaded.dimensions, ["type", "sector", "market", "risk", "currency", "region"]);
  assert.equal(loaded.snapshots.length, 2);
});

test("value history stacks selected accounts by a classification", () => {
  const loaded = Model.loadCollection(history());
  const derived = Model.deriveCollectionHistory(loaded, {
    selectedAccounts: new Set(["Cash"]),
    startDate: "2026-01-31",
    endDate: "2026-02-28",
    stackBy: "sector",
    metric: "value",
  });
  assert.deepEqual(derived.totals, [340, 510]);
  assert.deepEqual(
    Object.fromEntries(derived.series.map((series) => [series.category, series.values])),
    { Finance: [200, 300], Mixed: [140, 210] },
  );
});

test("history series are ordered by the final selected snapshot", () => {
  const loaded = Model.loadCollection(JSON.stringify({
    schemaVersion: 1,
    kind: "portfolioCollection",
    portfolios: [
      portfolio("2026-01-31", 500, 10),
      portfolio("2026-02-28", 100, 300),
    ],
  }));
  const derived = Model.deriveCollectionHistory(loaded, {
    selectedAccounts: new Set(["Cash"]),
    stackBy: "sector",
    metric: "value",
  });
  assert.deepEqual(derived.series.map((series) => series.category), ["Finance", "Mixed"]);
  assert.deepEqual(derived.series.map((series) => series.values.at(-1)), [300, 140]);
});

test("income history excludes unknown yields and reports value coverage", () => {
  const loaded = Model.loadCollection(history());
  const derived = Model.deriveCollectionHistory(loaded, {
    selectedAccounts: new Set(["Cash"]),
    stackBy: "account",
    metric: "income",
  });
  assert.deepEqual(derived.totals, [4, 14.4]);
  assert.ok(Math.abs(derived.coverages[0] - 200 / 340 * 100) < 1e-9);
  assert.equal(derived.coverages[1], 100);
});

test("date range is inclusive", () => {
  const loaded = Model.loadCollection(history());
  const derived = Model.deriveCollectionHistory(loaded, {
    selectedAccounts: new Set(loaded.accounts),
    startDate: "2026-02-01",
    endDate: "2026-02-28",
    stackBy: "type",
    metric: "value",
  });
  assert.deepEqual(derived.snapshots.map((snapshot) => snapshot.date), ["2026-02-28"]);
});

test("duplicate or unsorted dates are rejected", () => {
  const document = JSON.parse(history());
  document.portfolios.reverse();
  assert.throws(() => Model.loadCollection(JSON.stringify(document)), /strictly chronological/);
});
