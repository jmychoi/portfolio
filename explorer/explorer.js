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

  let snapshotView;
  let historyView;

  initializeTheme();
  snapshotView = window.SnapshotView.create({ state, render, chartColors, setHeading });
  historyView = window.HistoryView.create({ state, render, chartColors, setHeading });
  historyView.bindHistoryControls();

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

  async function openFile(file) {
    clearError();
    try {
      const text = await file.text();
      state.filename = file.name;
      const document = parseJson(text);
      if (document.kind === "portfolioCollection") openCollection(document);
      else openPortfolio(Model.loadPortfolioDocument(document));
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
    snapshotView.initializeControls();
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
    historyView.initializeCollectionControls();
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
    snapshotView.initializeControls();
  }

  function switchView() {
    elements.snapshotView.hidden = state.viewMode !== "snapshot";
    elements.historyView.hidden = state.viewMode !== "history";
    if (state.collection) {
      elements.snapshotSelect.value = String(state.snapshotIndex);
      elements.viewMode.value = state.viewMode;
    }
  }

  function render() {
    if (!state.portfolio) return;
    if (state.collection && state.viewMode === "history") historyView.renderHistory();
    else snapshotView.renderSnapshot();
  }

  function setHeading(label, summary) {
    elements.fileLabel.textContent = label;
    elements.selectionSummary.textContent = summary;
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
