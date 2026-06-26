(function () {
  "use strict";

  function createSnapshotView(options) {
    const { state, render, chartColors, setHeading } = options;
    const Model = window.PortfolioModel;
    const money = new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    const wholeNumber = new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    const percentage = new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const fxNumber = new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: 4, maximumFractionDigits: 6,
    });
    const elements = {
      groupBy: document.querySelector("#group-by"),
      accounts: document.querySelector("#account-options"),
      selectAllAccounts: document.querySelector("#select-all-accounts"),
      clearAllAccounts: document.querySelector("#clear-all-accounts"),
      fxRates: document.querySelector("#fx-rates-body"),
      metricValue: document.querySelector("#metric-value"),
      metricIncome: document.querySelector("#metric-income"),
      metricYield: document.querySelector("#metric-yield"),
      metricAssets: document.querySelector("#metric-assets"),
      tableTitle: document.querySelector("#table-title"),
      tableHead: document.querySelector("#table-head"),
      tableBody: document.querySelector("#table-body"),
      tableFoot: document.querySelector("#table-foot"),
      tableEmpty: document.querySelector("#table-empty"),
      chartTitle: document.querySelector("#chart-title"),
      pie: document.querySelector("#pie-container"),
      legend: document.querySelector("#pie-legend"),
      chartEmpty: document.querySelector("#chart-empty"),
    };

    elements.selectAllAccounts.addEventListener("click", () => {
      state.selectedAccounts = new Set(state.portfolio.accounts);
      syncAccountCheckboxes();
      render();
    });
    elements.clearAllAccounts.addEventListener("click", () => {
      state.selectedAccounts = new Set();
      syncAccountCheckboxes();
      render();
    });
    elements.groupBy.addEventListener("change", () => {
      state.groupBy = elements.groupBy.value;
      state.sortKeys = [{ key: "holdingPct", direction: "desc" }];
      render();
    });

  function initializeControls() {
    elements.groupBy.value = "None";
    renderFxRates();

    elements.accounts.replaceChildren();
    state.portfolio.accounts.forEach((account, index) => {
      const label = document.createElement("label");
      label.className = "account-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = account;
      input.id = `account-${index}`;
      input.checked = true;
      input.addEventListener("change", () => {
        if (input.checked) state.selectedAccounts.add(account);
        else state.selectedAccounts.delete(account);
        render();
      });
      const text = document.createElement("span");
      text.textContent = account;
      label.title = account;
      label.append(input, text);
      elements.accounts.append(label);
    });
  }

  function syncAccountCheckboxes() {
    elements.accounts.querySelectorAll("input").forEach((input) => {
      input.checked = state.selectedAccounts.has(input.value);
    });
  }

  function renderFxRates() {
    elements.fxRates.replaceChildren();
    Object.entries(state.portfolio.rates)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([currency, rate]) => {
        const row = document.createElement("tr");
        const currencyCell = document.createElement("td");
        currencyCell.textContent = currency;
        const rateCell = document.createElement("td");
        rateCell.textContent = fxNumber.format(rate);
        row.append(currencyCell, rateCell);
        elements.fxRates.append(row);
      });
  }

  function renderSnapshot() {
    if (!state.portfolio) return;
    const derived = Model.deriveAssets(state.portfolio, state.selectedAccounts);
    const summary = Model.summarize(derived);
    const grouped = state.groupBy === "None" ? null : Model.groupAssets(derived, state.groupBy);
    renderHeading(derived);
    renderMetrics(summary);
    renderTable(derived, grouped);
    renderChart(derived);
  }

  function renderHeading(derived) {
    setHeading(state.filename);
  }

  function renderMetrics(summary) {
    elements.metricValue.textContent = money.format(summary.totalCad);
    elements.metricIncome.textContent = summary.projectedIncome === null
      ? "—" : money.format(summary.projectedIncome);
    elements.metricYield.textContent = summary.yieldPct === null
      ? "—" : `${percentage.format(summary.yieldPct)}%`;
    elements.metricAssets.textContent = String(summary.assetCount);
  }

  function renderTable(derived, grouped) {
    const isGrouped = state.groupBy !== "None";
    const columns = isGrouped ? groupedColumns() : assetColumns(derived.accounts);
    const rows = isGrouped
      ? grouped.map((row) => ({ ...row }))
      : derived.rows.map((row) => flattenAssetRow(row, derived.accounts));
    const sorted = Model.sortRows(rows, state.sortKeys);
    elements.tableTitle.textContent = isGrouped ? `Grouped by ${state.groupBy}` : "Individual assets";
    elements.tableEmpty.hidden = sorted.length !== 0;
    document.querySelector(".table-wrap").hidden = sorted.length === 0;
    renderTableHeader(columns);
    renderTableFooter(columns, derived, sorted.length !== 0);
    elements.tableBody.replaceChildren();

    for (const row of sorted) {
      const tr = document.createElement("tr");
      for (const column of columns) {
        const td = document.createElement("td");
        applyColumnClasses(td, column);
        if (column.key === "asset") td.classList.add("asset");
        if (column.key === "label") {
          td.textContent = row.label;
          const count = document.createElement("span");
          count.className = "group-count";
          count.textContent = `${row.assetCount} asset${row.assetCount === 1 ? "" : "s"}`;
          td.append(count);
        } else if (column.key === "asset" && row.url) {
          const link = document.createElement("a");
          link.className = "asset-link";
          link.href = row.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = row.asset;
          td.append(link);
        } else {
          td.textContent = column.format(row[column.key], row);
        }
        tr.append(td);
      }
      elements.tableBody.append(tr);
    }
  }

  function renderTableHeader(columns) {
    const row = document.createElement("tr");
    for (const column of columns) {
      const th = document.createElement("th");
      applyColumnClasses(th, column);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sort-button";
      button.dataset.key = column.key;
      const label = document.createElement("span");
      label.className = "sort-label";
      label.textContent = column.label;
      if (column.account) label.prepend(accountIcon());
      button.append(label);

      const sortIndex = state.sortKeys.findIndex((sort) => sort.key === column.key);
      if (sortIndex >= 0) {
        const sort = state.sortKeys[sortIndex];
        const badge = document.createElement("span");
        badge.className = "sort-badge";
        badge.textContent = `${sortIndex + 1}${sort.direction === "asc" ? "↑" : "↓"}`;
        button.append(badge);
        th.setAttribute("aria-sort", sort.direction === "asc" ? "ascending" : "descending");
      }
      button.addEventListener("click", (event) => updateSort(column, event.shiftKey));
      th.append(button);
      row.append(th);
    }
    elements.tableHead.replaceChildren(row);
  }

  function renderTableFooter(columns, derived, hasRows) {
    elements.tableFoot.hidden = !hasRows;
    elements.tableFoot.replaceChildren();
    if (!hasRows) return;
    const summary = Model.summarize(derived);
    const values = {
      asset: "TOTAL",
      label: "TOTAL",
      totalCad: summary.totalCad,
      holdingPct: summary.totalCad ? 100 : 0,
      yieldPct: summary.yieldPct,
      projectedIncome: summary.projectedIncome,
    };
    for (const [account, totalCad] of Object.entries(summary.accountTotalsCad)) {
      values[`account:${account}`] = totalCad;
    }
    const row = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("td");
      applyColumnClasses(cell, column);
      if (column.key === "asset" || column.key === "label") {
        cell.textContent = "TOTAL";
      } else if (Object.prototype.hasOwnProperty.call(values, column.key)) {
        cell.textContent = column.format(values[column.key], values);
      } else {
        cell.textContent = "—";
      }
      row.append(cell);
    }
    elements.tableFoot.append(row);
  }

  function updateSort(column, additive) {
    const existingIndex = state.sortKeys.findIndex((sort) => sort.key === column.key);
    const defaultDirection = column.numeric ? "desc" : "asc";
    let next;
    if (existingIndex >= 0) {
      const current = state.sortKeys[existingIndex];
      const toggled = { ...current, direction: current.direction === "asc" ? "desc" : "asc" };
      if (additive) {
        next = [...state.sortKeys];
        next[existingIndex] = toggled;
      } else {
        next = [toggled];
      }
    } else if (additive) {
      next = [...state.sortKeys, { key: column.key, direction: defaultDirection }];
    } else {
      next = [{ key: column.key, direction: defaultDirection }];
    }
    state.sortKeys = next;
    render();
  }

  function renderChart(derived) {
    const chartGrouping = state.groupBy === "None" ? "Sector" : state.groupBy;
    const groups = Model.groupAssets(derived, chartGrouping)
      .filter((group) => group.totalCad > 0)
      .sort((a, b) => b.totalCad - a.totalCad);
    elements.chartTitle.textContent = `By ${chartGrouping.toLowerCase()}`;
    elements.chartEmpty.hidden = groups.length !== 0;
    elements.pie.hidden = groups.length === 0;
    elements.legend.hidden = groups.length === 0;
    elements.pie.replaceChildren();
    elements.legend.replaceChildren();
    if (!groups.length) return;

    const svg = svgElement("svg", {
      viewBox: "0 0 240 240", class: "pie-svg", role: "img",
      "aria-label": `Portfolio allocation by ${chartGrouping}`,
    });
    let angle = -90;
    groups.forEach((group, index) => {
      const sweep = group.holdingPct / 100 * 360;
      const path = svgElement("path", {
        d: wedgePath(120, 120, 92, angle, angle + sweep),
        fill: chartColors()[index % chartColors().length],
        class: "pie-slice",
        tabindex: "0",
      });
      const title = svgElement("title");
      title.textContent = `${group.label}: ${money.format(group.totalCad)} (${percentage.format(group.holdingPct)}%)`;
      path.append(title);
      svg.append(path);
      angle += sweep;
    });
    svg.append(svgElement("circle", { cx: "120", cy: "120", r: "55", class: "pie-hole" }));
    const centerValue = svgElement("text", { x: "120", y: "118", class: "pie-center-value" });
    centerValue.textContent = compactMoney(derived.portfolioTotalCad);
    const centerLabel = svgElement("text", { x: "120", y: "133", class: "pie-center-label" });
    centerLabel.textContent = "SELECTED CAD";
    svg.append(centerValue, centerLabel);
    elements.pie.append(svg);

    groups.forEach((group, index) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = chartColors()[index % chartColors().length];
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = group.label;
      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `${percentage.format(group.holdingPct)}%`;
      row.append(swatch, label, value);
      elements.legend.append(row);
    });
  }

  function assetColumns(accounts) {
    return [
      textColumn("asset", "Asset"), textColumn("type", "Type"), textColumn("market", "Market"),
      textColumn("sector", "Sector"), textColumn("risk", "Risk"),
      textColumn("currency", "Currency"),
      numberColumn("total", "Total", formatWholeNumber),
      numberColumn("totalCad", "Total CAD", formatMoney),
      numberColumn("holdingPct", "% Holding", formatPercent),
      numberColumn("yieldPct", "Yield", formatPercent),
      numberColumn("projectedIncome", "Projected Income", formatMoney),
      ...accounts.map((account, index) => ({
        ...numberColumn(`account:${account}`, account, formatWholeNumber),
        account: true,
        accountStart: index === 0,
      })),
    ];
  }

  function groupedColumns() {
    return [
      textColumn("label", state.groupBy),
      numberColumn("totalCad", "Total CAD", formatMoney),
      numberColumn("holdingPct", "% Holding", formatPercent),
      numberColumn("yieldPct", "Weighted Yield", formatPercent),
      numberColumn("projectedIncome", "Projected Income", formatMoney),
    ];
  }

  function flattenAssetRow(row, accounts) {
    const flat = { ...row };
    for (const account of accounts) flat[`account:${account}`] = row.selectedValues[account];
    return flat;
  }

  function textColumn(key, label) {
    return { key, label, numeric: false, format: (value) => value ?? "—" };
  }

  function numberColumn(key, label, format) {
    return { key, label, numeric: true, format };
  }

  function applyColumnClasses(element, column) {
    element.classList.add(`column-${column.key.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`);
    if (["asset", "label", "totalCad", "holdingPct", "projectedIncome"].includes(column.key)) {
      element.classList.add("mobile-keep-column");
    }
    if (column.numeric) element.classList.add("number");
    if (column.account) element.classList.add("account-column");
    if (column.accountStart) element.classList.add("account-column-start");
  }

  function accountIcon() {
    const icon = svgElement("svg", {
      viewBox: "0 0 16 16",
      class: "account-icon",
      "aria-hidden": "true",
      focusable: "false",
    });
    icon.append(
      svgElement("path", {
        d: "M2.25 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H2.25a1.5 1.5 0 0 1-1.5-1.5V4.25A1.75 1.75 0 0 1 2.5 2.5h9.25",
        fill: "none", stroke: "currentColor", "stroke-width": "1.35",
        "stroke-linecap": "round", "stroke-linejoin": "round",
      }),
      svgElement("path", {
        d: "M10.25 7.25h4v3h-4a1.5 1.5 0 0 1 0-3Z",
        fill: "none", stroke: "currentColor", "stroke-width": "1.35",
      })
    );
    return icon;
  }

  function formatWholeNumber(value) { return value === null || value === undefined ? "—" : wholeNumber.format(value); }
  function formatMoney(value) { return value === null || value === undefined ? "—" : money.format(value); }
  function formatPercent(value) { return value === null || value === undefined ? "—" : `${percentage.format(value)}%`; }

  function compactMoney(value) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 0,
    }).format(value);
  }

  function wedgePath(cx, cy, radius, startAngle, endAngle) {
    const safeEnd = endAngle - startAngle >= 359.999 ? startAngle + 359.999 : endAngle;
    const start = polar(cx, cy, radius, startAngle);
    const end = polar(cx, cy, radius, safeEnd);
    const largeArc = safeEnd - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
  }

  function polar(cx, cy, radius, angle) {
    const radians = angle * Math.PI / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }



    return { initializeControls, syncAccountCheckboxes, renderSnapshot };
  }

  window.SnapshotView = { create: createSnapshotView };
})();
