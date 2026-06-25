(function (root, factory) {
  const portfolioModel = typeof module === "object" && module.exports
    ? require("../explorer/model.js") : root.PortfolioModel;
  const api = factory(portfolioModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioCollectionModel = api;
})(typeof window !== "undefined" ? window : globalThis, function (PortfolioModel) {
  "use strict";

  const PREFERRED_DIMENSIONS = ["type", "sector", "market", "risk", "currency"];

  function loadCollection(text) {
    let document;
    try {
      document = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch (_) {
      throw new Error("The selected file is not valid JSON");
    }
    requireObject(document, "Portfolio collection");
    if (document.kind !== "portfolioCollection") {
      throw new Error(`Unsupported collection kind: ${document.kind}`);
    }
    if (document.schemaVersion !== 1) {
      throw new Error(`Unsupported collection schema version: ${document.schemaVersion}`);
    }
    if (!Array.isArray(document.portfolios) || !document.portfolios.length) {
      throw new Error("portfolios must be a non-empty array");
    }

    const accounts = [];
    const seenAccounts = new Set();
    const dimensions = new Set();
    const dates = new Set();
    let previousDate = null;
    const snapshots = document.portfolios.map((source, index) => {
      const portfolio = PortfolioModel.loadPortfolioDocument(source);
      if (dates.has(portfolio.date)) throw new Error(`Duplicate portfolio date: ${portfolio.date}`);
      if (previousDate !== null && portfolio.date <= previousDate) {
        throw new Error("Portfolio dates must be strictly chronological");
      }
      dates.add(portfolio.date);
      previousDate = portfolio.date;
      for (const account of portfolio.accounts) {
        if (!seenAccounts.has(account)) {
          seenAccounts.add(account);
          accounts.push(account);
        }
      }
      for (const row of portfolio.rows) {
        for (const [account, value] of Object.entries(row.accounts)) {
          if (value < 0) throw new Error(`${portfolio.date}: ${row.asset}/${account} is negative`);
        }
        if (row.yieldPct !== null && row.yieldPct < 0) {
          throw new Error(`${portfolio.date}: ${row.asset} has negative yield`);
        }
        Object.keys(row.classifications).forEach((key) => dimensions.add(key));
      }
      return { index, ...portfolio };
    });
    const orderedDimensions = [
      ...PREFERRED_DIMENSIONS.filter((key) => dimensions.has(key)),
      ...[...dimensions].filter((key) => !PREFERRED_DIMENSIONS.includes(key)).sort(),
    ];
    return { accounts, dimensions: orderedDimensions, snapshots };
  }

  function deriveCollectionHistory(history, options) {
    const selectedAccounts = options.selectedAccounts || new Set();
    const startDate = options.startDate || history.snapshots[0].date;
    const endDate = options.endDate || history.snapshots[history.snapshots.length - 1].date;
    const stackBy = options.stackBy || "account";
    const metric = options.metric || "value";
    if (!new Set(["value", "income"]).has(metric)) {
      throw new Error(`Unsupported metric: ${metric}`);
    }
    if (stackBy !== "account" && !history.dimensions.includes(stackBy)) {
      throw new Error(`Unsupported stacking dimension: ${stackBy}`);
    }
    if (startDate > endDate) throw new Error("Start date must not be after end date");

    const snapshots = history.snapshots.filter(
      (snapshot) => snapshot.date >= startDate && snapshot.date <= endDate
    );
    const selected = history.accounts.filter((account) => selectedAccounts.has(account));
    const categoryMaps = [];
    const totals = [];
    const coverages = [];
    for (const snapshot of snapshots) {
      const categories = new Map();
      let totalValue = 0;
      let knownYieldValue = 0;
      let projectedIncome = 0;
      for (const row of snapshot.rows) {
        const values = Object.fromEntries(selected.map((account) => [
          account, (row.accounts[account] || 0) * row.fxRate,
        ]));
        const rowValue = Object.values(values).reduce((sum, value) => sum + value, 0);
        totalValue += rowValue;
        if (row.yieldPct !== null) {
          knownYieldValue += rowValue;
          projectedIncome += rowValue * row.yieldPct / 100;
        }
        if (stackBy === "account") {
          for (const [account, value] of Object.entries(values)) {
            const amount = metric === "value"
              ? value : row.yieldPct === null ? 0 : value * row.yieldPct / 100;
            categories.set(account, (categories.get(account) || 0) + amount);
          }
        } else {
          const category = row.classifications[stackBy] || "Unknown";
          const amount = metric === "value"
            ? rowValue : row.yieldPct === null ? 0 : rowValue * row.yieldPct / 100;
          categories.set(category, (categories.get(category) || 0) + amount);
        }
      }
      categoryMaps.push(categories);
      totals.push(metric === "value" ? totalValue : projectedIncome);
      coverages.push(totalValue ? knownYieldValue / totalValue * 100 : null);
    }

    const categoryTotals = new Map();
    for (const categories of categoryMaps) {
      for (const [category, value] of categories) {
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + value);
      }
    }
    const finalCategories = categoryMaps.at(-1) || new Map();
    const categories = [...categoryTotals]
      .filter(([, total]) => total > 0)
      .sort((left, right) => {
        const finalDifference = (finalCategories.get(right[0]) || 0)
          - (finalCategories.get(left[0]) || 0);
        return finalDifference || right[1] - left[1] || left[0].localeCompare(right[0]);
      })
      .map(([category]) => category);
    const series = categories.map((category) => ({
      category,
      values: categoryMaps.map((values) => values.get(category) || 0),
    }));
    return {
      metric, stackBy, accounts: selected, snapshots, series, totals, coverages,
      startDate, endDate,
    };
  }

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    return value;
  }

  return { loadCollection, deriveCollectionHistory };
});
