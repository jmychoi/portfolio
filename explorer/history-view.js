(function () {
  "use strict";

  function createHistoryView(options) {
    const { state, render, chartColors, setHeading } = options;
    const CollectionModel = window.PortfolioCollectionModel;
    const money = new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    const elements = {
      historyMetric: document.querySelector("#history-metric"),
      historyStackBy: document.querySelector("#history-stack-by"),
      historyTimeFrame: document.querySelector("#history-time-frame"),
      historyStartDate: document.querySelector("#history-start-date"),
      historyEndDate: document.querySelector("#history-end-date"),
      customDateControls: document.querySelectorAll(".custom-date-control"),
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
      if (state.historyStartDate > state.historyEndDate) {
        state.historyEndDate = state.historyStartDate;
        elements.historyEndDate.value = state.historyEndDate;
      }
      render();
    });
    elements.historyEndDate.addEventListener("change", () => {
      state.historyEndDate = elements.historyEndDate.value;
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

  function renderHistory() {
    const derived = CollectionModel.deriveCollectionHistory(state.collection, {
      selectedAccounts: state.historySelectedAccounts,
      startDate: state.historyStartDate,
      endDate: state.historyEndDate,
      stackBy: state.historyStackBy,
      metric: state.historyMetric,
    });
    setHeading(state.filename);
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
    derived.series.forEach((series, seriesIndex) => {
      const tops = series.values.map((value, index) => bottoms[index] + value);
      const color = colorForSeriesIndex(seriesIndex);
      svg.append(svgElement("path", {
        d: areaPath(times, tops, bottoms, x, y),
        class: "chart-area", fill: color, color,
      }));
      for (let index = 0; index < bottoms.length; index += 1) bottoms[index] = tops[index];
    });
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
    derived.series.forEach((series, seriesIndex) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = colorForSeriesIndex(seriesIndex);
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
    });
  }

  function syncHistoryAccountCheckboxes() {
    elements.historyAccounts.querySelectorAll("input").forEach((input) => {
      input.checked = state.historySelectedAccounts.has(input.value);
    });
  }

  function applyHistoryTimeFrame() {
    const minimum = state.collection.snapshots[0].date;
    const maximum = state.collection.snapshots.at(-1).date;
    if (state.historyTimeFrame !== "custom") {
      state.historyEndDate = maximum;
      state.historyStartDate = historyFrameStart(state.historyTimeFrame, minimum, maximum);
    }
    elements.historyStartDate.value = state.historyStartDate;
    elements.historyEndDate.value = state.historyEndDate;
    elements.historyTimeFrame.value = state.historyTimeFrame;
    toggleCustomDateControls();
  }

  function historyFrameStart(frame, minimum, maximum) {
    if (frame === "full") return minimum;
    if (frame === "previous") {
      const snapshots = state.collection.snapshots;
      return snapshots.length >= 2 ? snapshots.at(-2).date : minimum;
    }
    const latest = parseDateParts(maximum);
    let candidate;
    if (frame === "ytd") candidate = `${latest.year}-01-01`;
    else if (frame.endsWith("m")) candidate = shiftMonth(maximum, -Number(frame.slice(0, -1)));
    else if (frame.endsWith("y")) candidate = shiftMonth(maximum, -12 * Number(frame.slice(0, -1)));
    else candidate = minimum;
    return candidate < minimum ? minimum : candidate;
  }

  function toggleCustomDateControls() {
    const hidden = state.historyTimeFrame !== "custom";
    elements.customDateControls.forEach((control) => {
      control.hidden = hidden;
    });
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
    return new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  function colorForSeriesIndex(index) {
    const colors = chartColors();
    return colors[index % colors.length];
  }



  function compactMoney(value) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 0,
    }).format(value);
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

    return { bindHistoryControls, initializeCollectionControls, syncHistoryAccountCheckboxes, applyHistoryTimeFrame, renderHistory };
  }

  window.HistoryView = { create: createHistoryView };
})();
