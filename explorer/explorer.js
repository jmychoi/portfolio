(function () {
  "use strict";

  const Model = window.PortfolioModel;
  const CollectionModel = window.PortfolioCollectionModel;
  const COLOR_SCHEMES = {
    forest: ["#55c795", "#c98c2c", "#4c6fa8", "#9a5f86", "#529186", "#d06f47", "#6f7d45", "#7b6eb1", "#bb5969", "#3f879f", "#9a7544", "#52675d"],
    ocean: ["#58b9df", "#4e86c5", "#59b6aa", "#7b78c8", "#3f9bb0", "#8aacc8", "#4b7794", "#68c4d2", "#8298d1", "#397a91", "#6b91a5", "#526975"],
    aubergine: ["#c28ad8", "#8d74c9", "#d477a8", "#a65e91", "#7868aa", "#d091bd", "#9d6db2", "#b85d80", "#735b86", "#d0a3dc", "#8d5878", "#6e596f"],
    amber: ["#e2a84b", "#c97b39", "#d3c15d", "#af7448", "#e09057", "#9a8e48", "#c85f45", "#d8b875", "#aa6531", "#e2c653", "#9d7952", "#75664e"],
  };
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
    fileStage: document.querySelector("#file-stage"),
    chooseFile: document.querySelector("#choose-file"),
    replaceFile: document.querySelector("#replace-file"),
    themeToggle: document.querySelector("#theme-toggle"),
    colorScheme: document.querySelector("#color-scheme"),
    fileInput: document.querySelector("#file-input"),
    error: document.querySelector("#error-banner"),
    dashboard: document.querySelector("#dashboard"),
    fileLabel: document.querySelector("#file-label"),
    selectionSummary: document.querySelector("#selection-summary"),
    viewControls: document.querySelector("#view-controls"),
    viewMode: document.querySelector("#view-mode"),
    snapshotSelect: document.querySelector("#snapshot-select"),
    snapshotView: document.querySelector("#snapshot-view"),
    historyView: document.querySelector("#history-view"),
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
    historyMetric: document.querySelector("#history-metric"),
    historyStackBy: document.querySelector("#history-stack-by"),
    historyTimeFrame: document.querySelector("#history-time-frame"),
    historyStartDate: document.querySelector("#history-start-date"),
    historyEndDate: document.querySelector("#history-end-date"),
    historySelectAllAccounts: document.querySelector("#history-select-all-accounts"),
    historyClearAllAccounts: document.querySelector("#history-clear-all-accounts"),
    historyAccounts: document.querySelector("#history-account-options"),
    historyLatestLabel: document.querySelector("#history-latest-label"),
    historyMetricLatest: document.querySelector("#history-metric-latest"),
    historyLatestDate: document.querySelector("#history-latest-date"),
    historyMetricChange: document.querySelector("#history-metric-change"),
    historyMetricChangePercent: document.querySelector("#history-metric-change-percent"),
    historyMetricSnapshots: document.querySelector("#history-metric-snapshots"),
    historyCoverageLabel: document.querySelector("#history-coverage-label"),
    historyMetricCoverage: document.querySelector("#history-metric-coverage"),
    historyCoverageNote: document.querySelector("#history-coverage-note"),
    historyChartTitle: document.querySelector("#history-chart-title"),
    historyChartNote: document.querySelector("#history-chart-note"),
    historyChartContainer: document.querySelector("#history-chart-container"),
    historyChartTooltip: document.querySelector("#history-chart-tooltip"),
    historyChartEmpty: document.querySelector("#history-chart-empty"),
    historyChartLegend: document.querySelector("#history-chart-legend"),
  };

  const state = {
    portfolio: null,
    collection: null,
    filename: "",
    viewMode: "snapshot",
    snapshotIndex: 0,
    selectedAccounts: new Set(),
    groupBy: "None",
    sortKeys: [{ key: "holdingPct", direction: "desc" }],
    historySelectedAccounts: new Set(),
    historyMetric: "value",
    historyStackBy: "account",
    historyTimeFrame: "full",
    historyStartDate: "",
    historyEndDate: "",
  };

  initializeTheme();

  elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
  elements.replaceFile.addEventListener("click", () => elements.fileInput.click());
  elements.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("explorer-theme", next); } catch (_) { /* file:// storage may be unavailable */ }
  });
  elements.colorScheme.addEventListener("change", () => {
    applyColorScheme(elements.colorScheme.value);
    try { localStorage.setItem("explorer-color-scheme", elements.colorScheme.value); } catch (_) { /* file:// storage may be unavailable */ }
    render();
  });
  elements.viewMode.addEventListener("change", () => {
    state.viewMode = elements.viewMode.value;
    switchView();
    render();
  });
  elements.snapshotSelect.addEventListener("change", () => {
    state.snapshotIndex = Number(elements.snapshotSelect.value);
    setPortfolioFromSnapshot();
    state.viewMode = "snapshot";
    elements.viewMode.value = "snapshot";
    switchView();
    render();
  });
  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files;
    if (file) openFile(file);
    elements.fileInput.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.fileStage.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.fileStage.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.fileStage.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.fileStage.classList.remove("is-dragging");
    });
  }
  elements.fileStage.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) openFile(file);
  });

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
  bindHistoryControls();

  async function openFile(file) {
    clearError();
    try {
      const text = await file.text();
      state.filename = file.name;
      const document = parseJson(text);
      if (document.kind === "portfolioCollection") {
        openCollection(document);
      } else {
        openPortfolio(Model.loadPortfolioDocument(document));
      }
      elements.fileStage.hidden = true;
      elements.dashboard.hidden = false;
      elements.replaceFile.hidden = false;
      pageRoot().classList.add("dashboard-active");
      render();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function parseJson(text) {
    try {
      return JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch (_) {
      throw new Error("The selected file is not valid JSON");
    }
  }

  function openPortfolio(portfolio) {
    state.collection = null;
    state.portfolio = portfolio;
    state.viewMode = "snapshot";
    state.snapshotIndex = 0;
    state.selectedAccounts = new Set(portfolio.accounts);
    state.groupBy = "None";
    state.sortKeys = [{ key: "holdingPct", direction: "desc" }];
    elements.viewControls.hidden = true;
    initializeControls();
    switchView();
  }

  function openCollection(document) {
    const collection = CollectionModel.loadCollection(JSON.stringify(document));
    state.collection = collection;
    state.viewMode = "history";
    state.snapshotIndex = collection.snapshots.length - 1;
    state.historySelectedAccounts = new Set(collection.accounts);
    state.historyMetric = "value";
    state.historyStackBy = "account";
    state.historyTimeFrame = "full";
    initializeCollectionControls();
    setPortfolioFromSnapshot();
    elements.viewControls.hidden = false;
    elements.viewMode.value = "history";
    switchView();
  }

  function setPortfolioFromSnapshot() {
    const snapshot = state.collection.snapshots[state.snapshotIndex];
    state.portfolio = snapshot;
    state.selectedAccounts = new Set(snapshot.accounts);
    state.groupBy = "None";
    state.sortKeys = [{ key: "holdingPct", direction: "desc" }];
    initializeControls();
  }

  function bindHistoryControls() {
    elements.historyMetric.addEventListener("change", () => {
      state.historyMetric = elements.historyMetric.value;
      render();
    });
    elements.historyStackBy.addEventListener("change", () => {
      state.historyStackBy = elements.historyStackBy.value;
      render();
    });
    elements.historyTimeFrame.addEventListener("change", () => {
      state.historyTimeFrame = elements.historyTimeFrame.value;
      applyHistoryTimeFrame();
      render();
    });
    elements.historyStartDate.addEventListener("change", () => {
      state.historyStartDate = elements.historyStartDate.value;
      markCustomHistoryTimeFrame();
      if (state.historyStartDate > state.historyEndDate) {
        state.historyEndDate = state.historyStartDate;
        elements.historyEndDate.value = state.historyEndDate;
      }
      render();
    });
    elements.historyEndDate.addEventListener("change", () => {
      state.historyEndDate = elements.historyEndDate.value;
      markCustomHistoryTimeFrame();
      if (state.historyEndDate < state.historyStartDate) {
        state.historyStartDate = state.historyEndDate;
        elements.historyStartDate.value = state.historyStartDate;
      }
      render();
    });
    elements.historySelectAllAccounts.addEventListener("click", () => {
      state.historySelectedAccounts = new Set(state.collection.accounts);
      syncHistoryAccountCheckboxes();
      render();
    });
    elements.historyClearAllAccounts.addEventListener("click", () => {
      state.historySelectedAccounts = new Set();
      syncHistoryAccountCheckboxes();
      render();
    });
  }

  function initializeCollectionControls() {
    elements.snapshotSelect.replaceChildren();
    state.collection.snapshots.forEach((snapshot, index) => {
      const item = document.createElement("option");
      item.value = String(index);
      item.textContent = snapshot.date;
      elements.snapshotSelect.append(item);
    });
    elements.snapshotSelect.value = String(state.snapshotIndex);

    elements.historyMetric.value = state.historyMetric;
    elements.historyTimeFrame.value = state.historyTimeFrame;
    elements.historyStackBy.replaceChildren(collectionOption("account", "Account"));
    for (const dimension of state.collection.dimensions) {
      elements.historyStackBy.append(collectionOption(dimension, titleCase(dimension)));
    }
    elements.historyStackBy.value = state.historyStackBy;

    const minimum = state.collection.snapshots[0].date;
    const maximum = state.collection.snapshots[state.collection.snapshots.length - 1].date;
    for (const input of [elements.historyStartDate, elements.historyEndDate]) {
      input.min = minimum;
      input.max = maximum;
    }
    applyHistoryTimeFrame();

    elements.historyAccounts.replaceChildren();
    state.collection.accounts.forEach((account, index) => {
      const label = document.createElement("label");
      label.className = "account-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = account;
      input.id = `history-account-${index}`;
      input.checked = true;
      input.addEventListener("change", () => {
        if (input.checked) state.historySelectedAccounts.add(account);
        else state.historySelectedAccounts.delete(account);
        render();
      });
      const text = document.createElement("span");
      text.textContent = account;
      label.append(input, text);
      elements.historyAccounts.append(label);
    });
  }

  function switchView() {
    elements.snapshotView.hidden = state.viewMode !== "snapshot";
    elements.historyView.hidden = state.viewMode !== "history";
    if (state.collection) {
      elements.snapshotSelect.value = String(state.snapshotIndex);
      elements.viewMode.value = state.viewMode;
    }
  }

  function renderHistory() {
    const derived = CollectionModel.deriveCollectionHistory(state.collection, {
      selectedAccounts: state.historySelectedAccounts,
      startDate: state.historyStartDate,
      endDate: state.historyEndDate,
      stackBy: state.historyStackBy,
      metric: state.historyMetric,
    });
    elements.fileLabel.textContent = `${state.filename} · History`;
    elements.selectionSummary.textContent = `${derived.accounts.length} of ${state.collection.accounts.length} accounts · ${derived.snapshots.length} snapshots`;
    renderHistoryMetrics(derived);
    renderHistoryChart(derived);
  }

  function renderHistoryMetrics(derived) {
    const latest = derived.totals.at(-1) || 0;
    const first = derived.totals[0] || 0;
    const change = latest - first;
    elements.historyLatestLabel.textContent = state.historyMetric === "value" ? "Latest value" : "Latest projected income";
    elements.historyMetricLatest.textContent = money.format(latest);
    elements.historyLatestDate.textContent = derived.snapshots.length
      ? formatHistoryDate(derived.snapshots.at(-1).date) : "No snapshots";
    elements.historyMetricChange.textContent = `${change >= 0 ? "+" : ""}${money.format(change)}`;
    elements.historyMetricChangePercent.textContent = first
      ? `${change >= 0 ? "+" : ""}${historyPercent(change / first * 100)}% from first snapshot`
      : "First to last snapshot";
    elements.historyMetricSnapshots.textContent = String(derived.snapshots.length);
    elements.historyCoverageLabel.textContent = state.historyMetric === "income" ? "Yield coverage" : "Selected accounts";
    elements.historyMetricCoverage.textContent = state.historyMetric === "income"
      ? derived.coverages.at(-1) === null || derived.coverages.at(-1) === undefined
        ? "—" : `${historyPercent(derived.coverages.at(-1))}%`
      : String(derived.accounts.length);
    elements.historyCoverageNote.textContent = state.historyMetric === "income"
      ? "Latest selected snapshot" : "Included in chart";
  }

  function renderHistoryChart(derived) {
    const stackLabel = state.historyStackBy === "account" ? "account" : titleCase(state.historyStackBy);
    elements.historyChartTitle.textContent = `${state.historyMetric === "value" ? "Portfolio value" : "Projected annual income"} by ${stackLabel}`;
    elements.historyChartNote.textContent = derived.snapshots.length
      ? `${formatHistoryDate(derived.snapshots[0].date)} to ${formatHistoryDate(derived.snapshots.at(-1).date)}` : "";
    elements.historyChartContainer.replaceChildren();
    elements.historyChartLegend.replaceChildren();
    elements.historyChartTooltip.hidden = true;
    const hasData = derived.snapshots.length && derived.series.length && Math.max(...derived.totals) > 0;
    elements.historyChartEmpty.hidden = Boolean(hasData);
    if (!hasData) return;

    const width = 1200;
    const height = 560;
    const margin = { top: 24, right: 28, bottom: 54, left: 86 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const times = derived.snapshots.map((snapshot) => Date.parse(`${snapshot.date}T00:00:00Z`));
    const minimumTime = times[0];
    const maximumTime = times.at(-1);
    const x = (time) => margin.left + (maximumTime === minimumTime
      ? innerWidth / 2 : (time - minimumTime) / (maximumTime - minimumTime) * innerWidth);
    const maximumValue = Math.max(...derived.totals) * 1.04;
    const y = (value) => margin.top + innerHeight - value / maximumValue * innerHeight;
    const svg = svgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      class: "history-chart-svg",
      role: "img",
      "aria-label": elements.historyChartTitle.textContent,
    });

    for (let index = 0; index <= 5; index += 1) {
      const value = maximumValue * index / 5;
      const position = y(value);
      svg.append(svgElement("line", {
        x1: margin.left, x2: width - margin.right, y1: position, y2: position,
        class: "chart-grid-line",
      }));
      const label = svgElement("text", {
        x: margin.left - 12, y: position + 4, class: "chart-axis-label", "text-anchor": "end",
      });
      label.textContent = compactMoney(value);
      svg.append(label);
    }

    const bottoms = Array(derived.snapshots.length).fill(0);
    for (const series of derived.series) {
      const tops = series.values.map((value, index) => bottoms[index] + value);
      const color = colorForHistory(series.category);
      svg.append(svgElement("path", {
        d: areaPath(times, tops, bottoms, x, y),
        class: "chart-area", fill: color, color,
      }));
      for (let index = 0; index < bottoms.length; index += 1) bottoms[index] = tops[index];
    }
    svg.append(svgElement("path", {
      d: linePath(times, derived.totals, x, y), class: "chart-total-line",
    }));

    for (const index of tickIndexes(derived.snapshots.length, 8)) {
      const label = svgElement("text", {
        x: x(times[index]), y: height - 19, class: "chart-axis-label", "text-anchor": "middle",
      });
      label.textContent = shortHistoryDate(derived.snapshots[index].date);
      svg.append(label);
    }

    const hoverLine = svgElement("line", {
      y1: margin.top, y2: height - margin.bottom, class: "chart-hover-line", visibility: "hidden",
    });
    const hoverDot = svgElement("circle", {
      r: 5, class: "chart-hover-dot", visibility: "hidden",
    });
    const overlay = svgElement("rect", {
      x: margin.left, y: margin.top, width: innerWidth, height: innerHeight, class: "chart-overlay",
    });
    overlay.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const pointerX = (event.clientX - bounds.left) / bounds.width * width;
      const index = nearestIndex(times.map(x), pointerX);
      const positionX = x(times[index]);
      hoverLine.setAttribute("x1", positionX);
      hoverLine.setAttribute("x2", positionX);
      hoverLine.setAttribute("visibility", "visible");
      hoverDot.setAttribute("cx", positionX);
      hoverDot.setAttribute("cy", y(derived.totals[index]));
      hoverDot.setAttribute("visibility", "visible");
      showHistoryTooltip(derived, index, positionX / width * bounds.width);
    });
    overlay.addEventListener("pointerleave", () => {
      hoverLine.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      elements.historyChartTooltip.hidden = true;
    });
    svg.append(hoverLine, hoverDot, overlay);
    elements.historyChartContainer.append(svg);
    renderHistoryLegend(derived);
  }

  function showHistoryTooltip(derived, index, pixelX) {
    const lines = [
      formatHistoryDate(derived.snapshots[index].date),
      `Total: ${money.format(derived.totals[index])}`,
    ];
    if (state.historyMetric === "income" && derived.coverages[index] !== null) {
      lines.push(`Yield coverage: ${historyPercent(derived.coverages[index])}%`);
    }
    for (const series of derived.series) {
      if (series.values[index] > 0) {
        const share = derived.totals[index] ? series.values[index] / derived.totals[index] * 100 : 0;
        lines.push(`${series.category}: ${money.format(series.values[index])} (${historyPercent(share)}%)`);
      }
    }
    elements.historyChartTooltip.textContent = lines.join("\n");
    elements.historyChartTooltip.hidden = false;
    const containerWidth = elements.historyChartContainer.getBoundingClientRect().width;
    elements.historyChartTooltip.style.left = `${Math.min(Math.max(8, pixelX + 14), containerWidth - 250)}px`;
    elements.historyChartTooltip.style.top = "20px";
  }

  function renderHistoryLegend(derived) {
    for (const series of derived.series) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = colorForHistory(series.category);
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = series.category;
      const value = document.createElement("span");
      value.className = "legend-value";
      const latest = series.values.at(-1) || 0;
      const total = derived.totals.at(-1) || 0;
      value.textContent = `${money.format(latest)} (${historyPercent(total ? latest / total * 100 : 0)}%)`;
      row.append(swatch, label, value);
      elements.historyChartLegend.append(row);
    }
  }

  function syncHistoryAccountCheckboxes() {
    elements.historyAccounts.querySelectorAll("input").forEach((input) => {
      input.checked = state.historySelectedAccounts.has(input.value);
    });
  }

  function applyHistoryTimeFrame() {
    const minimum = state.collection.snapshots[0].date;
    const maximum = state.collection.snapshots.at(-1).date;
    state.historyEndDate = maximum;
    state.historyStartDate = historyFrameStart(state.historyTimeFrame, minimum, maximum);
    elements.historyStartDate.value = state.historyStartDate;
    elements.historyEndDate.value = state.historyEndDate;
    elements.historyTimeFrame.value = state.historyTimeFrame;
  }

  function historyFrameStart(frame, minimum, maximum) {
    if (frame === "full") return minimum;
    const latest = parseDateParts(maximum);
    let candidate;
    if (frame === "ytd") candidate = `${latest.year}-01-01`;
    else if (frame.endsWith("m")) candidate = shiftMonth(maximum, -Number(frame.slice(0, -1)));
    else if (frame.endsWith("y")) candidate = shiftMonth(maximum, -12 * Number(frame.slice(0, -1)));
    else candidate = minimum;
    return candidate < minimum ? minimum : candidate;
  }

  function markCustomHistoryTimeFrame() {
    let custom = elements.historyTimeFrame.querySelector('option[value="custom"]');
    if (!custom) {
      custom = collectionOption("custom", "Custom");
      custom.hidden = true;
      elements.historyTimeFrame.append(custom);
    }
    state.historyTimeFrame = "custom";
    elements.historyTimeFrame.value = "custom";
  }

  function shiftMonth(value, offset) {
    const { year, month, day } = parseDateParts(value);
    const target = new Date(Date.UTC(year, month - 1 + offset, 1));
    const targetYear = target.getUTCFullYear();
    const targetMonth = target.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }

  function parseDateParts(value) {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  }

  function areaPath(times, tops, bottoms, x, y) {
    const upper = times.map((time, index) => `${index ? "L" : "M"}${x(time)} ${y(tops[index])}`).join(" ");
    const lower = times.map((time, index) => ({ time, value: bottoms[index] })).reverse()
      .map((point) => `L${x(point.time)} ${y(point.value)}`).join(" ");
    return `${upper} ${lower} Z`;
  }

  function linePath(times, values, x, y) {
    return times.map((time, index) => `${index ? "L" : "M"}${x(time)} ${y(values[index])}`).join(" ");
  }

  function tickIndexes(length, maximum) {
    if (length <= maximum) return Array.from({ length }, (_, index) => index);
    const result = new Set([0, length - 1]);
    for (let index = 1; index < maximum - 1; index += 1) {
      result.add(Math.round(index * (length - 1) / (maximum - 1)));
    }
    return [...result].sort((left, right) => left - right);
  }

  function nearestIndex(values, target) {
    let best = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (Math.abs(values[index] - target) < Math.abs(values[best] - target)) best = index;
    }
    return best;
  }

  function collectionOption(value, label) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }

  function titleCase(value) {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
  }

  function formatHistoryDate(value) {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function shortHistoryDate(value) {
    return new Intl.DateTimeFormat("en-CA", {
      year: "2-digit", month: "short", timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function historyPercent(value) {
    return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(value);
  }

  function colorForHistory(category) {
    const colors = chartColors();
    let hash = 0;
    for (const character of category) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

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

  function render() {
    if (!state.portfolio) return;
    if (state.collection && state.viewMode === "history") {
      renderHistory();
      return;
    }
    const derived = Model.deriveAssets(state.portfolio, state.selectedAccounts);
    const summary = Model.summarize(derived);
    const grouped = state.groupBy === "None" ? null : Model.groupAssets(derived, state.groupBy);
    renderHeading(derived);
    renderMetrics(summary);
    renderTable(derived, grouped);
    renderChart(derived);
  }

  function renderHeading(derived) {
    elements.fileLabel.textContent = state.collection
      ? `${state.filename} · ${state.viewMode === "history" ? "History" : state.portfolio.date}`
      : state.filename;
    const count = state.selectedAccounts.size;
    elements.selectionSummary.textContent = `${count} of ${state.portfolio.accounts.length} accounts · ${derived.rows.length} active assets`;
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

  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
  }

  function clearError() {
    elements.error.hidden = true;
    elements.error.textContent = "";
  }

  function initializeTheme() {
    let theme = "dark";
    let scheme = "forest";
    try { theme = localStorage.getItem("explorer-theme") || "dark"; } catch (_) { /* use default */ }
    try { scheme = localStorage.getItem("explorer-color-scheme") || "forest"; } catch (_) { /* use default */ }
    applyTheme(theme === "light" ? "light" : "dark");
    applyColorScheme(Object.prototype.hasOwnProperty.call(COLOR_SCHEMES, scheme) ? scheme : "forest");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    elements.themeToggle.textContent = dark ? "Light mode" : "Dark mode";
    elements.themeToggle.setAttribute("aria-pressed", String(dark));
  }

  function applyColorScheme(scheme) {
    document.documentElement.dataset.scheme = scheme;
    elements.colorScheme.value = scheme;
  }

  function chartColors() {
    return COLOR_SCHEMES[document.documentElement.dataset.scheme] || COLOR_SCHEMES.forest;
  }

  function pageRoot() {
    return document.body || document.documentElement;
  }
})();
