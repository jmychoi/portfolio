(function () {
  "use strict";

  const Model = window.PortfolioModel;
  const CollectionModel = window.PortfolioCollectionModel;
  const UI_SCHEMES = new Set(["forest", "ocean", "aubergine", "amber"]);
  const MOBILE_QUERY = window.matchMedia("(max-width: 760px)");
  const CHART_COLORS = [
    "#2e7d32", "#1565c0", "#f57c00", "#8e24aa", "#d32f2f", "#00897b",
    "#c0a000", "#6d4c41", "#5e35b1", "#039be5", "#7cb342", "#c2185b",
    "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
    "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#1b9e77", "#d95f02",
    "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666",
    "#1f78b4", "#b2df8a", "#fb9a99", "#cab2d6", "#ff7f00", "#6a3d9a",
  ];

  const elements = {
    fileStage: document.querySelector("#file-stage"),
    headerChooseFile: document.querySelector("#header-choose-file"),
    chooseFile: document.querySelector("#choose-file"),
    loadedContext: document.querySelector("#loaded-context"),
    replaceFile: document.querySelector("#replace-file"),
    themeToggle: document.querySelector("#theme-toggle"),
    colorScheme: document.querySelector("#color-scheme"),
    fileInput: document.querySelector("#file-input"),
    error: document.querySelector("#error-banner"),
    dashboard: document.querySelector("#dashboard"),
    contextSelect: document.querySelector("#context-select"),
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
  if (MOBILE_QUERY.addEventListener) {
    MOBILE_QUERY.addEventListener("change", handleMobileModeChange);
  } else {
    MOBILE_QUERY.addListener(handleMobileModeChange);
  }
  snapshotView = window.SnapshotView.create({ state, render, chartColors, setHeading });
  historyView = window.HistoryView.create({ state, render, chartColors, setHeading });
  historyView.bindHistoryControls();

  elements.headerChooseFile.addEventListener("click", () => elements.fileInput.click());
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
  elements.contextSelect.addEventListener("change", () => {
    if (elements.contextSelect.value === "history") {
      state.viewMode = "history";
    } else {
      state.snapshotIndex = Number(elements.contextSelect.value.replace("snapshot:", ""));
      setPortfolioFromSnapshot();
      state.viewMode = "snapshot";
    }
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
      elements.loadedContext.hidden = false;
      elements.headerChooseFile.hidden = true;
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
    initializeSinglePortfolioContext(portfolio);
    elements.contextSelect.hidden = false;
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
    initializeContextSelect();
    historyView.initializeCollectionControls();
    setPortfolioFromSnapshot();
    elements.contextSelect.hidden = false;
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
      elements.contextSelect.value = state.viewMode === "history"
        ? "history" : `snapshot:${state.snapshotIndex}`;
    }
  }

  function render() {
    if (!state.portfolio) return;
    applyMobileAccountDefaults();
    if (state.collection && state.viewMode === "history") historyView.renderHistory();
    else snapshotView.renderSnapshot();
  }

  function handleMobileModeChange() {
    initializeTheme();
    if (state.portfolio) render();
  }

  function applyMobileAccountDefaults() {
    if (!MOBILE_QUERY.matches) return;
    state.selectedAccounts = new Set(state.portfolio.accounts);
    snapshotView.syncAccountCheckboxes();
    if (state.collection) {
      state.historySelectedAccounts = new Set(state.collection.accounts);
      historyView.syncHistoryAccountCheckboxes();
    }
  }

  function setHeading(label) {
    elements.replaceFile.textContent = label;
    elements.replaceFile.setAttribute("aria-label", `Choose another portfolio file. Current file: ${label}`);
  }

  function initializeContextSelect() {
    elements.contextSelect.replaceChildren();
    const history = document.createElement("option");
    history.value = "history";
    history.textContent = "History view";
    elements.contextSelect.append(history);
    state.collection.snapshots
      .map((snapshot, index) => ({ snapshot, index }))
      .reverse()
      .forEach(({ snapshot, index }) => {
        const item = document.createElement("option");
        item.value = `snapshot:${index}`;
        item.textContent = snapshot.date;
        elements.contextSelect.append(item);
      });
    elements.contextSelect.value = "history";
  }

  function initializeSinglePortfolioContext(portfolio) {
    elements.contextSelect.replaceChildren();
    const snapshot = document.createElement("option");
    snapshot.value = "snapshot:0";
    snapshot.textContent = portfolio.date;
    elements.contextSelect.append(snapshot);
    elements.contextSelect.value = "snapshot:0";
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
    if (!MOBILE_QUERY.matches) {
      try { theme = localStorage.getItem("explorer-theme") || "dark"; } catch (_) { /* use default */ }
      try { scheme = localStorage.getItem("explorer-color-scheme") || "forest"; } catch (_) { /* use default */ }
    }
    applyTheme(theme === "light" ? "light" : "dark");
    applyColorScheme(UI_SCHEMES.has(scheme) ? scheme : "forest");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    elements.themeToggle.textContent = dark ? "Light" : "Dark";
    elements.themeToggle.setAttribute("aria-pressed", String(dark));
  }

  function applyColorScheme(scheme) {
    document.documentElement.dataset.scheme = scheme;
    elements.colorScheme.value = scheme;
  }

  function chartColors() {
    return CHART_COLORS;
  }

  function pageRoot() {
    return document.body || document.documentElement;
  }
})();
