(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const REQUIRED_COLUMNS = [
    "Asset", "Type", "Market", "Sector", "Risk", "Currency", "FX Rate CAD",
    "Yield", "Total", "Total CAD", "% Holding", "Projected Annual Income", "URL",
  ];
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, "");

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        if (field.length !== 0) throw new Error("Malformed CSV: quote inside an unquoted field");
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }
    if (quoted) throw new Error("Malformed CSV: unterminated quoted field");
    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows.filter((values) => values.some((value) => value !== ""));
  }

  function loadPortfolio(text) {
    const matrix = parseCsv(text);
    if (matrix.length < 2) throw new Error("The CSV must contain a header and at least one asset row");
    const headers = matrix[0].map((header) => header.trim());
    const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
    if (duplicate) throw new Error(`Duplicate CSV column: ${duplicate}`);
    const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

    const accountStart = headers.indexOf("URL") + 1;
    const accounts = headers.slice(accountStart);
    if (!accounts.length) throw new Error("No account columns were found");
    if (accounts.some((account) => !account)) {
      throw new Error("Account column names must not be empty");
    }

    const parsedRows = matrix.slice(1).map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`
        );
      }
      const raw = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
      const accountValues = Object.fromEntries(
        accounts.map((account) => [account, parseNumber(raw[account], account, rowIndex + 2)])
      );
      return {
        asset: requiredText(raw.Asset, "Asset", rowIndex + 2),
        type: requiredText(raw.Type, "Type", rowIndex + 2),
        market: requiredText(raw.Market, "Market", rowIndex + 2),
        sector: requiredText(raw.Sector, "Sector", rowIndex + 2),
        risk: requiredText(raw.Risk, "Risk", rowIndex + 2),
        currency: requiredText(raw.Currency, "Currency", rowIndex + 2),
        yieldPct: optionalNumber(raw.Yield, "Yield", rowIndex + 2),
        fxRate: positiveNumber(raw["FX Rate CAD"], "FX Rate CAD", rowIndex + 2),
        url: optionalUrl(raw.URL, rowIndex + 2),
        accounts: accountValues,
      };
    });

    const rates = {};
    for (const row of parsedRows) {
      if (rates[row.currency] !== undefined && Math.abs(rates[row.currency] - row.fxRate) > 1e-9) {
        throw new Error(`Inconsistent CAD exchange rates for ${row.currency}`);
      }
      rates[row.currency] = row.fxRate;
    }
    return { headers, accounts, rows: parsedRows, rates };
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
        if (
          (leftValue === null || leftValue === undefined)
          && (rightValue === null || rightValue === undefined)
        ) comparison = 0;
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

  function requiredText(value, column, rowNumber) {
    const text = String(value || "").trim();
    if (!text) throw new Error(`CSV row ${rowNumber}: ${column} is required`);
    return text;
  }

  function parseNumber(value, column, rowNumber) {
    const number = Number(String(value).trim());
    if (!Number.isFinite(number)) {
      throw new Error(`CSV row ${rowNumber}: invalid number in ${column}`);
    }
    return number;
  }

  function optionalNumber(value, column, rowNumber) {
    if (String(value || "").trim() === "") return null;
    return parseNumber(value, column, rowNumber);
  }

  function positiveNumber(value, column, rowNumber) {
    const number = parseNumber(value, column, rowNumber);
    if (number <= 0) throw new Error(`CSV row ${rowNumber}: ${column} must be positive`);
    return number;
  }

  function optionalUrl(value, rowNumber) {
    const text = String(value || "").trim();
    if (!text) return null;
    let parsed;
    try {
      parsed = new URL(text);
    } catch (_) {
      throw new Error(`CSV row ${rowNumber}: URL must be an absolute HTTP or HTTPS URL`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`CSV row ${rowNumber}: URL must be an absolute HTTP or HTTPS URL`);
    }
    return text;
  }

  return {
    parseCsv,
    loadPortfolio,
    deriveAssets,
    groupAssets,
    summarize,
    sortRows,
  };
});
