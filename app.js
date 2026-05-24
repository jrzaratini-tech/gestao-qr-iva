const STORAGE_KEY = "gestao-qr-iva-state-v1";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2IxJjHcAS-R4EwF8iZxhuLCMdu0cYLnE",
  authDomain: "gestao-qr-iva.firebaseapp.com",
  projectId: "gestao-qr-iva",
  storageBucket: "gestao-qr-iva.firebasestorage.app",
  messagingSenderId: "270531006586",
  appId: "1:270531006586:web:8d3f9106b9b236cea72bc3",
};

const defaultCategories = [
  "ÁGUA",
  "AMAZON",
  "ALIMENTAÇÃO",
  "ARRENDAMENTO",
  "COMISSÃO",
  "CONTABILIDADE",
  "CTT",
  "COMBUSTÍVEL",
  "CAFÉ",
  "DIMATUR",
  "DAGOL",
  "ENERGIA",
  "FILAMENTO 3D",
  "IMPOSTOS",
  "LEROY MERLIN",
  "LUZACRIL",
  "MANUTENÇÃO",
  "MATERIAL ESCRITORIO",
  "MAKRO",
  "PLOTTERZONE",
  "POLEGADA LED",
  "SALÁRIO",
  "SANTANDER",
  "TRANSPORTE",
  "TELEFONE/INTERNET",
  "WEDDT",
  "OUTROS",
  "Logo em Acrílico",
  "Logo Flutuante para Montra",
  "Neon LED",
  "Alto Colante",
  "Logo 3D com LED",
  "Logo 3D sem LED",
  "Brindes",
  "Painel de ACM",
  "Caixa de Luz",
];

const state = loadState();
let selectedMonth = new Date().toISOString().slice(0, 7);
let currentEntryType = "expense";
let editingId = null;
let cameraStream = null;
let scanTimer = null;
let scanFrame = null;
let deferredInstallPrompt = null;
let db = null;
let cloudUnsubscribe = null;
let cloudReady = false;
let cloudSaveTimer = null;
let applyingCloudState = false;

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
  syncStatus: document.querySelector("#syncStatus"),
  syncBanner: document.querySelector("#syncBanner"),
  barChart: document.querySelector("#barChart"),
  nextVatDeadline: document.querySelector("#nextVatDeadline"),
  vatDeadlineText: document.querySelector("#vatDeadlineText"),
  vatRegimeBadge: document.querySelector("#vatRegimeBadge"),
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
  syncKey: document.querySelector("#syncKey"),
  vatPeriodicity: document.querySelector("#vatPeriodicity"),
  activityStartDate: document.querySelector("#activityStartDate"),
  activityProfile: document.querySelector("#activityProfile"),
  currency: document.querySelector("#currency"),
};

init();

function init() {
  bindEvents();
  hydrateSettings();
  renderCategories();
  renderAll();
  initCloudSync();
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
    settings: {
      userName: "",
      ownNif: "",
      syncKey: "",
      vatPeriodicity: "quarterly",
      activityStartDate: "2026-05-06",
      activityProfile: "Design, impressao e producao",
      currency: "EUR",
    },
    documents: [],
    categories: defaultCategories,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...fallback,
      ...stored,
      settings: { ...fallback.settings, ...(stored.settings || {}) },
      categories: Array.from(new Set([...(stored.categories || []), ...defaultCategories])),
    };
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleCloudSave();
}

function hydrateSettings() {
  fields.userName.value = state.settings.userName || "";
  fields.ownNif.value = state.settings.ownNif || "";
  fields.syncKey.value = state.settings.syncKey || "";
  fields.vatPeriodicity.value = state.settings.vatPeriodicity || "quarterly";
  fields.activityStartDate.value = state.settings.activityStartDate || "2026-05-06";
  fields.activityProfile.value = state.settings.activityProfile || "Design, impressao e producao";
  fields.currency.value = state.settings.currency || "EUR";
}

function saveSettings(event) {
  event.preventDefault();
  state.settings = {
    userName: fields.userName.value.trim(),
    ownNif: onlyDigits(fields.ownNif.value),
    syncKey: normalizeSyncKey(fields.syncKey.value),
    vatPeriodicity: fields.vatPeriodicity.value || "quarterly",
    activityStartDate: fields.activityStartDate.value || "2026-05-06",
    activityProfile: fields.activityProfile.value.trim() || "Design, impressao e producao",
    currency: (fields.currency.value || "EUR").trim().toUpperCase(),
  };
  persist();
  initCloudSync(true);
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
  renderBarChart(totals);
  renderVatDeadline();

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
      <small class="edit-hint">Toque para rever, corrigir o tipo ou classificar a categoria.</small>
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

  if (!state.settings.ownNif) {
    alert("Configure primeiro o seu NIF em Config. O app so aceita documentos ligados ao NIF configurado.");
    navigate("settings");
    return;
  }

  if (!documentMatchesOwnNif(doc)) {
    alert("Este documento nao corresponde ao NIF configurado. Para despesas, o NIF adquirente deve ser o seu NIF. Para faturamento, o NIF emitente deve ser o seu NIF.");
    return;
  }

  const duplicate = findDuplicate(doc);
  if (duplicate && duplicate.id !== editingId) {
    alert("Esta nota ja esta registrada. O lancamento duplicado foi descartado para evitar erro.");
    resetForm();
    renderAll();
    navigate("list");
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

  if (state.settings.ownNif && !documentMatchesOwnNif(parsed)) {
    discardScannedDocument("Este documento nao corresponde ao NIF configurado. O scan foi descartado e nao pode ser guardado.");
    return;
  }

  const duplicate = findDuplicate({
    issuerNif: parsed.issuerNif,
    docType: parsed.docType,
    docNumber: parsed.docNumber,
    docDate: parsed.docDate,
    grossTotal: parsed.grossTotal,
  });
  if (duplicate) {
    discardScannedDocument("Esta nota ja esta registrada. O scan foi descartado para evitar duplicacao.");
    navigate("list");
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
  fields.category.value = parsed.entryType === "income" ? "Logo em Acrílico" : "";
  setEntryType(parsed.entryType);
  checkDuplicate();
  navigate("entry");
}

function discardScannedDocument(message) {
  alert(message);
  els.rawQrInput.value = "";
  resetForm();
  renderAll();
  navigate("dashboard");
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

async function initCloudSync(forceRestart = false) {
  if (cloudUnsubscribe && forceRestart) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
    cloudReady = false;
  }

  if (!state.settings.syncKey) {
    updateSyncStatus("Modo local. Configure uma chave de sincronizacao em Config.", false);
    return;
  }

  if (!window.firebase?.firestore || !window.firebase?.auth) {
    updateSyncStatus("Sincronizacao indisponivel. Verifique a ligacao a internet.", false);
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    await firebase.auth().signInAnonymously();
    const ref = cloudStateRef();
    updateSyncStatus("A sincronizar com Firebase...", false);

    if (!cloudUnsubscribe) {
      cloudUnsubscribe = ref.onSnapshot(
        async (snapshot) => {
          if (!snapshot.exists) {
            await saveCloudState();
            cloudReady = true;
            updateSyncStatus("Sincronizado em nuvem.", true);
            return;
          }

          const cloud = snapshot.data() || {};
          const cloudDocs = cloud.documents || [];
          applyingCloudState = true;
          state.documents = mergeDocuments(state.documents, cloudDocs);
          state.categories = Array.from(new Set([...(cloud.categories || []), ...state.categories]));
          state.settings = {
            ...state.settings,
            ...(cloud.settings || {}),
            syncKey: state.settings.syncKey,
            ownNif: state.settings.ownNif,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          hydrateSettings();
          renderCategories();
          renderAll();
          applyingCloudState = false;
          cloudReady = true;
          updateSyncStatus("Sincronizado em nuvem.", true);
          if (state.documents.length > cloudDocs.length) saveCloudState();
        },
        (error) => {
          updateSyncStatus(`Firebase pendente: ${error.message}`, false);
        },
      );
    }
  } catch (error) {
    updateSyncStatus(`Firebase pendente: ${error.message}`, false);
  }
}

function scheduleCloudSave() {
  if (applyingCloudState || !cloudReady || !state.settings.syncKey || !db) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(saveCloudState, 450);
}

async function saveCloudState() {
  if (!db || !state.settings.syncKey) return;
  const cloudSettings = {
    userName: state.settings.userName || "",
    vatPeriodicity: state.settings.vatPeriodicity || "quarterly",
    activityStartDate: state.settings.activityStartDate || "2026-05-06",
    activityProfile: state.settings.activityProfile || "Design, impressao e producao",
    currency: state.settings.currency || "EUR",
  };
  await cloudStateRef().set(
    {
      settings: cloudSettings,
      categories: state.categories,
      documents: state.documents,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function cloudStateRef() {
  return db.collection("workspaces").doc(state.settings.syncKey).collection("state").doc("main");
}

function mergeDocuments(localDocs, cloudDocs) {
  const map = new Map();
  [...cloudDocs, ...localDocs].forEach((doc) => {
    const current = map.get(doc.id);
    if (!current || String(doc.updatedAt || doc.createdAt || "").localeCompare(String(current.updatedAt || current.createdAt || "")) >= 0) {
      map.set(doc.id, doc);
    }
  });
  return Array.from(map.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function updateSyncStatus(message, online) {
  if (!els.syncStatus || !els.syncBanner) return;
  els.syncStatus.textContent = message;
  els.syncBanner.classList.toggle("online", online);
}

function documentMatchesOwnNif(doc) {
  const ownNif = state.settings.ownNif;
  if (!ownNif) return false;
  if (doc.entryType === "income") return doc.issuerNif === ownNif;
  return doc.buyerNif === ownNif;
}

function renderBarChart(totals) {
  if (!els.barChart) return;
  const values = [
    { label: "Entradas", value: totals.income, className: "income" },
    { label: "Saidas", value: totals.expense, className: "expense" },
    { label: "IVA", value: Math.abs(totals.vatDue), className: totals.vatDue >= 0 ? "expense" : "income" },
  ];
  const max = Math.max(...values.map((item) => item.value), 1);
  els.barChart.innerHTML = values.map((item) => {
    const height = Math.max(8, Math.round((item.value / max) * 100));
    return `
      <div class="bar-item">
        <div class="bar-track"><span class="${item.className}" style="height:${height}%"></span></div>
        <strong>${money(item.value, state.settings.currency)}</strong>
        <small>${item.label}</small>
      </div>
    `;
  }).join("");
}

function renderVatDeadline() {
  if (!els.nextVatDeadline) return;
  const deadline = getNextVatDeadline();
  const regime = state.settings.vatPeriodicity === "monthly" ? "Mensal" : "Trimestral";
  els.vatRegimeBadge.textContent = regime;
  els.nextVatDeadline.textContent = `${deadline.label}: ate ${formatDate(deadline.dueDate)}`;
  els.vatDeadlineText.textContent = `${state.settings.activityProfile || "Atividade profissional"} - periodo ${deadline.period}. Prazo pelo artigo 41 do CIVA, com regra especial de setembro para junho/2. trimestre. Confirme sempre no Portal das Financas.`;
}

function getNextVatDeadline(reference = new Date()) {
  const periodicity = state.settings.vatPeriodicity || "quarterly";
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());

  if (periodicity === "monthly") {
    let operationDate = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
    let dueDate = monthlyVatDueDate(operationDate);
    while (dueDate < today) {
      operationDate = new Date(operationDate.getFullYear(), operationDate.getMonth() + 1, 1);
      dueDate = monthlyVatDueDate(operationDate);
    }
    return {
      label: "Proxima declaracao mensal",
      dueDate: toIsoDate(dueDate),
      period: `${formatPeriodStart(operationDate)} a ${formatPeriodEnd(endOfMonth(operationDate))}`,
    };
  }

  let quarterStart = new Date(reference.getFullYear(), Math.floor(reference.getMonth() / 3) * 3 - 3, 1);
  let dueDate = quarterlyVatDueDate(quarterStart);
  while (dueDate < today) {
    quarterStart = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 1);
    dueDate = quarterlyVatDueDate(quarterStart);
  }
  const periodStart = clampActivityStart(quarterStart);
  const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
  return {
    label: "Proxima declaracao trimestral",
    dueDate: toIsoDate(dueDate),
    period: `${Math.floor(quarterStart.getMonth() / 3) + 1}. trimestre de ${quarterStart.getFullYear()} (${formatPeriodStart(periodStart)} a ${formatPeriodEnd(quarterEnd)})`,
  };
}

function monthlyVatDueDate(monthStart) {
  if (monthStart.getMonth() === 5) return new Date(monthStart.getFullYear(), 8, 20);
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 2, 20);
}

function quarterlyVatDueDate(quarterStart) {
  if (quarterStart.getMonth() === 3) return new Date(quarterStart.getFullYear(), 8, 20);
  return new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 4, 20);
}

function clampActivityStart(periodStart) {
  const activityStart = state.settings.activityStartDate ? new Date(`${state.settings.activityStartDate}T00:00:00`) : null;
  if (!activityStart || Number.isNaN(activityStart.getTime())) return periodStart;
  return activityStart > periodStart ? activityStart : periodStart;
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function formatPeriodStart(date) {
  return date.toLocaleDateString("pt-PT");
}

function formatPeriodEnd(date) {
  return date.toLocaleDateString("pt-PT");
}

function normalizeSyncKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
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
