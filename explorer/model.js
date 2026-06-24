(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function loadPortfolio(text) {
    let document;
    try {
      document = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch (_) {
      throw new Error("The selected file is not valid JSON");
    }
    requireObject(document, "Portfolio document");
    if (document.schemaVersion !== 1) {
      throw new Error(`Unsupported portfolio schema version: ${document.schemaVersion}`);
    }

    const configuration = requireObject(document.configuration, "configuration");
    const accounts = requireStringArray(configuration.account_columns, "configuration.account_columns");
    const configuredAssets = requireObject(configuration.assets, "configuration.assets");
    const supplementalAssets = requireObject(document.supplementalAssets, "supplementalAssets");
    const exchangeRates = requireObject(document.exchangeRates, "exchangeRates");
    const yields = requireObject(document.yields, "yields");
    if (!Array.isArray(document.holdings)) throw new Error("holdings must be an array");

    for (const asset of Object.keys(supplementalAssets)) {
      if (Object.prototype.hasOwnProperty.call(configuredAssets, asset)) {
        throw new Error(`Asset ${asset} has duplicate metadata`);
      }
    }

    const rates = {};
    for (const [currency, record] of Object.entries(exchangeRates)) {
      requireObject(record, `exchangeRates.${currency}`);
      rates[currency] = positiveNumber(record.rateToCad, `exchangeRates.${currency}.rateToCad`);
    }

    const seenAssets = new Set();
    const rows = document.holdings.map((holding, index) => {
      const label = `holdings[${index}]`;
      requireObject(holding, label);
      const asset = requiredText(holding.asset, `${label}.asset`);
      if (seenAssets.has(asset)) throw new Error(`Duplicate holding asset: ${asset}`);
      seenAssets.add(asset);
      const currency = requiredText(holding.currency, `${label}.currency`);
      const fxRate = rates[currency];
      if (!Number.isFinite(fxRate)) throw new Error(`No exchange rate for ${currency}`);
      const metadata = configuredAssets[asset] || supplementalAssets[asset];
      requireObject(metadata, `metadata for ${asset}`);
      const sourceAccounts = requireObject(holding.accounts, `${label}.accounts`);
      for (const account of Object.keys(sourceAccounts)) {
        if (!accounts.includes(account)) throw new Error(`${label}: unknown account ${account}`);
      }
      const accountValues = Object.fromEntries(accounts.map((account) => [
        account,
        sourceAccounts[account] === undefined
          ? 0 : finiteNumber(sourceAccounts[account], `${label}.accounts.${account}`),
      ]));
      const yieldRecord = yields[asset];
      if (yieldRecord !== undefined) requireObject(yieldRecord, `yields.${asset}`);
      const yieldPct = yieldRecord === undefined || yieldRecord.percent === null
        ? null : finiteNumber(yieldRecord.percent, `yields.${asset}.percent`);
      const url = metadata.url
        ? optionalUrl(metadata.url, `metadata for ${asset}`)
        : yahooFinanceUrl(yieldRecord && yieldRecord.providerSymbol);
      return {
        asset,
        type: requiredText(metadata.type, `metadata for ${asset}.type`),
        market: requiredText(metadata.market, `metadata for ${asset}.market`),
        sector: requiredText(metadata.sector, `metadata for ${asset}.sector`),
        risk: requiredText(metadata.risk, `metadata for ${asset}.risk`),
        currency,
        yieldPct,
        fxRate,
        url,
        accounts: accountValues,
      };
    });
    return { accounts, rows, rates };
  }

  function deriveAssets(portfolio, selectedAccounts) {
    const chosen = portfolio.accounts.filter((account) => selectedAccounts.has(account));
    const rows = portfolio.rows.map((row) => {
      const selectedValues = Object.fromEntries(
        chosen.map((account) => [account, row.accounts[account]])
      );
      const total = chosen.reduce((sum, account) => sum + row.accounts[account], 0);
      const totalCad = total * row.fxRate;
      const projectedIncome = row.yieldPct === null ? null : totalCad * row.yieldPct / 100;
      return { ...row, selectedValues, total, totalCad, projectedIncome, holdingPct: 0 };
    }).filter((row) => Math.abs(row.totalCad) > 0.005);

    const portfolioTotalCad = rows.reduce((sum, row) => sum + row.totalCad, 0);
    for (const row of rows) {
      row.holdingPct = portfolioTotalCad ? row.totalCad / portfolioTotalCad * 100 : 0;
    }
    return { rows, portfolioTotalCad, accounts: chosen };
  }

  function groupAssets(derived, groupBy) {
    const property = {
      Type: "type", Market: "market", Sector: "sector", Risk: "risk", Currency: "currency",
    }[groupBy];
    if (!property) throw new Error(`Unsupported grouping: ${groupBy}`);
    const groups = new Map();
    for (const row of derived.rows) {
      const label = row[property] || "Unknown";
      const group = groups.get(label) || {
        label, totalCad: 0, projectedIncome: 0, knownYieldValue: 0,
        knownYieldIncome: 0, assetCount: 0, holdingPct: 0, yieldPct: null,
      };
      group.totalCad += row.totalCad;
      group.assetCount += 1;
      if (row.projectedIncome !== null) {
        group.projectedIncome += row.projectedIncome;
        group.knownYieldIncome += row.projectedIncome;
        group.knownYieldValue += row.totalCad;
      }
      groups.set(label, group);
    }
    const result = [...groups.values()];
    for (const group of result) {
      group.holdingPct = derived.portfolioTotalCad
        ? group.totalCad / derived.portfolioTotalCad * 100 : 0;
      group.yieldPct = group.knownYieldValue
        ? group.knownYieldIncome / group.knownYieldValue * 100 : null;
      if (!group.knownYieldValue) group.projectedIncome = null;
    }
    return result;
  }

  function summarize(derived) {
    let projectedIncome = 0;
    let knownYieldValue = 0;
    for (const row of derived.rows) {
      if (row.projectedIncome !== null) {
        projectedIncome += row.projectedIncome;
        knownYieldValue += row.totalCad;
      }
    }
    return {
      totalCad: derived.portfolioTotalCad,
      accountTotalsCad: Object.fromEntries(derived.accounts.map((account) => [
        account,
        derived.rows.reduce(
          (total, row) => total + row.selectedValues[account] * row.fxRate,
          0
        ),
      ])),
      projectedIncome: knownYieldValue ? projectedIncome : null,
      yieldPct: knownYieldValue ? projectedIncome / knownYieldValue * 100 : null,
      assetCount: derived.rows.length,
    };
  }

  function sortRows(rows, sortKeys) {
    return [...rows].sort((left, right) => {
      for (const sort of sortKeys) {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        let comparison;
        if ((leftValue === null || leftValue === undefined)
            && (rightValue === null || rightValue === undefined)) comparison = 0;
        else if (leftValue === null || leftValue === undefined) comparison = 1;
        else if (rightValue === null || rightValue === undefined) comparison = -1;
        else if (typeof leftValue === "number" && typeof rightValue === "number") {
          comparison = leftValue - rightValue;
        } else {
          comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
            numeric: true, sensitivity: "base",
          });
        }
        if (comparison) return sort.direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
  }

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    return value;
  }

  function requireStringArray(value, label) {
    if (!Array.isArray(value) || !value.length) throw new Error(`${label} must be a non-empty array`);
    const result = value.map((item, index) => requiredText(item, `${label}[${index}]`));
    if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
    return result;
  }

  function requiredText(value, label) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new Error(`${label} is required`);
    return text;
  }

  function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
    return value;
  }

  function positiveNumber(value, label) {
    const number = finiteNumber(value, label);
    if (number <= 0) throw new Error(`${label} must be positive`);
    return number;
  }

  function optionalUrl(value, label) {
    const text = String(value || "").trim();
    if (!text) return null;
    let parsed;
    try { parsed = new URL(text); } catch (_) {
      throw new Error(`${label}.url must be an absolute HTTP or HTTPS URL`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${label}.url must be an absolute HTTP or HTTPS URL`);
    }
    return text;
  }

  function yahooFinanceUrl(providerSymbol) {
    const symbol = String(providerSymbol || "").trim();
    return symbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` : null;
  }

  return { loadPortfolio, deriveAssets, groupAssets, summarize, sortRows };
});
