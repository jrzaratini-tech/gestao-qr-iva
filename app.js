const STORAGE_KEY = "gestao-qr-iva-state-v1";

const defaultCategories = [
  "Combustivel",
  "Telecomunicacoes",
  "Material",
  "Servicos",
  "Renda",
  "Coimas",
  "Guia de IVA",
  "Vendas",
];

const state = loadState();
let selectedMonth = new Date().toISOString().slice(0, 7);
let currentEntryType = "expense";
let editingId = null;
let cameraStream = null;
let scanTimer = null;
let scanFrame = null;
let deferredInstallPrompt = null;

const els = {
  screens: document.querySelectorAll(".screen"),
  navButtons: document.querySelectorAll("[data-nav]"),
  periodLabel: document.querySelector("#periodLabel"),
  ivaBalance: document.querySelector("#ivaBalance"),
  ivaStatus: document.querySelector("#ivaStatus"),
  ivaCard: document.querySelector("#ivaCard"),
  totalIncome: document.querySelector("#totalIncome"),
  totalExpense: document.querySelector("#totalExpense"),
  operationalBalance: document.querySelector("#operationalBalance"),
  netResult: document.querySelector("#netResult"),
  vatLiquidated: document.querySelector("#vatLiquidated"),
  vatSupported: document.querySelector("#vatSupported"),
  recentList: document.querySelector("#recentList"),
  documentList: document.querySelector("#documentList"),
  entryForm: document.querySelector("#entryForm"),
  duplicateWarning: document.querySelector("#duplicateWarning"),
  rawQrInput: document.querySelector("#rawQrInput"),
  cameraPreview: document.querySelector("#cameraPreview"),
  scannerHint: document.querySelector("#scannerHint"),
  startScanner: document.querySelector("#startScanner"),
  stopScanner: document.querySelector("#stopScanner"),
  settingsForm: document.querySelector("#settingsForm"),
  filterType: document.querySelector("#filterType"),
  searchInput: document.querySelector("#searchInput"),
  categoryOptions: document.querySelector("#categoryOptions"),
  installButton: document.querySelector("#installButton"),
};

const fields = {
  issuerNif: document.querySelector("#issuerNif"),
  issuerName: document.querySelector("#issuerName"),
  buyerNif: document.querySelector("#buyerNif"),
  docType: document.querySelector("#docType"),
  docNumber: document.querySelector("#docNumber"),
  docDate: document.querySelector("#docDate"),
  grossTotal: document.querySelector("#grossTotal"),
  netTotal: document.querySelector("#netTotal"),
  vatTotal: document.querySelector("#vatTotal"),
  category: document.querySelector("#category"),
  paymentStatus: document.querySelector("#paymentStatus"),
  paymentMethod: document.querySelector("#paymentMethod"),
  notes: document.querySelector("#notes"),
  userName: document.querySelector("#userName"),
  ownNif: document.querySelector("#ownNif"),
  currency: document.querySelector("#currency"),
};

init();

function init() {
  bindEvents();
  hydrateSettings();
  renderCategories();
  renderAll();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.nav));
  });

  document.querySelector("#prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.querySelector("#nextMonth").addEventListener("click", () => shiftMonth(1));
  document.querySelector("#parseQr").addEventListener("click", () => applyParsedQr(els.rawQrInput.value));
  document.querySelector("#resetForm").addEventListener("click", resetForm);
  document.querySelector("#exportCsv").addEventListener("click", exportCsv);
  els.startScanner.addEventListener("click", startScanner);
  els.stopScanner.addEventListener("click", stopScanner);
  els.filterType.addEventListener("change", renderList);
  els.searchInput.addEventListener("input", renderList);

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => setEntryType(button.dataset.type));
  });

  ["issuerNif", "docType", "docNumber", "docDate", "grossTotal"].forEach((name) => {
    fields[name].addEventListener("input", checkDuplicate);
  });

  els.entryForm.addEventListener("submit", saveEntry);
  els.settingsForm.addEventListener("submit", saveSettings);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}

function navigate(name) {
  stopScanner();
  els.screens.forEach((screen) => screen.classList.toggle("active", screen.id === `${name}Screen`));
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
  if (name === "list") renderList();
}

function shiftMonth(delta) {
  const date = new Date(`${selectedMonth}-01T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  selectedMonth = date.toISOString().slice(0, 7);
  renderDashboard();
}

function loadState() {
  const fallback = {
    settings: { userName: "", ownNif: "", currency: "EUR" },
    documents: [],
    categories: defaultCategories,
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hydrateSettings() {
  fields.userName.value = state.settings.userName || "";
  fields.ownNif.value = state.settings.ownNif || "";
  fields.currency.value = state.settings.currency || "EUR";
}

function saveSettings(event) {
  event.preventDefault();
  state.settings = {
    userName: fields.userName.value.trim(),
    ownNif: onlyDigits(fields.ownNif.value),
    currency: (fields.currency.value || "EUR").trim().toUpperCase(),
  };
  persist();
  renderAll();
  navigate("dashboard");
}

function renderAll() {
  renderDashboard();
  renderList();
}

function renderDashboard() {
  const docs = activeDocs().filter((doc) => doc.docDate?.startsWith(selectedMonth));
  const totals = calculateTotals(docs);
  const currency = state.settings.currency || "EUR";
  const periodDate = new Date(`${selectedMonth}-02T00:00:00`);

  els.periodLabel.textContent = periodDate.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  els.totalIncome.textContent = money(totals.income, currency);
  els.totalExpense.textContent = money(totals.expense, currency);
  els.operationalBalance.textContent = money(totals.balance, currency);
  els.netResult.textContent = money(totals.netResult, currency);
  els.vatLiquidated.textContent = money(totals.vatLiquidated, currency);
  els.vatSupported.textContent = money(totals.vatSupported, currency);
  els.ivaBalance.textContent = money(Math.abs(totals.vatDue), currency);
  els.ivaCard.classList.toggle("to-pay", totals.vatDue > 0);
  els.ivaCard.classList.toggle("to-receive", totals.vatDue < 0);
  els.ivaStatus.textContent = totals.vatDue > 0
    ? "IVA estimado a pagar"
    : totals.vatDue < 0
      ? "IVA estimado a receber"
      : "IVA equilibrado no periodo";

  const recent = docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  renderDocumentCollection(els.recentList, recent, "Sem lancamentos neste mes.");
}

function renderList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const type = els.filterType.value;
  const docs = state.documents
    .filter((doc) => type === "all" || doc.entryType === type)
    .filter((doc) => {
      if (!query) return true;
      return [doc.issuerNif, doc.issuerName, doc.docNumber, doc.category]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""));
  renderDocumentCollection(els.documentList, docs, "Nenhum lancamento encontrado.");
}

function renderDocumentCollection(container, docs, emptyMessage) {
  container.innerHTML = "";
  container.classList.toggle("empty-state", docs.length === 0);
  if (!docs.length) {
    container.textContent = emptyMessage;
    return;
  }

  docs.forEach((doc) => {
    const item = document.createElement("article");
    item.className = "list-item";
    item.innerHTML = `
      <div class="row">
        <div>
          <strong>${escapeHtml(doc.issuerName || doc.issuerNif || "Documento")}</strong>
          <p class="muted">${escapeHtml(doc.docType || "")} ${escapeHtml(doc.docNumber || "")} - ${formatDate(doc.docDate)}</p>
        </div>
        <strong>${money(doc.grossTotal, state.settings.currency)}</strong>
      </div>
      <div class="row">
        <span class="badge ${doc.entryType}">${doc.entryType === "income" ? "Faturamento" : "Despesa"}</span>
        <span class="muted">${escapeHtml(doc.category || "Sem categoria")} - IVA ${money(doc.vatTotal, state.settings.currency)}</span>
      </div>
    `;
    item.addEventListener("click", () => editDocument(doc.id));
    container.appendChild(item);
  });
}

function activeDocs() {
  return state.documents.filter((doc) => doc.paymentStatus !== "cancelled");
}

function calculateTotals(docs) {
  return docs.reduce(
    (acc, doc) => {
      const gross = Number(doc.grossTotal) || 0;
      const net = Number(doc.netTotal) || Math.max(0, gross - (Number(doc.vatTotal) || 0));
      const vat = Number(doc.vatTotal) || Math.max(0, gross - net);

      if (doc.entryType === "income") {
        acc.income += gross;
        acc.netIncome += net;
        acc.vatLiquidated += vat;
      } else {
        acc.expense += gross;
        acc.netExpense += net;
        acc.vatSupported += vat;
      }
      acc.balance = acc.income - acc.expense;
      acc.netResult = acc.netIncome - acc.netExpense;
      acc.vatDue = acc.vatLiquidated - acc.vatSupported;
      return acc;
    },
    {
      income: 0,
      expense: 0,
      balance: 0,
      netIncome: 0,
      netExpense: 0,
      netResult: 0,
      vatLiquidated: 0,
      vatSupported: 0,
      vatDue: 0,
    },
  );
}

function setEntryType(type) {
  currentEntryType = type;
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === type);
  });
}

function resetForm() {
  editingId = null;
  els.entryForm.reset();
  fields.docDate.value = new Date().toISOString().slice(0, 10);
  fields.paymentStatus.value = "paid";
  setEntryType("expense");
  els.duplicateWarning.hidden = true;
}

function saveEntry(event) {
  event.preventDefault();
  const doc = {
    id: editingId || crypto.randomUUID(),
    entryType: currentEntryType,
    rawQr: els.rawQrInput.value.trim(),
    issuerNif: onlyDigits(fields.issuerNif.value),
    issuerName: fields.issuerName.value.trim(),
    buyerNif: onlyDigits(fields.buyerNif.value),
    docType: fields.docType.value.trim().toUpperCase(),
    docNumber: fields.docNumber.value.trim(),
    docDate: fields.docDate.value,
    grossTotal: toNumber(fields.grossTotal.value),
    netTotal: toNumber(fields.netTotal.value),
    vatTotal: toNumber(fields.vatTotal.value),
    category: fields.category.value.trim(),
    paymentStatus: fields.paymentStatus.value,
    paymentMethod: fields.paymentMethod.value.trim(),
    notes: fields.notes.value.trim(),
    createdAt: editingId ? state.documents.find((item) => item.id === editingId)?.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!doc.netTotal && doc.grossTotal && doc.vatTotal) doc.netTotal = round(doc.grossTotal - doc.vatTotal);
  if (!doc.vatTotal && doc.grossTotal && doc.netTotal) doc.vatTotal = round(doc.grossTotal - doc.netTotal);
  if (doc.category && !state.categories.includes(doc.category)) state.categories.push(doc.category);

  const duplicate = findDuplicate(doc);
  if (duplicate && duplicate.id !== editingId && !confirm("Este documento parece ja existir. Quer guardar mesmo assim?")) {
    return;
  }

  state.documents = editingId
    ? state.documents.map((item) => (item.id === editingId ? doc : item))
    : [doc, ...state.documents];
  persist();
  renderCategories();
  resetForm();
  renderAll();
  navigate("dashboard");
}

function editDocument(id) {
  const doc = state.documents.find((item) => item.id === id);
  if (!doc) return;
  editingId = id;
  setEntryType(doc.entryType);
  els.rawQrInput.value = doc.rawQr || "";
  fields.issuerNif.value = doc.issuerNif || "";
  fields.issuerName.value = doc.issuerName || "";
  fields.buyerNif.value = doc.buyerNif || "";
  fields.docType.value = doc.docType || "";
  fields.docNumber.value = doc.docNumber || "";
  fields.docDate.value = doc.docDate || "";
  fields.grossTotal.value = doc.grossTotal || "";
  fields.netTotal.value = doc.netTotal || "";
  fields.vatTotal.value = doc.vatTotal || "";
  fields.category.value = doc.category || "";
  fields.paymentStatus.value = doc.paymentStatus || "paid";
  fields.paymentMethod.value = doc.paymentMethod || "";
  fields.notes.value = doc.notes || "";
  navigate("entry");
}

function checkDuplicate() {
  const partial = {
    id: editingId,
    issuerNif: onlyDigits(fields.issuerNif.value),
    docType: fields.docType.value.trim().toUpperCase(),
    docNumber: fields.docNumber.value.trim(),
    docDate: fields.docDate.value,
    grossTotal: toNumber(fields.grossTotal.value),
  };
  const duplicate = findDuplicate(partial);
  els.duplicateWarning.hidden = !duplicate || duplicate.id === editingId;
  if (duplicate && duplicate.id !== editingId) {
    els.duplicateWarning.textContent = `Possivel duplicado: ${duplicate.docType} ${duplicate.docNumber}, ${formatDate(duplicate.docDate)}.`;
  }
}

function findDuplicate(doc) {
  if (!doc.issuerNif || !doc.docType || !doc.docNumber || !doc.docDate) return null;
  return state.documents.find((item) => {
    return item.issuerNif === doc.issuerNif
      && item.docType === doc.docType
      && item.docNumber === doc.docNumber
      && item.docDate === doc.docDate
      && Math.abs((Number(item.grossTotal) || 0) - (Number(doc.grossTotal) || 0)) < 0.01;
  });
}

function applyParsedQr(raw) {
  const parsed = parsePortugueseFiscalQr(raw);
  if (!parsed.rawQr) {
    alert("Cole ou leia primeiro o conteudo do QR Code.");
    return;
  }
  els.rawQrInput.value = parsed.rawQr;
  fields.issuerNif.value = parsed.issuerNif || "";
  fields.buyerNif.value = parsed.buyerNif || "";
  fields.docType.value = parsed.docType || "";
  fields.docNumber.value = parsed.docNumber || "";
  fields.docDate.value = parsed.docDate || new Date().toISOString().slice(0, 10);
  fields.grossTotal.value = parsed.grossTotal || "";
  fields.netTotal.value = parsed.netTotal || "";
  fields.vatTotal.value = parsed.vatTotal || "";
  fields.category.value = parsed.entryType === "income" ? "Vendas" : "";
  setEntryType(parsed.entryType);
  checkDuplicate();
  navigate("entry");
}

function parsePortugueseFiscalQr(rawValue) {
  const rawQr = rawValue.trim();
  const pairs = {};
  rawQr.split("*").forEach((part) => {
    const index = part.indexOf(":");
    if (index > 0) pairs[part.slice(0, index).trim().toUpperCase()] = part.slice(index + 1).trim();
  });

  const issuerNif = onlyDigits(pairs.A || pairs.NIFEMITENTE || "");
  const buyerNif = onlyDigits(pairs.B || pairs.NIFADQUIRENTE || "");
  const grossTotal = firstNumber(pairs.O, pairs.P, pairs.Q, pairs.TOTAL, pairs.TOTALIVA);
  const knownVatFields = Object.keys(pairs).filter((key) => /^[IJKL]\d+$/.test(key) || key.startsWith("IVA"));
  const vatTotal = firstNumber(pairs.N, pairs.IVA, pairs.IVATOTAL) || sumFields(pairs, knownVatFields);
  const netTotal = grossTotal && vatTotal ? round(grossTotal - vatTotal) : firstNumber(pairs.BASE, pairs.TOTALSEMIVA);
  const ownNif = state.settings.ownNif;

  return {
    rawQr,
    issuerNif,
    buyerNif,
    docType: (pairs.D || pairs.TIPODOCUMENTO || "").toUpperCase(),
    docNumber: pairs.G || pairs.NUMDOC || pairs.NUMERODOCUMENTO || "",
    docDate: normalizeDate(pairs.F || pairs.DATA || ""),
    grossTotal,
    netTotal,
    vatTotal,
    entryType: issuerNif && ownNif && issuerNif === ownNif ? "income" : "expense",
  };
}

async function startScanner() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    els.cameraPreview.srcObject = cameraStream;
    await els.cameraPreview.play();
    els.stopScanner.hidden = false;
    els.scannerHint.querySelector("span").textContent = "A procurar QR Code...";

    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      scanTimer = window.setInterval(async () => {
        const codes = await detector.detect(els.cameraPreview).catch(() => []);
        if (codes.length) {
          stopScanner();
          applyParsedQr(codes[0].rawValue);
        }
      }, 700);
      return;
    }

    startCanvasScanner();
  } catch {
    alert("Nao foi possivel abrir a camara. Verifique permissoes ou use lancamento manual.");
  }
}

function stopScanner() {
  if (scanTimer) window.clearInterval(scanTimer);
  if (scanFrame) window.cancelAnimationFrame(scanFrame);
  scanTimer = null;
  scanFrame = null;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  els.stopScanner.hidden = true;
  els.scannerHint.querySelector("span").textContent = "Aponte a camara para a fatura ou cole o conteudo abaixo.";
}

function startCanvasScanner() {
  if (typeof jsQR !== "function") {
    alert("Leitor QR nao carregou. Atualize a pagina e tente novamente.");
    return;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const tick = () => {
    if (!cameraStream || els.cameraPreview.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
      scanFrame = window.requestAnimationFrame(tick);
      return;
    }

    canvas.width = els.cameraPreview.videoWidth;
    canvas.height = els.cameraPreview.videoHeight;
    context.drawImage(els.cameraPreview, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

    if (code?.data) {
      stopScanner();
      applyParsedQr(code.data);
      return;
    }

    scanFrame = window.requestAnimationFrame(tick);
  };

  tick();
}

function exportCsv() {
  const header = [
    "tipo",
    "data",
    "nif_emitente",
    "nome_emitente",
    "tipo_documento",
    "numero_documento",
    "total_com_iva",
    "total_sem_iva",
    "iva_total",
    "categoria",
    "estado",
    "metodo",
    "observacoes",
  ];
  const rows = state.documents.map((doc) => [
    doc.entryType === "income" ? "Faturamento" : "Despesa",
    doc.docDate,
    doc.issuerNif,
    doc.issuerName,
    doc.docType,
    doc.docNumber,
    doc.grossTotal,
    doc.netTotal,
    doc.vatTotal,
    doc.category,
    doc.paymentStatus,
    doc.paymentMethod,
    doc.notes,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderCategories() {
  els.categoryOptions.innerHTML = "";
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    els.categoryOptions.appendChild(option);
  });
}

function money(value, currency = "EUR") {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: currency || "EUR" }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Sem data";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-PT");
}

function normalizeDate(value) {
  const clean = String(value || "").trim();
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return "";
}

function toNumber(value) {
  return round(Number(String(value || "0").replace(",", ".")) || 0);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number) return number;
  }
  return 0;
}

function sumFields(pairs, keys) {
  return round(keys.reduce((sum, key) => sum + toNumber(pairs[key]), 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
