(function () {
  "use strict";

  const Model = window.HistoryModel;
  const COLOR_SCHEMES = {
    forest: ["#55c795", "#c98c2c", "#4c6fa8", "#9a5f86", "#529186", "#d06f47", "#6f7d45", "#7b6eb1", "#bb5969", "#3f879f", "#9a7544", "#52675d"],
    ocean: ["#58b9df", "#4e86c5", "#59b6aa", "#7b78c8", "#3f9bb0", "#8aacc8", "#4b7794", "#68c4d2", "#8298d1", "#397a91", "#6b91a5", "#526975"],
    aubergine: ["#c28ad8", "#8d74c9", "#d477a8", "#a65e91", "#7868aa", "#d091bd", "#9d6db2", "#b85d80", "#735b86", "#d0a3dc", "#8d5878", "#6e596f"],
    amber: ["#e2a84b", "#c97b39", "#d3c15d", "#af7448", "#e09057", "#9a8e48", "#c85f45", "#d8b875", "#aa6531", "#e2c653", "#9d7952", "#75664e"],
  };
  const money = new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD", maximumFractionDigits: 0,
  });
  const compactMoney = new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1,
  });
  const percent = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
  const dateLabel = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });

  const elements = Object.fromEntries([
    "file-stage", "choose-file", "replace-file", "theme-toggle", "color-scheme",
    "file-input", "error-banner", "dashboard", "file-label", "selection-summary",
    "metric", "stack-by", "time-frame", "start-date", "end-date",
    "select-all-accounts", "clear-all-accounts", "account-options",
    "latest-label", "metric-latest", "latest-date", "metric-change",
    "metric-change-percent", "metric-snapshots", "coverage-label", "metric-coverage",
    "coverage-note", "chart-title", "chart-note", "chart-container", "chart-tooltip",
    "chart-empty", "chart-legend",
  ].map((id) => [camel(id), document.getElementById(id)]));

  const state = {
    history: null,
    filename: "",
    selectedAccounts: new Set(),
    metric: "value",
    stackBy: "account",
    timeFrame: "full",
    startDate: "",
    endDate: "",
  };

  initializeTheme();
  bindFileControls();
  bindControls();

  function bindFileControls() {
    elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
    elements.replaceFile.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", () => {
      const [file] = elements.fileInput.files;
      if (file) openFile(file);
      elements.fileInput.value = "";
    });
    for (const name of ["dragenter", "dragover"]) {
      elements.fileStage.addEventListener(name, (event) => {
        event.preventDefault();
        elements.fileStage.classList.add("is-dragging");
      });
    }
    for (const name of ["dragleave", "drop"]) {
      elements.fileStage.addEventListener(name, (event) => {
        event.preventDefault();
        elements.fileStage.classList.remove("is-dragging");
      });
    }
    elements.fileStage.addEventListener("drop", (event) => {
      const [file] = event.dataTransfer.files;
      if (file) openFile(file);
    });
  }

  function bindControls() {
    elements.themeToggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      store("explorer-theme", next);
    });
    elements.colorScheme.addEventListener("change", () => {
      applyColorScheme(elements.colorScheme.value);
      store("explorer-color-scheme", elements.colorScheme.value);
      render();
    });
    elements.metric.addEventListener("change", () => {
      state.metric = elements.metric.value;
      render();
    });
    elements.stackBy.addEventListener("change", () => {
      state.stackBy = elements.stackBy.value;
      render();
    });
    elements.timeFrame.addEventListener("change", () => {
      state.timeFrame = elements.timeFrame.value;
      applyTimeFrame();
      render();
    });
    elements.startDate.addEventListener("change", () => {
      state.startDate = elements.startDate.value;
      markCustomTimeFrame();
      if (state.startDate > state.endDate) {
        state.endDate = state.startDate;
        elements.endDate.value = state.endDate;
      }
      render();
    });
    elements.endDate.addEventListener("change", () => {
      state.endDate = elements.endDate.value;
      markCustomTimeFrame();
      if (state.endDate < state.startDate) {
        state.startDate = state.endDate;
        elements.startDate.value = state.startDate;
      }
      render();
    });
    elements.selectAllAccounts.addEventListener("click", () => {
      state.selectedAccounts = new Set(state.history.accounts);
      syncAccounts();
      render();
    });
    elements.clearAllAccounts.addEventListener("click", () => {
      state.selectedAccounts = new Set();
      syncAccounts();
      render();
    });
  }

  async function openFile(file) {
    clearError();
    try {
      const history = Model.loadHistory(await file.text());
      state.history = history;
      state.filename = file.name;
      state.selectedAccounts = new Set(history.accounts);
      state.metric = "value";
      state.stackBy = "account";
      state.timeFrame = "full";
      state.endDate = history.snapshots[history.snapshots.length - 1].date;
      state.startDate = history.snapshots[0].date;
      initializeDashboard();
      elements.fileStage.hidden = true;
      elements.dashboard.hidden = false;
      elements.replaceFile.hidden = false;
      document.body.classList.add("dashboard-active");
      render();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function initializeDashboard() {
    elements.metric.value = state.metric;
    elements.timeFrame.value = state.timeFrame;
    elements.stackBy.replaceChildren(option("account", "Account"));
    for (const dimension of state.history.dimensions) {
      elements.stackBy.append(option(dimension, titleCase(dimension)));
    }
    const minimum = state.history.snapshots[0].date;
    const maximum = state.history.snapshots[state.history.snapshots.length - 1].date;
    for (const input of [elements.startDate, elements.endDate]) {
      input.min = minimum;
      input.max = maximum;
    }
    applyTimeFrame();
    elements.accountOptions.replaceChildren();
    state.history.accounts.forEach((account, index) => {
      const label = document.createElement("label");
      label.className = "account-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = account;
      input.id = `history-account-${index}`;
      input.checked = true;
      input.addEventListener("change", () => {
        if (input.checked) state.selectedAccounts.add(account);
        else state.selectedAccounts.delete(account);
        render();
      });
      const text = document.createElement("span");
      text.textContent = account;
      label.append(input, text);
      elements.accountOptions.append(label);
    });
  }

  function render() {
    if (!state.history) return;
    const derived = Model.deriveHistory(state.history, {
      selectedAccounts: state.selectedAccounts,
      startDate: state.startDate,
      endDate: state.endDate,
      stackBy: state.stackBy,
      metric: state.metric,
    });
    elements.fileLabel.textContent = state.filename;
    elements.selectionSummary.textContent = `${derived.accounts.length} of ${state.history.accounts.length} accounts | ${derived.snapshots.length} snapshots`;
    renderMetrics(derived);
    renderChart(derived);
  }

  function renderMetrics(derived) {
    const latest = derived.totals.at(-1) || 0;
    const first = derived.totals[0] || 0;
    const change = latest - first;
    elements.latestLabel.textContent = state.metric === "value" ? "Latest value" : "Latest projected income";
    elements.metricLatest.textContent = money.format(latest);
    elements.latestDate.textContent = derived.snapshots.length
      ? formatDate(derived.snapshots.at(-1).date) : "No snapshots";
    elements.metricChange.textContent = `${change >= 0 ? "+" : ""}${money.format(change)}`;
    elements.metricChangePercent.textContent = first
      ? `${change >= 0 ? "+" : ""}${percent.format(change / first * 100)}% from first snapshot`
      : "First to last snapshot";
    elements.metricSnapshots.textContent = String(derived.snapshots.length);
    elements.coverageLabel.textContent = state.metric === "income" ? "Yield coverage" : "Selected accounts";
    elements.metricCoverage.textContent = state.metric === "income"
      ? derived.coverages.at(-1) === null || derived.coverages.at(-1) === undefined
        ? "-" : `${percent.format(derived.coverages.at(-1))}%`
      : String(derived.accounts.length);
    elements.coverageNote.textContent = state.metric === "income"
      ? "Latest selected snapshot" : "Included in chart";
  }

  function renderChart(derived) {
    const stackLabel = state.stackBy === "account" ? "account" : titleCase(state.stackBy);
    elements.chartTitle.textContent = `${state.metric === "value" ? "Portfolio value" : "Projected annual income"} by ${stackLabel}`;
    elements.chartNote.textContent = derived.snapshots.length
      ? `${formatDate(derived.snapshots[0].date)} to ${formatDate(derived.snapshots.at(-1).date)}` : "";
    elements.chartContainer.replaceChildren();
    elements.chartLegend.replaceChildren();
    elements.chartTooltip.hidden = true;
    const hasData = derived.snapshots.length && derived.series.length
      && Math.max(...derived.totals) > 0;
    elements.chartEmpty.hidden = Boolean(hasData);
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
      class: "history-chart-svg",
      role: "img",
      "aria-label": elements.chartTitle.textContent,
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
      label.textContent = compactMoney.format(value);
      svg.append(label);
    }

    const bottoms = Array(derived.snapshots.length).fill(0);
    for (const series of derived.series) {
      const tops = series.values.map((value, index) => bottoms[index] + value);
      const color = colorFor(series.category);
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
      label.textContent = shortDate(derived.snapshots[index].date);
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
      showTooltip(derived, index, positionX / width * bounds.width);
    });
    overlay.addEventListener("pointerleave", () => {
      hoverLine.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      elements.chartTooltip.hidden = true;
    });
    svg.append(hoverLine, hoverDot, overlay);
    elements.chartContainer.append(svg);
    renderLegend(derived);
  }

  function showTooltip(derived, index, pixelX) {
    const lines = [
      formatDate(derived.snapshots[index].date),
      `Total: ${money.format(derived.totals[index])}`,
    ];
    if (state.metric === "income" && derived.coverages[index] !== null) {
      lines.push(`Yield coverage: ${percent.format(derived.coverages[index])}%`);
    }
    for (const series of derived.series) {
      if (series.values[index] > 0) {
        const share = derived.totals[index] ? series.values[index] / derived.totals[index] * 100 : 0;
        lines.push(`${series.category}: ${money.format(series.values[index])} (${percent.format(share)}%)`);
      }
    }
    elements.chartTooltip.textContent = lines.join("\n");
    elements.chartTooltip.hidden = false;
    const containerWidth = elements.chartContainer.getBoundingClientRect().width;
    elements.chartTooltip.style.left = `${Math.min(Math.max(8, pixelX + 14), containerWidth - 250)}px`;
    elements.chartTooltip.style.top = "20px";
  }

  function renderLegend(derived) {
    for (const series of derived.series) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = colorFor(series.category);
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = series.category;
      const value = document.createElement("span");
      value.className = "legend-value";
      const latest = series.values.at(-1) || 0;
      const total = derived.totals.at(-1) || 0;
      value.textContent = `${money.format(latest)} (${percent.format(total ? latest / total * 100 : 0)}%)`;
      row.append(swatch, label, value);
      elements.chartLegend.append(row);
    }
  }

  function syncAccounts() {
    elements.accountOptions.querySelectorAll("input").forEach((input) => {
      input.checked = state.selectedAccounts.has(input.value);
    });
  }

  function applyTimeFrame() {
    const minimum = state.history.snapshots[0].date;
    const maximum = state.history.snapshots.at(-1).date;
    state.endDate = maximum;
    state.startDate = frameStart(state.timeFrame, minimum, maximum);
    elements.startDate.value = state.startDate;
    elements.endDate.value = state.endDate;
    elements.timeFrame.value = state.timeFrame;
  }

  function frameStart(frame, minimum, maximum) {
    if (frame === "full") return minimum;
    const latest = parseDateParts(maximum);
    let candidate;
    if (frame === "ytd") candidate = `${latest.year}-01-01`;
    else if (frame.endsWith("m")) candidate = shiftMonth(maximum, -Number(frame.slice(0, -1)));
    else if (frame.endsWith("y")) candidate = shiftMonth(maximum, -12 * Number(frame.slice(0, -1)));
    else candidate = minimum;
    return candidate < minimum ? minimum : candidate;
  }

  function markCustomTimeFrame() {
    let custom = elements.timeFrame.querySelector('option[value="custom"]');
    if (!custom) {
      custom = option("custom", "Custom");
      custom.hidden = true;
      elements.timeFrame.append(custom);
    }
    state.timeFrame = "custom";
    elements.timeFrame.value = "custom";
  }

  function shiftMonth(value, offset) {
    const { year, month, day } = parseDateParts(value);
    const target = new Date(Date.UTC(year, month - 1 + offset, 1));
    const targetYear = target.getUTCFullYear();
    const targetMonth = target.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return formatIsoDate(targetYear, targetMonth, Math.min(day, lastDay));
  }

  function parseDateParts(value) {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  }

  function formatIsoDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function option(value, label) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }

  function titleCase(value) {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
  }

  function formatDate(value) { return dateLabel.format(new Date(`${value}T00:00:00Z`)); }
  function shortDate(value) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-CA", { year: "2-digit", month: "short", timeZone: "UTC" }).format(parsed);
  }

  function colorFor(category) {
    const colors = COLOR_SCHEMES[document.documentElement.dataset.scheme] || COLOR_SCHEMES.forest;
    let hash = 0;
    for (const character of category) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function initializeTheme() {
    let theme = "dark";
    let scheme = "forest";
    try { theme = localStorage.getItem("explorer-theme") || theme; } catch (_) { /* use default */ }
    try { scheme = localStorage.getItem("explorer-color-scheme") || scheme; } catch (_) { /* use default */ }
    applyTheme(theme === "light" ? "light" : "dark");
    applyColorScheme(Object.hasOwn(COLOR_SCHEMES, scheme) ? scheme : "forest");
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

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* file storage may be unavailable */ }
  }

  function showError(message) {
    elements.errorBanner.textContent = message;
    elements.errorBanner.hidden = false;
  }

  function clearError() {
    elements.errorBanner.hidden = true;
    elements.errorBanner.textContent = "";
  }

  function camel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
})();
