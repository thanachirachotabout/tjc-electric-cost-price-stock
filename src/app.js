const STORAGE_KEY = "tjc-electric-cost-price-stock-v3";
const CLOUD_CONFIG_KEY = "tjc-electric-cloud-config-v1";
const CLOUD_TABLE = "app_state";
const STATE_DB_NAME = "tjc-electric-cost-price-stock-db";
const STATE_DB_STORE = "state";
const SEED_PRODUCTS_URL = "data/tjc-products.json";
const LOW_STOCK_THRESHOLD = 3;
const VAT_RATE = 0.07;
const IMAGE_DATA_MAP = window.TJC_ELECTRIC_IMAGE_DATA || {};

const DEFAULT_PLATFORMS = [
  { id: "shopee", name: "Shopee", commissionRate: 3, serviceRate: 2, transactionRate: 2 },
  { id: "lazada", name: "Lazada", commissionRate: 5, serviceRate: 2, transactionRate: 2 },
  { id: "tiktok", name: "TikTok Shop", commissionRate: 3, serviceRate: 2.5, transactionRate: 1 },
  { id: "custom", name: "กำหนดเอง", commissionRate: 0, serviceRate: 0, transactionRate: 0 },
];

const state = {
  products: [],
  sales: [],
  platforms: DEFAULT_PLATFORMS.map((p) => ({ ...p })),
  activePlatform: "shopee",
  selectedProducts: new Set(),
  selectedSales: new Set(),
  imageTargetProductId: null,
  editingStockProductId: null,
  editingProductId: null,
  editingSaleId: null,
  productImportMode: "append",
  productImportWorkbook: null,
  productImportRows: [],
  productImportHeaderRow: 0,
  productImportStartRow: 1,
  bulkProductImageMode: "keep",
};

const el = {};
const cloud = {
  client: null,
  channel: null,
  enabled: false,
  ready: false,
  isApplyingRemote: false,
  saveTimer: null,
  pendingRepairSave: false,
  config: {
    supabaseUrl: "",
    anonKey: "",
    workspaceId: "tjc-electric-main",
    enabled: false,
  },
};
let stateDbPromise = null;
let stateSaveChain = Promise.resolve();

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(error);
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(error);
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(error);
  }
}

function openStateDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  if (!stateDbPromise) {
    stateDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(STATE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STATE_DB_STORE)) {
          db.createObjectStore(STATE_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("เปิดฐานข้อมูลไม่สำเร็จ"));
      request.onblocked = () => reject(new Error("ฐานข้อมูลถูกบล็อก"));
    });
  }
  return stateDbPromise;
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STATE_DB_STORE, "readonly");
    const store = tx.objectStore(STATE_DB_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error || new Error("อ่านข้อมูลไม่สำเร็จ"));
  });
}

function idbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STATE_DB_STORE, "readwrite");
    const store = tx.objectStore(STATE_DB_STORE);
    const request = store.put(value, key);
    request.onerror = () => reject(request.error || new Error("บันทึกข้อมูลไม่สำเร็จ"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || request.error || new Error("บันทึกข้อมูลไม่สำเร็จ"));
    tx.onabort = () => reject(tx.error || request.error || new Error("บันทึกข้อมูลไม่สำเร็จ"));
  });
}

async function readPersistedStateRaw() {
  const db = await openStateDatabase().catch(() => null);
  if (db) {
    const stored = await idbGet(db, STORAGE_KEY).catch(() => "");
    if (stored) return { raw: stored, source: "indexeddb", db };
  }
  const raw = safeLocalStorageGet(STORAGE_KEY);
  return { raw, source: raw ? "localStorage" : "", db };
}

async function writePersistedStateRaw(serialized) {
  const db = await openStateDatabase().catch(() => null);
  if (db) {
    try {
      await idbSet(db, STORAGE_KEY, serialized);
      safeLocalStorageRemove(STORAGE_KEY);
      return "indexeddb";
    } catch (error) {
      console.warn(error);
    }
  }
  if (safeLocalStorageSet(STORAGE_KEY, serialized)) return "localStorage";
  throw new Error("พื้นที่จัดเก็บไม่พอ");
}

async function persistStateSnapshot(snapshot) {
  const serialized = JSON.stringify(snapshot);
  stateSaveChain = stateSaveChain.catch(() => {}).then(() => writePersistedStateRaw(serialized));
  return stateSaveChain;
}

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  loadCloudConfig();
  await loadState();
  renderAll();
  if (cloud.config.enabled) connectCloud();
});

function bindElements() {
  [
    "saveStatus", "cloudStatus", "cloudSettingsBtn", "dashPeriod", "dashDate", "dashProduct", "dashOrder", "dashPlatform",
    "kpiGrid", "trendChart", "productChart", "platformChart", "dashTable", "dashCount",
    "productSearch", "downloadProductTemplateBtn", "importProductsBtn", "exportProductsBtn", "addProductBtn", "productFile", "productImageFileInput",
    "productImportDialog", "productImportForm", "chooseProductFileBtn",
    "productImportModeStep", "productImportMapStep", "productImportSheet", "productImportHeaderRow",
    "productMapName", "productMapOption", "productMapColor", "productMapSku", "productMapImage",
    "productMapWholesale", "productMapPacking", "productMapTotal", "productMapStock", "productMapStatus", "productPreviewHead", "productPreviewBody",
    "importMappedProductsBtn",
    "productBulkBar", "productSelectedCount", "bulkProductEditBtn", "bulkProductDeleteBtn",
    "clearProductSelectionBtn", "productSelectAll", "productTable", "productCount",
    "activePlatform", "salesSearch", "importSalesBtn", "exportSalesBtn", "addSaleBtn", "salesFile",
    "platformCommission", "platformService", "platformTransaction", "platformRateTotal",
    "salesBulkBar", "salesSelectedCount", "bulkSalesEditBtn", "bulkSalesDeleteBtn",
    "clearSalesSelectionBtn", "salesSelectAll", "salesTable", "salesCount",
    "stockSearch", "stockStatusFilter", "stockKpiGrid", "stockCount", "stockTable", "exportStockBtn",
    "stockAdjustBtn", "stockDialog", "stockForm", "stockDialogTitle", "stockProductInput",
    "stockModeInput", "stockQtyInput", "stockStatusInput", "stockPreview",
    "productDialog", "productForm", "productDialogTitle", "productImagePreview", "productImageInput",
    "productDialogImageBtn", "productDialogRemoveImageBtn", "productNameInput", "productOptionInput",
    "productColorInput", "productSkuInput", "productWholesaleInput", "productPackingInput", "productTotalInput",
    "productStockInput", "productStatusInput",
    "productBulkDialog", "productBulkForm", "bulkImagePreview", "bulkImageInput", "bulkImageFileBtn",
    "bulkImageRemoveBtn", "bulkImageFileInput", "bulkWholesaleInput", "bulkPackingInput",
    "saleDialog", "saleForm", "saleDialogTitle", "salePlatformInput", "saleDateInput", "saleOrderInput",
    "saleStatusInput", "saleRefundInput", "saleProductInput", "saleOptionInput", "saleQtyInput",
    "salePriceInput", "saleCommissionInput", "saleTransactionInput", "saleServiceInput",
    "saleDiscountInput", "saleCostSearchInput", "saleCostSearchBtn", "saleCostInput", "saleCalcPreview",
    "salesBulkDialog", "salesBulkForm", "bulkSalePlatformInput", "bulkSaleCostInput",
    "bulkSaleStatusInput", "bulkSaleRefundInput", "bulkSaleForceIncludedInput", "toast",
    "cloudDialog", "cloudForm", "supabaseUrlInput", "supabaseAnonKeyInput", "workspaceIdInput",
    "cloudEnabledInput", "pullCloudBtn", "pushCloudBtn",
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  document.querySelectorAll("[data-refresh-tab]").forEach((button) => {
    button.addEventListener("click", () => refreshCurrentData(button.dataset.refreshTab));
  });

  [el.dashPeriod, el.dashDate, el.dashProduct, el.dashOrder, el.dashPlatform].forEach((input) => {
    input.addEventListener("input", renderDashboard);
  });

  el.importProductsBtn.addEventListener("click", openProductImportDialog);
  el.downloadProductTemplateBtn.addEventListener("click", downloadProductTemplate);
  el.productFile.addEventListener("change", importProductFile);
  el.productImageFileInput.addEventListener("change", saveProductImageFile);
  el.chooseProductFileBtn.addEventListener("click", () => {
    el.productFile.click();
  });
  el.importMappedProductsBtn.addEventListener("click", importMappedProducts);
  el.productImportSheet.addEventListener("change", loadProductSheetPreview);
  el.productImportHeaderRow.addEventListener("input", loadProductSheetPreview);
  document.querySelectorAll("[data-product-import-mode]").forEach((button) => {
    button.addEventListener("click", () => setProductImportMode(button.dataset.productImportMode));
  });
  el.exportProductsBtn.addEventListener("click", exportProducts);
  el.productSearch.addEventListener("input", renderProducts);
  el.addProductBtn.addEventListener("click", openProductAdd);
  el.productSelectAll.addEventListener("change", toggleAllProducts);
  el.bulkProductDeleteBtn.addEventListener("click", bulkDeleteProducts);
  el.clearProductSelectionBtn.addEventListener("click", () => {
    state.selectedProducts.clear();
    renderProducts();
  });
  el.bulkProductEditBtn.addEventListener("click", () => {
    if (!state.selectedProducts.size) return;
    state.bulkProductImageMode = "keep";
    el.bulkImageInput.value = "";
    el.bulkWholesaleInput.value = "";
    el.bulkPackingInput.value = "";
    updateBulkProductImageControls();
    el.productBulkDialog.showModal();
  });

  el.productWholesaleInput.addEventListener("input", updateProductTotalPreview);
  el.productPackingInput.addEventListener("input", updateProductTotalPreview);
  el.productImageInput.addEventListener("input", updateProductImageControls);
  el.productDialogImageBtn.addEventListener("click", openProductDialogImagePicker);
  el.productDialogRemoveImageBtn.addEventListener("click", clearProductDialogImage);
  el.productForm.addEventListener("submit", saveProductFromForm);
  el.bulkImageInput.addEventListener("input", () => {
    state.bulkProductImageMode = el.bulkImageInput.value ? "set" : "keep";
    updateBulkProductImageControls();
  });
  el.bulkImageFileBtn.addEventListener("click", openBulkProductDialogImagePicker);
  el.bulkImageFileInput.addEventListener("change", saveBulkProductImageFile);
  el.bulkImageRemoveBtn.addEventListener("click", clearBulkProductImage);
  el.productBulkForm.addEventListener("submit", saveProductBulkForm);

  el.stockSearch.addEventListener("input", renderStock);
  el.stockStatusFilter.addEventListener("change", renderStock);
  el.exportStockBtn.addEventListener("click", exportStock);
  el.stockAdjustBtn.addEventListener("click", () => openStockAdjust());
  el.stockProductInput.addEventListener("change", updateStockPreview);
  el.stockModeInput.addEventListener("change", updateStockPreview);
  el.stockQtyInput.addEventListener("input", updateStockPreview);
  el.stockStatusInput.addEventListener("input", updateStockPreview);
  el.stockForm.addEventListener("submit", saveStockForm);

  el.activePlatform.addEventListener("change", () => {
    state.activePlatform = el.activePlatform.value;
    renderPlatformSettings();
    renderSales();
    saveState();
  });
  el.importSalesBtn.addEventListener("click", () => el.salesFile.click());
  el.salesFile.addEventListener("change", importSalesFile);
  el.exportSalesBtn.addEventListener("click", exportSales);
  el.salesSearch.addEventListener("input", renderSales);
  el.addSaleBtn.addEventListener("click", openSaleAdd);
  el.salesSelectAll.addEventListener("change", toggleAllSales);
  el.bulkSalesDeleteBtn.addEventListener("click", bulkDeleteSales);
  el.clearSalesSelectionBtn.addEventListener("click", () => {
    state.selectedSales.clear();
    renderSales();
  });
  el.bulkSalesEditBtn.addEventListener("click", openBulkSaleEdit);

  [el.platformCommission, el.platformService, el.platformTransaction].forEach((input) => {
    input.addEventListener("input", savePlatformSettings);
  });

  [
    el.salePlatformInput, el.saleDateInput, el.saleOrderInput, el.saleStatusInput, el.saleRefundInput,
    el.saleProductInput, el.saleOptionInput, el.saleQtyInput, el.salePriceInput, el.saleCommissionInput,
    el.saleTransactionInput, el.saleServiceInput, el.saleDiscountInput, el.saleCostInput,
  ].forEach((input) => {
    input.addEventListener("input", updateSalePreview);
  });
  el.saleCostInput.addEventListener("change", updateSalePreview);
  el.saleCostSearchBtn.addEventListener("click", searchSaleCosts);
  el.saleCostSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchSaleCosts();
  });
  el.saleProductInput.addEventListener("change", () => {
    const match = findProductMatch({
      productName: el.saleProductInput.value,
      optionName: el.saleOptionInput.value,
      matchedCostId: el.saleCostInput.value,
    });
    if (match.status === "matched") {
      populateCostSelect(el.saleCostInput, "ยังไม่จับคู่ต้นทุน", el.saleCostSearchInput.value, match.product.id, { requireQuery: true });
      el.saleCostInput.value = match.product.id;
    }
    updateSalePreview();
  });
  el.saleForm.addEventListener("submit", saveSaleFromForm);
  el.salesBulkForm.addEventListener("submit", saveSalesBulkForm);

  el.cloudSettingsBtn.addEventListener("click", openCloudSettings);
  el.cloudForm.addEventListener("submit", saveCloudSettings);
  el.pullCloudBtn.addEventListener("click", pullCloudNow);
  el.pushCloudBtn.addEventListener("click", pushCloudNow);

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
  });

}

function setTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tab}Tab`);
  });
  if (tab === "dashboard") renderDashboard();
  if (tab === "stock") renderStock();
}

async function loadState() {
  const { raw, source, db } = await readPersistedStateRaw();
  if (!raw) {
    await loadSeedProducts();
    return;
  }
  try {
    const saved = JSON.parse(raw);
    state.products = Array.isArray(saved.products) ? saved.products.map(migrateProductRecord) : [];
    state.sales = Array.isArray(saved.sales) ? saved.sales.map(migrateSaleRecord) : [];
    state.platforms = mergePlatforms(saved.platforms);
    state.activePlatform = saved.activePlatform || "shopee";
    recalculateAllSales();
    if (source === "localStorage" && db) {
      await idbSet(db, STORAGE_KEY, raw).catch((error) => console.warn(error));
      safeLocalStorageRemove(STORAGE_KEY);
    }
  } catch (error) {
    console.warn(error);
    await loadSeedProducts();
  }
}

async function loadSeedProducts() {
  try {
    const response = await fetch(SEED_PRODUCTS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const products = await response.json();
    state.products = Array.isArray(products) ? products.map(migrateProductRecord) : [];
  } catch (error) {
    console.warn("Seed products unavailable", error);
    state.products = [];
  }
}

function loadCloudConfig() {
  const embeddedConfig = window.TJC_ELECTRIC_CLOUD_CONFIG || {};
  const raw = safeLocalStorageGet(CLOUD_CONFIG_KEY);
  try {
    const savedConfig = raw ? JSON.parse(raw) : {};
    cloud.config = { ...cloud.config, ...savedConfig, ...embeddedConfig };
    if (embeddedConfig.enabled) {
      cloud.config.enabled = true;
      safeLocalStorageSet(CLOUD_CONFIG_KEY, JSON.stringify(cloud.config));
    }
    cloud.enabled = Boolean(cloud.config.enabled);
    updateCloudStatus(cloud.enabled ? "syncing" : "offline", cloud.enabled ? "Cloud pending" : "Local only");
  } catch (error) {
    console.warn(error);
    updateCloudStatus("offline", "Cloud config error");
  }
}

function mergePlatforms(savedPlatforms) {
  const saved = Array.isArray(savedPlatforms) ? savedPlatforms : [];
  const byId = new Map(saved.map((p) => [p.id, p]));
  return DEFAULT_PLATFORMS.map((base) => ({ ...base, ...(byId.get(base.id) || {}) }));
}

function saveState() {
  const data = {
    products: state.products,
    sales: state.sales,
    platforms: state.platforms,
    activePlatform: state.activePlatform,
  };
  el.saveStatus.textContent = `บันทึก ${new Date().toLocaleTimeString("th-TH")}`;
  persistStateSnapshot(data).catch((error) => {
    console.warn(error);
    if (!safeLocalStorageSet(STORAGE_KEY, JSON.stringify(data))) {
      el.saveStatus.textContent = "บันทึกไม่สำเร็จ";
    }
  });
  queueCloudSave();
}

function getStateSnapshot() {
  return {
    products: state.products,
    sales: state.sales,
    platforms: state.platforms,
    activePlatform: state.activePlatform,
  };
}

function applyStateSnapshot(data) {
  if (!data || typeof data !== "object") return;
  cloud.isApplyingRemote = true;
  state.products = Array.isArray(data.products) ? data.products.map(migrateProductRecord) : [];
  state.sales = Array.isArray(data.sales) ? data.sales.map(migrateSaleRecord) : [];
  state.platforms = mergePlatforms(data.platforms);
  state.activePlatform = data.activePlatform || state.platforms[0]?.id || "shopee";
  state.selectedProducts.clear();
  state.selectedSales.clear();
  const salesBeforeRecalculate = JSON.stringify(state.sales);
  recalculateAllSales();
  const salesChanged = JSON.stringify(state.sales) !== salesBeforeRecalculate;
  renderAll();
  cloud.isApplyingRemote = false;
  if (salesChanged) {
    cloud.pendingRepairSave = true;
    if (cloud.ready) queueCloudSave();
  }
}

function renderAll() {
  renderPlatformOptions();
  renderDashboard();
  renderProducts();
  renderPlatformSettings();
  renderSales();
  renderStock();
  saveState();
}

function renderPlatformOptions() {
  const options = state.platforms.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  el.dashPlatform.innerHTML = `<option value="all">ทุกแพลตฟอร์ม</option>${options}`;
  el.activePlatform.innerHTML = options;
  el.salePlatformInput.innerHTML = options;
  el.bulkSalePlatformInput.innerHTML = `<option value="">ไม่เปลี่ยนแพลตฟอร์ม</option>${options}`;
  el.activePlatform.value = state.activePlatform;
}

function getPlatform(id) {
  return state.platforms.find((p) => p.id === id) || state.platforms[0];
}

function renderPlatformSettings() {
  const platform = getPlatform(state.activePlatform);
  el.platformCommission.value = platform.commissionRate ?? 0;
  el.platformService.value = platform.serviceRate ?? 0;
  el.platformTransaction.value = platform.transactionRate ?? 0;
  const total = Number(platform.commissionRate || 0) + Number(platform.serviceRate || 0) + Number(platform.transactionRate || 0);
  el.platformRateTotal.textContent = `รวม ${formatNumber(total)}%`;
}

function savePlatformSettings() {
  const platform = getPlatform(state.activePlatform);
  platform.commissionRate = toNumber(el.platformCommission.value);
  platform.serviceRate = toNumber(el.platformService.value);
  platform.transactionRate = toNumber(el.platformTransaction.value);
  el.platformRateTotal.textContent = `รวม ${formatNumber(platform.commissionRate + platform.serviceRate + platform.transactionRate)}%`;
  state.sales = state.sales.map((sale) => sale.platform === platform.id && !sale.feeFromFile ? calculateSale(sale) : sale);
  saveState();
  renderDashboard();
  renderSales();
}

function openCloudSettings() {
  el.supabaseUrlInput.value = cloud.config.supabaseUrl || "";
  el.supabaseAnonKeyInput.value = cloud.config.anonKey || "";
  el.workspaceIdInput.value = cloud.config.workspaceId || "tjc-electric-main";
  el.cloudEnabledInput.checked = Boolean(cloud.config.enabled);
  el.cloudDialog.showModal();
}

async function saveCloudSettings(event) {
  event.preventDefault();
  cloud.config = {
    supabaseUrl: cleanText(el.supabaseUrlInput.value),
    anonKey: cleanText(el.supabaseAnonKeyInput.value),
    workspaceId: cleanText(el.workspaceIdInput.value) || "tjc-electric-main",
    enabled: el.cloudEnabledInput.checked,
  };
  safeLocalStorageSet(CLOUD_CONFIG_KEY, JSON.stringify(cloud.config));
  el.cloudDialog.close();
  await disconnectCloud();
  if (cloud.config.enabled) {
    await connectCloud();
  } else {
    cloud.enabled = false;
    cloud.ready = false;
    updateCloudStatus("offline", "Local only");
  }
}

async function connectCloud() {
  if (!cloud.config.supabaseUrl || !cloud.config.anonKey || !cloud.config.workspaceId) {
    updateCloudStatus("offline", "Cloud setup needed");
    showToast("กรุณากรอก Supabase URL, Anon key และ Workspace ID", true);
    return;
  }
  if (!window.supabase?.createClient) {
    updateCloudStatus("offline", "Supabase CDN missing");
    showToast("โหลด Supabase library ไม่ได้ ตรวจ internet หรือ CDN", true);
    return;
  }

  updateCloudStatus("syncing", "Connecting");
  cloud.enabled = true;
  cloud.ready = false;
  cloud.client = window.supabase.createClient(cloud.config.supabaseUrl, cloud.config.anonKey);

  try {
    await fetchCloudSnapshot();
    subscribeCloudRealtime();
    cloud.ready = true;
    updateCloudStatus("online", `Cloud: ${cloud.config.workspaceId}`);
    if (cloud.pendingRepairSave) {
      cloud.pendingRepairSave = false;
      queueCloudSave();
    }
    showToast("เชื่อมต่อ Cloud Sync แล้ว");
  } catch (error) {
    console.error(error);
    cloud.ready = false;
    updateCloudStatus("offline", "Cloud error");
    showToast(`เชื่อมต่อ Cloud ไม่สำเร็จ: ${error.message}`, true);
  }
}

async function disconnectCloud() {
  window.clearTimeout(cloud.saveTimer);
  cloud.saveTimer = null;
  if (cloud.channel && cloud.client) {
    try {
      await cloud.client.removeChannel(cloud.channel);
    } catch (error) {
      console.warn(error);
    }
  }
  cloud.channel = null;
  cloud.client = null;
  cloud.ready = false;
}

async function fetchCloudSnapshot() {
  const { data, error } = await cloud.client
    .from(CLOUD_TABLE)
    .select("data, updated_at")
    .eq("workspace_id", cloud.config.workspaceId)
    .maybeSingle();

  if (error) throw error;

  if (data?.data) {
    applyStateSnapshot(data.data);
    return;
  }

  await upsertCloudSnapshot();
}

function subscribeCloudRealtime() {
  if (cloud.channel && cloud.client) cloud.client.removeChannel(cloud.channel);
  cloud.channel = cloud.client
    .channel(`app-state-${cloud.config.workspaceId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: CLOUD_TABLE,
        filter: `workspace_id=eq.${cloud.config.workspaceId}`,
      },
      (payload) => {
        const incoming = payload.new?.data;
        if (!incoming || cloud.isApplyingRemote) return;
        applyStateSnapshot(incoming);
        updateCloudStatus("online", `Cloud synced ${new Date().toLocaleTimeString("th-TH")}`);
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") updateCloudStatus("online", `Cloud: ${cloud.config.workspaceId}`);
      if (status === "CHANNEL_ERROR") updateCloudStatus("offline", "Realtime error");
    });
}

function queueCloudSave() {
  if (!cloud.enabled || !cloud.ready || !cloud.client || cloud.isApplyingRemote) return;
  window.clearTimeout(cloud.saveTimer);
  updateCloudStatus("syncing", "Saving cloud");
  cloud.saveTimer = window.setTimeout(() => {
    upsertCloudSnapshot().catch((error) => {
      console.error(error);
      updateCloudStatus("offline", "Cloud save error");
      showToast(`บันทึก Cloud ไม่สำเร็จ: ${error.message}`, true);
    });
  }, 550);
}

async function upsertCloudSnapshot() {
  if (!cloud.client) throw new Error("ยังไม่ได้เชื่อมต่อ Supabase");
  const { error } = await cloud.client
    .from(CLOUD_TABLE)
    .upsert({
      workspace_id: cloud.config.workspaceId,
      data: getStateSnapshot(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" });

  if (error) throw error;
  updateCloudStatus("online", `Cloud saved ${new Date().toLocaleTimeString("th-TH")}`);
}

async function pullCloudNow(options = {}) {
  const silent = Boolean(options.silent);
  if (!cloud.client) await connectCloud();
  if (!cloud.client) return false;
  try {
    await fetchCloudSnapshot();
    if (!silent) showToast("ดึงข้อมูลจาก Cloud แล้ว");
    return true;
  } catch (error) {
    if (!silent) showToast(`ดึงข้อมูลไม่สำเร็จ: ${error.message}`, true);
    return false;
  }
}

async function refreshCurrentData(tabName = "") {
  const label = tabName ? ` (${tabName})` : "";
  if (cloud.config.enabled) {
    try {
      updateCloudStatus("syncing", "Refreshing");
      const pulled = await pullCloudNow({ silent: true });
      recalculateAllSales();
      renderAll();
      showToast(pulled ? `Refresh / Sync แล้ว${label}` : `Refresh ข้อมูลในเครื่องแล้ว แต่ยังดึง Cloud ไม่สำเร็จ${label}`, !pulled);
      return;
    } catch (error) {
      showToast(`Refresh ไม่สำเร็จ: ${error.message}`, true);
      return;
    }
  }

  recalculateAllSales();
  renderAll();
  showToast(`Refresh ข้อมูลในเครื่องแล้ว${label}`);
}

async function pushCloudNow() {
  if (!cloud.client) await connectCloud();
  if (!cloud.client) return;
  try {
    await upsertCloudSnapshot();
    showToast("ส่งข้อมูลขึ้น Cloud แล้ว");
  } catch (error) {
    showToast(`ส่งข้อมูลไม่สำเร็จ: ${error.message}`, true);
  }
}

function updateCloudStatus(status, text) {
  if (!el.cloudStatus) return;
  el.cloudStatus.className = `cloud-status ${status}`;
  el.cloudStatus.textContent = text;
}

function openProductImportDialog() {
  setProductImportMode(state.productImportMode || "append");
  state.productImportWorkbook = null;
  state.productImportRows = [];
  state.productImportHeaderRow = 0;
  state.productImportStartRow = 1;
  el.productImportModeStep.style.display = "";
  el.productImportMapStep.style.display = "none";
  el.chooseProductFileBtn.style.display = "";
  el.importMappedProductsBtn.style.display = "none";
  el.productImportSheet.innerHTML = "";
  el.productPreviewHead.innerHTML = "";
  el.productPreviewBody.innerHTML = "";
  el.productImportDialog.showModal();
}

function setProductImportMode(mode) {
  state.productImportMode = mode;
  document.querySelectorAll("[data-product-import-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.productImportMode === mode);
  });
}

async function importProductFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!ensureXlsxReady()) return;
  try {
    const workbook = await readWorkbook(file);
    state.productImportWorkbook = workbook;
    setupProductImportMapping(workbook);
  } catch (error) {
    console.error(error);
    showToast(`อ่านไฟล์ไม่ได้: ${error.message}`, true);
  }
}

function setupProductImportMapping(workbook) {
  const options = workbook.SheetNames.map((sheetName) => `<option value="${escapeHtml(sheetName)}">${escapeHtml(sheetName)}</option>`).join("");
  el.productImportSheet.innerHTML = `<option value="">-- เลือก Sheet --</option>${options}`;
  const preferred = workbook.SheetNames.find((name) => normalizeName(name).includes("รายได้") || normalizeName(name).includes("income")) ||
    workbook.SheetNames.find((name) => name.includes("โหลดไฟล์ต้นทุน")) ||
    workbook.SheetNames.find((name) => name.includes("สินค้า")) ||
    workbook.SheetNames[0];
  el.productImportSheet.value = preferred || "";
  el.productImportHeaderRow.value = "1";
  el.productImportModeStep.style.display = "none";
  el.productImportMapStep.style.display = "";
  el.chooseProductFileBtn.style.display = "none";
  el.importMappedProductsBtn.style.display = "";
  loadProductSheetPreview();
}

function loadProductSheetPreview() {
  const workbook = state.productImportWorkbook;
  const sheetName = el.productImportSheet.value;
  if (!workbook || !sheetName) return;
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = Math.max(0, Number(el.productImportHeaderRow.value || 1) - 1);
  const { headers, start } = buildProductImportHeaders(rows, headerRow);
  state.productImportRows = rows;
  state.productImportHeaderRow = headerRow;
  state.productImportStartRow = start;
  populateProductColumnMaps(headers);
  renderProductImportPreview(headers, rows.slice(start, start + 5));
}

function buildProductImportHeaders(rows, headerRow) {
  const topRow = rows[headerRow] || [];
  const subRow = rows[headerRow + 1] || [];
  const maxLength = Math.max(topRow.length, subRow.length);
  const topHeaders = Array.from({ length: maxLength }, (_, index) => cleanText(topRow[index]));
  const subHeaders = Array.from({ length: maxLength }, (_, index) => cleanText(subRow[index]));
  const hasOptionGroup = topHeaders.some((header) => normalizeName(header).includes("ชื่อตัวเลือก"));
  const hasSubOptionHeaders = subHeaders.some((header) => ["ตัวเลือก", "สี"].includes(normalizeName(header)));

  if (!hasOptionGroup || !hasSubOptionHeaders) {
    return { headers: topHeaders, start: headerRow + 1 };
  }

  let currentGroup = "";
  const headers = topHeaders.map((topHeader, index) => {
    if (topHeader) currentGroup = topHeader;
    const subHeader = subHeaders[index];
    if (subHeader) return `${currentGroup} ${subHeader}`.trim();
    return topHeader || currentGroup;
  });
  return { headers, start: headerRow + 2 };
}

function populateProductColumnMaps(headers) {
  const options = `<option value="">- ไม่ใช้ -</option>${headers.map((header, index) => `<option value="${index}">${escapeHtml(header || `คอลัมน์ ${index + 1}`)}</option>`).join("")}`;
  const mapIds = [
    "productMapName", "productMapOption", "productMapColor", "productMapSku", "productMapImage",
    "productMapWholesale", "productMapPacking", "productMapTotal", "productMapStock", "productMapStatus",
  ];
  mapIds.forEach((id) => {
    el[id].innerHTML = options;
  });
  setSelectValue(el.productMapName, findHeader(headers, ["ชื่อสินค้า"], 0));
  setSelectValue(el.productMapColor, findProductSubHeader(headers, "สี", 1));
  setSelectValue(el.productMapOption, findProductSubHeader(headers, "ตัวเลือก", 2));
  setSelectValue(el.productMapSku, findHeader(headers, ["sku"], 3));
  setSelectValue(el.productMapImage, findHeader(headers, ["รูปภาพ", "image"], -1));
  setSelectValue(el.productMapWholesale, findHeader(headers, ["ราคาส่ง"], 4));
  setSelectValue(el.productMapPacking, findHeader(headers, ["ค่าแพค"], 5));
  setSelectValue(el.productMapTotal, findHeader(headers, ["รวมต้นทุน"], 6));
  setSelectValue(el.productMapStock, findHeader(headers, ["สต็อก", "stock"], -1));
  setSelectValue(el.productMapStatus, findHeader(headers, ["สถานะ", "status"], -1));
}

function renderProductImportPreview(headers, rows) {
  el.productPreviewHead.innerHTML = `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
  el.productPreviewBody.innerHTML = rows.map((row) => `
    <tr>${headers.map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}</tr>
  `).join("");
}

function importMappedProducts() {
  const products = parseProductsFromMapping();
  if (!products.length) {
    showToast("ไม่พบข้อมูลสินค้าใน Sheet/Mapping นี้", true);
    return;
  }
  applyProductImport(products, state.productImportMode);
  recalculateAllSales();
  state.selectedProducts.clear();
  el.productImportDialog.close();
  renderAll();
  showToast(`${productImportModeLabel(state.productImportMode)} ${products.length} รายการ`);
}

function parseProductsFromMapping() {
  const rows = state.productImportRows;
  const start = state.productImportStartRow || state.productImportHeaderRow + 1;
  const columns = {
    name: getSelectIndex(el.productMapName),
    option: getSelectIndex(el.productMapOption),
    color: getSelectIndex(el.productMapColor),
    sku: getSelectIndex(el.productMapSku),
    image: getSelectIndex(el.productMapImage),
    wholesale: getSelectIndex(el.productMapWholesale),
    packing: getSelectIndex(el.productMapPacking),
    total: getSelectIndex(el.productMapTotal),
    stock: getSelectIndex(el.productMapStock),
    status: getSelectIndex(el.productMapStatus),
  };
  if (columns.name < 0 || columns.sku < 0 || columns.wholesale < 0 || columns.packing < 0) return [];
  return parseProductRows(rows, start, columns);
}

async function importSalesFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!ensureXlsxReady()) return;
  try {
    const workbook = await readWorkbook(file);
    const sales = parseSalesWorkbook(workbook, state.activePlatform);
    if (!sales.length) {
      showToast("ไม่พบรายการขายในไฟล์", true);
      return;
    }
    state.sales.push(...sales);
    state.selectedSales.clear();
    renderAll();
    const included = sales.filter((sale) => sale.includedInProfit).length;
    showToast(`นำเข้ารายการขาย ${sales.length} รายการ นับกำไร ${included} รายการ`);
  } catch (error) {
    console.error(error);
    showToast(`อ่านไฟล์ไม่ได้: ${error.message}`, true);
  }
}

function readWorkbook(file) {
  return file.arrayBuffer().then((buffer) => XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    raw: false,
  }));
}

function parseProductsWorkbook(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name.includes("สินค้า") && !name.includes("สำเนา")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).includes("ชื่อสินค้า")) && row.some((cell) => String(cell).toLowerCase().includes("sku")));
  const headerInfo = headerIndex >= 0 ? buildProductImportHeaders(rows, headerIndex) : { headers: [], start: 1 };
  const start = headerInfo.start;
  const headers = headerInfo.headers;
  const columns = {
    category: -1,
    name: findHeader(headers, ["ชื่อสินค้า"], 0),
    option: findProductSubHeader(headers, "ตัวเลือก", 2),
    color: findProductSubHeader(headers, "สี", 1),
    sku: findHeader(headers, ["sku"], 3),
    image: findHeader(headers, ["รูปภาพ", "image"], -1),
    wholesale: findHeader(headers, ["ราคาส่ง"], 4),
    packing: findHeader(headers, ["ค่าแพค"], 5),
    total: findHeader(headers, ["รวมต้นทุน"], 6),
    stock: findHeader(headers, ["สต็อก", "stock"], -1),
    status: findHeader(headers, ["สถานะ", "status"], -1),
  };
  return parseProductRows(rows, start, columns);
}

function parseProductRows(rows, start, columns) {
  const parsed = [];
  let lastName = "";
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    const rawName = cleanText(row[columns.name]);
    if (rawName) lastName = rawName;
    if (!lastName) continue;
    const wholesalePrice = toNumber(row[columns.wholesale]);
    const packingCost = toNumber(row[columns.packing]);
    const sku = columns.sku >= 0 ? cleanText(row[columns.sku]) : "";
    const imageUrl = columns.image >= 0 ? cleanText(row[columns.image]) : "";
    const optionName = columns.option >= 0 ? cleanText(row[columns.option]) : "";
    const color = columns.color >= 0 ? cleanText(row[columns.color]) : "";
    const stock = columns.stock >= 0 ? Math.max(0, toNumber(row[columns.stock])) : 0;
    const status = columns.status >= 0 ? cleanText(row[columns.status]) : "";
    if (!sku && !optionName && !color && !wholesalePrice && !packingCost) continue;
    parsed.push({
      id: createId("p"),
      productName: lastName,
      optionName,
      color,
      sku,
      imageUrl,
      wholesalePrice,
      packingCost,
      totalCost: calculateProductTotalCost(wholesalePrice, packingCost),
      stock,
      status: status || stockStatusText(stock),
      sourceRow: i + 1,
    });
  }
  return parsed;
}

function parseSalesWorkbook(workbook, platformId) {
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("orders")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).includes("หมายเลขคำสั่งซื้อ")) && row.some((cell) => String(cell).includes("ชื่อสินค้า")));
  const start = headerIndex >= 0 ? headerIndex + 1 : 1;
  const headers = headerIndex >= 0 ? rows[headerIndex].map((cell) => String(cell || "")) : rows[0].map((cell) => String(cell || ""));
  const col = {
    orderNo: findHeader(headers, ["หมายเลขคำสั่งซื้อ", "order id"], 0),
    orderStatus: findHeader(headers, ["สถานะการสั่งซื้อ", "order status"], 1),
    refundStatus: findHeader(headers, ["สถานะการคืนเงินหรือคืนสินค้า", "refund"], 2),
    orderDate: findHeader(headers, ["วันที่ทำการสั่งซื้อ", "order date"], 4),
    productName: findHeader(headers, ["ชื่อสินค้า", "product name", "item name"], 13),
    sku: findHeader(headers, ["เลขอ้างอิง sku", "sku reference", "sku"], -1),
    optionName: findHeader(headers, ["ชื่อตัวเลือก", "variation", "option"], 15),
    salePrice: findHeader(headers, ["ราคาขาย"], 17),
    qty: findHeader(headers, ["จำนวน"], 18),
    sellerCoupon: findHeader(headers, ["โค้ดส่วนลดชำระโดยผู้ขาย"], 22),
    sellerBundle: findHeader(headers, ["ส่วนลด bundle deal ชำระโดยผู้ขาย"], 27),
    commissionFee: findHeader(headers, ["ค่าคอมมิชชั่น", "commission"], 33),
    transactionFee: findHeader(headers, ["transaction fee", "ค่าธุรกรรม"], 34),
    serviceFee: findHeader(headers, ["ค่าบริการ", "service fee"], 38),
  };
  const parsed = [];
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    const productName = cleanText(row[col.productName]);
    if (!productName) continue;
    const orderStatus = cleanText(row[col.orderStatus]);
    const refundStatus = cleanText(row[col.refundStatus]);
    const qty = Math.max(1, Math.round(toNumber(row[col.qty]) || 1));
    const sku = col.sku >= 0 ? cleanText(row[col.sku]) : "";
    const optionName = cleanText(row[col.optionName]);
    const match = findProductMatch({ productName, optionName, sku });
    const sale = {
      id: createId("s"),
      platform: platformId,
      orderNo: cleanText(row[col.orderNo]),
      orderStatus,
      refundStatus,
      orderDate: parseDateValue(row[col.orderDate]),
      productName,
      optionName,
      sku,
      qty,
      salePrice: toNumber(row[col.salePrice]),
      sellerDiscount: absNumber(row[col.sellerCoupon]) + absNumber(row[col.sellerBundle]),
      commissionFee: absNumber(row[col.commissionFee]),
      transactionFee: absNumber(row[col.transactionFee]),
      serviceFee: absNumber(row[col.serviceFee]),
      feeFromFile: true,
      discountIncludedInSalePrice: true,
      matchedCostId: match.status === "matched" ? match.product.id : "",
      matchStatus: match.status,
      manualCostMatch: false,
      forceIncluded: false,
      sourceRow: i + 1,
    };
    parsed.push(calculateSale(sale));
  }
  return normalizeShopeeOrderLevelAmounts(parsed);
}

function normalizeShopeeOrderLevelAmounts(sales) {
  const groups = new Map();
  sales.forEach((sale) => {
    if (!sale.orderNo) return;
    const key = `${sale.platform}::${sale.orderNo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sale);
  });

  groups.forEach((items) => {
    if (items.length < 2) return;
    ["commissionFee", "transactionFee", "serviceFee", "sellerDiscount"].forEach((field) => {
      if (!hasSamePositiveAmount(items, field)) return;
      distributeOrderAmount(items, field, items[0][field]);
    });
    items.forEach((item) => {
      const recalculated = calculateSale(item);
      Object.assign(item, recalculated);
    });
  });

  return sales;
}

function hasSamePositiveAmount(items, field) {
  const first = round2(items[0][field]);
  if (first <= 0) return false;
  return items.every((item) => round2(item[field]) === first);
}

function distributeOrderAmount(items, field, totalAmount) {
  const totalGross = items.reduce((sum, item) => sum + Number(item.grossSales || 0), 0);
  let allocated = 0;
  items.forEach((item, index) => {
    const amount = index === items.length - 1
      ? round2(totalAmount - allocated)
      : round2(totalAmount * (totalGross ? item.grossSales / totalGross : 1 / items.length));
    item[field] = amount;
    allocated += amount;
  });
}

function applyProductImport(products, mode = "append") {
  if (mode === "replace") {
    state.products = products;
    return;
  }
  if (mode === "append") {
    state.products.push(...products);
    return;
  }
  products.forEach((product) => {
    const existingIndex = product.sku
      ? state.products.findIndex((item) => item.sku && item.sku === product.sku)
      : -1;
    if (existingIndex >= 0) {
      state.products[existingIndex] = { ...state.products[existingIndex], ...product, id: state.products[existingIndex].id };
    } else {
      state.products.push(product);
    }
  });
}

function productImportModeLabel(mode) {
  if (mode === "replace") return "แทนที่ข้อมูลต้นทุน";
  if (mode === "merge") return "รวมข้อมูลต้นทุน";
  return "เพิ่มข้อมูลต้นทุน";
}

function downloadProductTemplate() {
  if (!ensureXlsxReady()) return;
  const rows = [
    ["SKU", "รูปภาพสินค้า", "ชื่อสินค้า", "ตัวเลือก", "สี", "ราคาส่ง", "ค่าแพค", "รวมต้นทุน (รวม VAT 7%)", "สต็อก", "สถานะ"],
    ["SKU-SAMPLE-001", "", "ชื่อสินค้าตัวอย่าง", "ตัวเลือก A", "ขาว", 160, 56, { f: "F2*1.07+G2" }, 12, "มีสินค้าพร้อมจำหน่าย"],
    ["SKU-SAMPLE-002", "", "ชื่อสินค้าตัวอย่าง", "ตัวเลือก B", "ดำ", 180, 56, { f: "F3*1.07+G3" }, 0, "หมด"],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  applyProductTemplateLayout(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, "โหลดไฟล์ต้นทุนสินค้า-ราคา");
  XLSX.writeFile(workbook, "template-ต้นทุนสินค้า-ราคา.xlsx");
  showToast("ดาวน์โหลด Template แล้ว");
}

function applyProductTemplateLayout(sheet) {
  sheet["!cols"] = [
    { wch: 18 },
    { wch: 26 },
    { wch: 48 },
    { wch: 22 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 24 },
  ];
  sheet["!rows"] = [{ hpt: 28 }];
  sheet["!merges"] = [];

  const baseHeaderStyle = {
    alignment: { horizontal: "center", vertical: "center" },
    font: { bold: true },
    border: {
      top: { style: "thin", color: { rgb: "000000" } },
      bottom: { style: "thin", color: { rgb: "000000" } },
      left: { style: "thin", color: { rgb: "000000" } },
      right: { style: "thin", color: { rgb: "000000" } },
    },
  };
  ["A1", "B1", "C1", "D1", "E1"].forEach((cell) => {
    if (sheet[cell]) sheet[cell].s = baseHeaderStyle;
  });
  ["F1", "G1", "H1", "I1", "J1"].forEach((cell) => {
    if (sheet[cell]) {
      sheet[cell].s = {
        ...baseHeaderStyle,
        fill: { patternType: "solid", fgColor: { rgb: cell.startsWith("G") ? "76D989" : "DFF3D7" } },
      };
    }
  });
}

function migrateProductRecord(product) {
  const stock = Math.max(0, toNumber(product?.stock));
  const wholesalePrice = toNumber(product?.wholesalePrice);
  const packingCost = toNumber(product?.packingCost);
  return {
    id: product?.id || createId("p"),
    productName: cleanText(product?.productName),
    optionName: cleanText(product?.optionName),
    color: cleanText(product?.color),
    sku: cleanText(product?.sku),
    imageUrl: cleanText(product?.imageUrl),
    wholesalePrice,
    packingCost,
    totalCost: calculateProductTotalCost(wholesalePrice, packingCost),
    stock,
    status: cleanText(product?.status) || stockStatusText(stock),
    sourceRow: product?.sourceRow || "",
  };
}

function resolveProductImageUrl(imageUrl) {
  const cleanUrl = cleanText(imageUrl);
  if (!cleanUrl) return "";
  return IMAGE_DATA_MAP[cleanUrl] || cleanUrl;
}

function migrateSaleRecord(sale) {
  if (!sale || typeof sale !== "object") return sale;
  if (sale.discountIncludedInSalePrice === undefined && sale.platform === "shopee" && sale.feeFromFile) {
    return { ...sale, discountIncludedInSalePrice: true };
  }
  return sale;
}

function recalculateAllSales() {
  state.sales = state.sales.map((sale) => {
    const match = resolveSaleCostMatch(sale);
    const next = {
      ...sale,
      matchedCostId: match.product ? match.product.id : "",
      matchStatus: match.product ? "matched" : match.status,
    };
    return calculateSale(next);
  });
}

function resolveSaleCostMatch(sale) {
  const currentProduct = sale.matchedCostId ? getProduct(sale.matchedCostId) : null;
  if (currentProduct && sale.manualCostMatch) {
    return { status: "matched", product: currentProduct, method: "manual" };
  }

  const autoMatch = findProductMatch(sale);
  if (!currentProduct) return autoMatch;
  if (autoMatch.status !== "matched" || !autoMatch.product) {
    return { status: "matched", product: currentProduct, method: "existing" };
  }
  if (autoMatch.product.id === currentProduct.id) return autoMatch;

  const currentScore = scoreProductMatch(currentProduct, sale);
  const autoScore = Number(autoMatch.score || scoreProductMatch(autoMatch.product, sale));
  if (autoScore >= 115 && autoScore - currentScore >= 20) {
    return autoMatch;
  }
  return { status: "matched", product: currentProduct, method: "existing", score: currentScore };
}

function calculateSale(sale) {
  const platform = getPlatform(sale.platform);
  const qty = Math.max(1, Number(sale.qty || 1));
  const grossSales = round2(Number(sale.salePrice || 0) * qty);
  let commissionFee = Number(sale.commissionFee || 0);
  let transactionFee = Number(sale.transactionFee || 0);
  let serviceFee = Number(sale.serviceFee || 0);
  if (!sale.feeFromFile) {
    commissionFee = grossSales * Number(platform.commissionRate || 0) / 100;
    serviceFee = grossSales * Number(platform.serviceRate || 0) / 100;
    transactionFee = grossSales * Number(platform.transactionRate || 0) / 100;
  }
  const product = getProduct(sale.matchedCostId);
  const unitCost = product ? Number(product.totalCost || 0) : 0;
  const totalCost = round2(unitCost * qty);
  const totalFee = round2(commissionFee + transactionFee + serviceFee);
  const sellerDiscount = round2(Number(sale.sellerDiscount || 0));
  const sellerDiscountDeducted = sale.discountIncludedInSalePrice ? 0 : sellerDiscount;
  const statusAllowsProfit = cleanText(sale.orderStatus) === "สำเร็จแล้ว" && !cleanText(sale.refundStatus);
  const includedInProfit = Boolean(sale.forceIncluded) || (statusAllowsProfit && Boolean(product));
  const profit = includedInProfit ? round2(grossSales - totalFee - sellerDiscountDeducted - totalCost) : 0;
  const margin = includedInProfit && grossSales ? round2((profit / grossSales) * 100) : 0;
  return {
    ...sale,
    qty,
    grossSales,
    commissionFee: round2(commissionFee),
    transactionFee: round2(transactionFee),
    serviceFee: round2(serviceFee),
    totalFee,
    sellerDiscount,
    sellerDiscountDeducted,
    totalCost,
    profit,
    margin,
    includedInProfit,
  };
}

function findProductMatch(input) {
  const sale = typeof input === "string" ? { productName: input } : (input || {});
  const sku = normalizeSku(sale.sku);
  if (sku) {
    const skuMatches = state.products.filter((product) => normalizeSku(product.sku) === sku);
    if (skuMatches.length === 1) return { status: "matched", product: skuMatches[0], method: "sku" };
    if (skuMatches.length > 1) return { status: "ambiguous", products: skuMatches, method: "sku" };
  }

  const saleName = normalizeName(sale.productName);
  if (!saleName) return { status: "missing" };

  const scored = state.products
    .map((product) => ({ product, score: scoreProductMatch(product, sale) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: "missing" };
  const best = scored[0];
  const second = scored[1];
  if (best.score >= 115 && (!second || best.score - second.score >= 12)) {
    return { status: "matched", product: best.product, method: "name-color-option", score: best.score };
  }
  if (best.score >= 90 && scored.filter((item) => item.score >= best.score - 8).length === 1) {
    return { status: "matched", product: best.product, method: "best-effort", score: best.score };
  }

  const products = scored.filter((item) => item.score >= Math.max(70, best.score - 20)).map((item) => item.product);
  return products.length ? { status: "ambiguous", products } : { status: "missing" };
}

function renderDashboard() {
  const rows = getDashboardRows();
  const totals = rows.reduce((acc, sale) => {
    acc.orders.add(sale.orderNo || sale.id);
    acc.grossSales += sale.grossSales;
    acc.totalCost += sale.totalCost;
    acc.totalFee += sale.totalFee;
    acc.sellerDiscount += sale.sellerDiscount;
    acc.profit += sale.profit;
    return acc;
  }, { orders: new Set(), grossSales: 0, totalCost: 0, totalFee: 0, sellerDiscount: 0, profit: 0 });
  const margin = totals.grossSales ? (totals.profit / totals.grossSales) * 100 : 0;
  const kpis = [
    ["ยอดขายรวม", money(totals.grossSales)],
    ["ต้นทุนรวม", money(totals.totalCost)],
    ["ค่าธรรมเนียมรวม", money(totals.totalFee)],
    ["ส่วนลดผู้ขายรวม", money(totals.sellerDiscount)],
    ["กำไรสุทธิ", money(totals.profit), totals.profit < 0],
    ["Margin", `${formatNumber(margin)}%`, margin < 0],
    ["จำนวนออเดอร์", totals.orders.size.toLocaleString("th-TH")],
  ];
  el.kpiGrid.innerHTML = kpis.map(([label, value, loss]) => `
    <div class="kpi">
      <div class="label">${label}</div>
      <div class="value${loss ? " loss" : ""}">${value}</div>
    </div>
  `).join("");

  drawTrendChart(el.trendChart, groupTrend(rows));
  drawHorizontalChart(el.productChart, groupBy(rows, "productName", "profit", 8), "กำไร", "#216e3a");
  drawHorizontalChart(el.platformChart, groupBy(rows, "platform", "profit", 4, platformName), "กำไร", "#1e5f98");

  el.dashCount.textContent = `${rows.length.toLocaleString("th-TH")} รายการที่นับกำไร`;
  el.dashTable.innerHTML = rows.length ? rows.slice(0, 200).map((sale) => `
    <tr>
      <td>${escapeHtml(sale.orderDate || "-")}</td>
      <td>${escapeHtml(platformName(sale.platform))}</td>
      <td><span class="sku">${escapeHtml(sale.orderNo || "-")}</span></td>
      <td><div class="row-title" title="${escapeHtml(sale.productName)}">${escapeHtml(sale.productName)}</div><div class="subline">${escapeHtml(sale.optionName || "")}</div></td>
      <td class="num">${money(sale.grossSales)}</td>
      <td class="num">${money(sale.totalCost)}</td>
      <td class="num">${money(sale.totalFee)}</td>
      <td class="num">${money(sale.sellerDiscount)}</td>
      <td class="num ${sale.profit >= 0 ? "profit" : "loss"}">${money(sale.profit)}</td>
    </tr>
  `).join("") : `<tr><td colspan="9"><div class="empty">ยังไม่มีรายการขายที่นับกำไรตามตัวกรองนี้</div></td></tr>`;
}

function getDashboardRows() {
  const period = el.dashPeriod.value;
  const date = el.dashDate.value;
  const product = normalizeName(el.dashProduct.value);
  const order = normalizeName(el.dashOrder.value);
  const platform = el.dashPlatform.value;
  return state.sales.filter((sale) => {
    if (!sale.includedInProfit) return false;
    if (platform && platform !== "all" && sale.platform !== platform) return false;
    if (product && !normalizeName(sale.productName).includes(product)) return false;
    if (order && !normalizeName(sale.orderNo).includes(order)) return false;
    if (date && sale.orderDate) {
      if (period === "day" && sale.orderDate !== date) return false;
      if (period === "month" && sale.orderDate.slice(0, 7) !== date.slice(0, 7)) return false;
      if (period === "year" && sale.orderDate.slice(0, 4) !== date.slice(0, 4)) return false;
    }
    return true;
  }).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)));
}

function renderProducts() {
  const query = normalizeName(el.productSearch.value);
  const rows = state.products.filter((product) => {
    if (!query) return true;
    return [product.productName, product.optionName, product.color, product.sku].some((value) => normalizeName(value).includes(query));
  });
  el.productCount.textContent = `${rows.length.toLocaleString("th-TH")} จาก ${state.products.length.toLocaleString("th-TH")} รายการ`;
  el.productSelectedCount.textContent = state.selectedProducts.size.toLocaleString("th-TH");
  el.productBulkBar.classList.toggle("active", state.selectedProducts.size > 0);
  const visibleIds = rows.map((row) => row.id);
  const checked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedProducts.has(id));
  el.productSelectAll.checked = checked;
  el.productSelectAll.indeterminate = !checked && visibleIds.some((id) => state.selectedProducts.has(id));
  el.productTable.innerHTML = rows.length ? rows.map((product) => `
    <tr class="${state.selectedProducts.has(product.id) ? "row-selected" : ""}">
      <td class="check-col"><input type="checkbox" data-product-select="${escapeHtml(product.id)}" ${state.selectedProducts.has(product.id) ? "checked" : ""}></td>
      <td>${productThumb(product)}</td>
      <td><div class="row-title" title="${escapeHtml(product.productName)}">${escapeHtml(product.productName)}</div></td>
      <td>${escapeHtml(product.optionName || "-")}</td>
      <td>${escapeHtml(product.color || "-")}</td>
      <td><span class="sku">${escapeHtml(product.sku || "-")}</span></td>
      <td class="num">${money(product.wholesalePrice)}</td>
      <td class="num">${money(product.packingCost)}</td>
      <td class="num profit">${money(product.totalCost)}</td>
      <td class="num ${stockClass(product.stock)}">${formatNumber(product.stock)}</td>
      <td>${stockStatusPill(product)}</td>
      <td><div class="action-buttons">
        <button class="btn secondary mini" type="button" data-product-edit="${escapeHtml(product.id)}">แก้ไข</button>
        <button class="btn light mini" type="button" data-stock-edit="${escapeHtml(product.id)}">สต็อก</button>
        <button class="btn danger mini" type="button" data-product-delete="${escapeHtml(product.id)}">ลบ</button>
      </div></td>
    </tr>
  `).join("") : `<tr><td colspan="12"><div class="empty">ยังไม่มีสินค้า นำเข้าไฟล์ต้นทุนหรือเพิ่มรายการใหม่</div></td></tr>`;

  el.productTable.querySelectorAll("[data-product-select]").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? state.selectedProducts.add(input.dataset.productSelect) : state.selectedProducts.delete(input.dataset.productSelect);
      renderProducts();
    });
  });
  el.productTable.querySelectorAll("[data-product-edit]").forEach((button) => button.addEventListener("click", () => openProductEdit(button.dataset.productEdit)));
  el.productTable.querySelectorAll("[data-stock-edit]").forEach((button) => button.addEventListener("click", () => openStockAdjust(button.dataset.stockEdit)));
  el.productTable.querySelectorAll("[data-product-delete]").forEach((button) => button.addEventListener("click", () => deleteProduct(button.dataset.productDelete)));
}

function toggleAllProducts() {
  const query = normalizeName(el.productSearch.value);
  state.products.forEach((product) => {
    const visible = !query || [product.productName, product.optionName, product.color, product.sku].some((value) => normalizeName(value).includes(query));
    if (visible) {
      el.productSelectAll.checked ? state.selectedProducts.add(product.id) : state.selectedProducts.delete(product.id);
    }
  });
  renderProducts();
}

function openProductAdd() {
  state.editingProductId = null;
  el.productDialogTitle.textContent = "เพิ่มสินค้า";
  el.productForm.reset();
  el.productStockInput.value = 0;
  el.productStatusInput.value = stockStatusText(0);
  updateProductTotalPreview();
  updateProductImageControls();
  el.productDialog.showModal();
  el.productNameInput.focus();
}

function openProductEdit(id) {
  const product = getProduct(id);
  if (!product) return;
  state.editingProductId = id;
  el.productDialogTitle.textContent = "แก้ไขสินค้า";
  el.productImageInput.value = product.imageUrl || "";
  el.productNameInput.value = product.productName || "";
  el.productOptionInput.value = product.optionName || "";
  el.productColorInput.value = product.color || "";
  el.productSkuInput.value = product.sku || "";
  el.productWholesaleInput.value = product.wholesalePrice || 0;
  el.productPackingInput.value = product.packingCost || 0;
  el.productStockInput.value = product.stock || 0;
  el.productStatusInput.value = product.status || stockStatusText(product.stock);
  updateProductTotalPreview();
  updateProductImageControls();
  el.productDialog.showModal();
}

function updateProductTotalPreview() {
  el.productTotalInput.value = calculateProductTotalCost(toNumber(el.productWholesaleInput.value), toNumber(el.productPackingInput.value));
}

function saveProductFromForm(event) {
  event.preventDefault();
  const wholesalePrice = toNumber(el.productWholesaleInput.value);
  const packingCost = toNumber(el.productPackingInput.value);
  const product = {
    id: state.editingProductId || createId("p"),
    imageUrl: cleanText(el.productImageInput.value),
    productName: cleanText(el.productNameInput.value),
    optionName: cleanText(el.productOptionInput.value),
    color: cleanText(el.productColorInput.value),
    sku: cleanText(el.productSkuInput.value),
    wholesalePrice,
    packingCost,
    totalCost: calculateProductTotalCost(wholesalePrice, packingCost),
    stock: Math.max(0, toNumber(el.productStockInput.value)),
    status: cleanText(el.productStatusInput.value) || stockStatusText(el.productStockInput.value),
  };
  if (state.editingProductId) {
    const index = state.products.findIndex((item) => item.id === state.editingProductId);
    if (index >= 0) state.products[index] = product;
  } else {
    state.products.push(product);
  }
  el.productDialog.close();
  recalculateAllSales();
  renderAll();
  showToast("บันทึกสินค้าแล้ว");
}

function openProductDialogImagePicker() {
  state.imageTargetProductId = "__product_dialog__";
  el.productImageFileInput.value = "";
  el.productImageFileInput.click();
}

async function saveProductImageFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  const productId = state.imageTargetProductId;
  state.imageTargetProductId = null;
  if (!file || !productId) return;
  if (!file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพ", true);
    return;
  }
  try {
    const imageUrl = await imageFileToDataUrl(file);
    if (productId === "__product_dialog__") {
      el.productImageInput.value = imageUrl;
      updateProductImageControls();
      showToast("เพิ่มรูปในฟอร์มแล้ว กดบันทึกเพื่อยืนยัน");
      return;
    }
    updateProductImage(productId, imageUrl);
    renderAll();
    showToast("บันทึกรูปสินค้าแล้ว");
  } catch (error) {
    console.error(error);
    showToast(`เพิ่มรูปไม่สำเร็จ: ${error.message}`, true);
  }
}

function clearProductDialogImage() {
  el.productImageInput.value = "";
  updateProductImageControls();
}

function updateProductImageControls() {
  const imageUrl = resolveProductImageUrl(el.productImageInput.value);
  el.productImagePreview.innerHTML = imageUrl
    ? `<img class="product-dialog-thumb" src="${escapeHtml(imageUrl)}" alt="รูปสินค้า">`
    : `<span class="product-dialog-empty">ไม่มีรูป</span>`;
  el.productDialogImageBtn.textContent = imageUrl ? "เปลี่ยนรูป" : "เพิ่มรูป";
  el.productDialogRemoveImageBtn.disabled = !imageUrl;
}

function updateBulkProductImageControls() {
  const imageUrl = state.bulkProductImageMode === "set" ? resolveProductImageUrl(el.bulkImageInput.value) : "";
  if (state.bulkProductImageMode === "clear") {
    el.bulkImagePreview.innerHTML = `<span class="product-dialog-empty">จะลบรูปของรายการที่เลือก</span>`;
  } else {
    el.bulkImagePreview.innerHTML = imageUrl
      ? `<img class="product-dialog-thumb" src="${escapeHtml(imageUrl)}" alt="รูปสินค้า">`
      : `<span class="product-dialog-empty">ไม่มีรูป</span>`;
  }
  el.bulkImageFileBtn.textContent = imageUrl ? "เปลี่ยนรูป" : "เพิ่ม/เปลี่ยนรูป";
  el.bulkImageRemoveBtn.disabled = state.bulkProductImageMode === "clear" && !el.bulkImageInput.value;
}

function openBulkProductDialogImagePicker() {
  el.bulkImageFileInput.value = "";
  el.bulkImageFileInput.click();
}

async function saveBulkProductImageFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพ", true);
    return;
  }
  try {
    const imageUrl = await imageFileToDataUrl(file);
    state.bulkProductImageMode = "set";
    el.bulkImageInput.value = imageUrl;
    updateBulkProductImageControls();
    showToast("เพิ่มรูปใน bulk edit แล้ว");
  } catch (error) {
    console.error(error);
    showToast(`เพิ่มรูปไม่สำเร็จ: ${error.message}`, true);
  }
}

function clearBulkProductImage() {
  state.bulkProductImageMode = "clear";
  el.bulkImageInput.value = "";
  updateBulkProductImageControls();
}

function removeProductImage(productId) {
  const product = getProduct(productId);
  if (!product) return;
  if (product.imageUrl && !confirm(`ลบรูปของ "${product.sku || product.productName}"?`)) return;
  updateProductImage(productId, "");
  renderAll();
  showToast("ลบรูปสินค้าแล้ว");
}

function updateProductImage(productId, imageUrl) {
  state.products = state.products.map((product) => product.id === productId ? { ...product, imageUrl } : product);
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่ได้"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไฟล์รูปไม่ถูกต้อง"));
      img.onload = () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function saveProductBulkForm(event) {
  event.preventDefault();
  const hasWholesale = el.bulkWholesaleInput.value !== "";
  const hasPacking = el.bulkPackingInput.value !== "";
  const hasBulkImage = state.bulkProductImageMode === "set" && el.bulkImageInput.value !== "";
  state.products = state.products.map((product) => {
    if (!state.selectedProducts.has(product.id)) return product;
    const wholesalePrice = hasWholesale ? toNumber(el.bulkWholesaleInput.value) : product.wholesalePrice;
    const packingCost = hasPacking ? toNumber(el.bulkPackingInput.value) : product.packingCost;
    const next = { ...product, wholesalePrice, packingCost, totalCost: calculateProductTotalCost(wholesalePrice, packingCost) };
    if (state.bulkProductImageMode === "clear") {
      next.imageUrl = "";
    } else if (hasBulkImage) {
      next.imageUrl = cleanText(el.bulkImageInput.value);
    }
    return next;
  });
  el.productBulkDialog.close();
  state.selectedProducts.clear();
  state.bulkProductImageMode = "keep";
  recalculateAllSales();
  renderAll();
  showToast("แก้ไขสินค้าหลายรายการแล้ว");
}

function deleteProduct(id) {
  const product = getProduct(id);
  if (!product || !confirm(`ลบ "${product.productName}"?`)) return;
  state.products = state.products.filter((item) => item.id !== id);
  state.sales = state.sales.map((sale) => sale.matchedCostId === id ? calculateSale({ ...sale, matchedCostId: "", matchStatus: "missing" }) : sale);
  renderAll();
  showToast("ลบสินค้าแล้ว");
}

function bulkDeleteProducts() {
  if (!state.selectedProducts.size || !confirm(`ลบสินค้า ${state.selectedProducts.size} รายการ?`)) return;
  const removed = new Set(state.selectedProducts);
  state.products = state.products.filter((item) => !removed.has(item.id));
  state.sales = state.sales.map((sale) => removed.has(sale.matchedCostId) ? calculateSale({ ...sale, matchedCostId: "", matchStatus: "missing" }) : sale);
  state.selectedProducts.clear();
  renderAll();
  showToast("ลบสินค้าที่เลือกแล้ว");
}

function renderStock() {
  const rows = getStockRows();
  const totalUnits = state.products.reduce((sum, product) => sum + toNumber(product.stock), 0);
  const totalValue = state.products.reduce((sum, product) => sum + toNumber(product.stock) * toNumber(product.totalCost), 0);
  const lowCount = state.products.filter((product) => toNumber(product.stock) > 0 && toNumber(product.stock) <= LOW_STOCK_THRESHOLD).length;
  const outCount = state.products.filter((product) => toNumber(product.stock) <= 0).length;
  const kpis = [
    ["จำนวน SKU", state.products.length.toLocaleString("th-TH")],
    ["สต็อกรวม", formatNumber(totalUnits)],
    ["มูลค่าต้นทุน", money(totalValue)],
    ["สต็อกต่ำ", lowCount.toLocaleString("th-TH"), lowCount > 0],
    ["หมด", outCount.toLocaleString("th-TH"), outCount > 0],
  ];
  el.stockKpiGrid.innerHTML = kpis.map(([label, value, warning]) => `
    <div class="kpi">
      <div class="label">${label}</div>
      <div class="value${warning ? " loss" : ""}">${value}</div>
    </div>
  `).join("");

  el.stockCount.textContent = `${rows.length.toLocaleString("th-TH")} จาก ${state.products.length.toLocaleString("th-TH")} รายการ`;
  el.stockTable.innerHTML = rows.length ? rows.map((product) => `
    <tr>
      <td>${productThumb(product)}</td>
      <td><div class="row-title" title="${escapeHtml(product.productName)}">${escapeHtml(product.productName)}</div></td>
      <td>${escapeHtml(product.optionName || "-")}</td>
      <td>${escapeHtml(product.color || "-")}</td>
      <td><span class="sku">${escapeHtml(product.sku || "-")}</span></td>
      <td class="num ${stockClass(product.stock)}">${formatNumber(product.stock)}</td>
      <td>${stockStatusPill(product)}</td>
      <td class="num">${money(toNumber(product.stock) * toNumber(product.totalCost))}</td>
      <td><div class="action-buttons">
        <button class="btn secondary mini" type="button" data-stock-row-edit="${escapeHtml(product.id)}">ปรับ</button>
      </div></td>
    </tr>
  `).join("") : `<tr><td colspan="9"><div class="empty">ไม่พบสินค้าตามตัวกรองนี้</div></td></tr>`;

  el.stockTable.querySelectorAll("[data-stock-row-edit]").forEach((button) => {
    button.addEventListener("click", () => openStockAdjust(button.dataset.stockRowEdit));
  });
}

function getStockRows() {
  const query = normalizeName(el.stockSearch.value);
  const filter = el.stockStatusFilter.value;
  return state.products.filter((product) => {
    if (query && ![product.productName, product.optionName, product.color, product.sku, product.status].some((value) => normalizeName(value).includes(query))) return false;
    const kind = stockKind(product.stock);
    if (filter === "all") return true;
    return filter === kind;
  }).sort((a, b) => toNumber(a.stock) - toNumber(b.stock) || String(a.sku).localeCompare(String(b.sku)));
}

function openStockAdjust(productId = "") {
  state.editingStockProductId = productId || state.products[0]?.id || "";
  populateStockProductSelect();
  el.stockProductInput.value = state.editingStockProductId;
  const product = getProduct(state.editingStockProductId);
  el.stockModeInput.value = "set";
  el.stockQtyInput.value = product ? product.stock : 0;
  el.stockStatusInput.value = product ? displayStockStatus(product) : "";
  updateStockPreview();
  el.stockDialog.showModal();
}

function populateStockProductSelect() {
  el.stockProductInput.innerHTML = state.products.map((product) => `
    <option value="${escapeHtml(product.id)}">${escapeHtml(productCostLabel(product))} / Stock ${formatNumber(product.stock)}</option>
  `).join("");
}

function updateStockPreview() {
  const product = getProduct(el.stockProductInput.value);
  if (!product) {
    el.stockPreview.innerHTML = "";
    return;
  }
  const current = toNumber(product.stock);
  const qty = Math.max(0, toNumber(el.stockQtyInput.value));
  const next = calculateNextStock(current, qty, el.stockModeInput.value);
  el.stockPreview.innerHTML = [
    ["สต็อกปัจจุบัน", formatNumber(current)],
    ["สต็อกหลังบันทึก", formatNumber(next)],
    ["มูลค่าต้นทุนหลังบันทึก", money(next * toNumber(product.totalCost))],
    ["สถานะ", cleanText(el.stockStatusInput.value) || stockStatusText(next)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function saveStockForm(event) {
  event.preventDefault();
  const product = getProduct(el.stockProductInput.value);
  if (!product) return;
  const qty = Math.max(0, toNumber(el.stockQtyInput.value));
  const nextStock = calculateNextStock(toNumber(product.stock), qty, el.stockModeInput.value);
  updateProductStock(product.id, nextStock, cleanText(el.stockStatusInput.value) || stockStatusText(nextStock));
  el.stockDialog.close();
  renderAll();
  showToast("บันทึกสต็อกแล้ว");
}

function updateProductStock(productId, stock, status) {
  state.products = state.products.map((product) => product.id === productId
    ? { ...product, stock: Math.max(0, round2(stock)), status: status || stockStatusText(stock) }
    : product);
}

function calculateNextStock(current, qty, mode) {
  if (mode === "in") return round2(current + qty);
  if (mode === "out") return Math.max(0, round2(current - qty));
  return round2(qty);
}

function exportStock() {
  if (!state.products.length) {
    showToast("ไม่มีข้อมูลสต็อก", true);
    return;
  }
  const data = [
    ["SKU", "ชื่อสินค้า", "ตัวเลือก", "สี", "สต็อก", "สถานะ", "ต้นทุน/ชิ้น (รวม VAT 7%)", "มูลค่าต้นทุน", "รูปภาพ"],
    ...state.products.map((product) => [
      product.sku, product.productName, product.optionName, product.color, product.stock,
      product.status, product.totalCost, round2(toNumber(product.stock) * toNumber(product.totalCost)), product.imageUrl,
    ]),
  ];
  writeWorkbook("TJC-ELECTRIC-สต็อก.xlsx", "สต็อก", data);
}

function renderSales() {
  const query = normalizeName(el.salesSearch.value);
  const rows = state.sales.filter((sale) => {
    if (sale.platform !== state.activePlatform) return false;
    if (!query) return true;
    return [sale.productName, sale.optionName, sale.orderNo, sale.orderStatus, sale.refundStatus].some((value) => normalizeName(value).includes(query));
  });
  el.salesCount.textContent = `${rows.length.toLocaleString("th-TH")} จาก ${state.sales.filter((sale) => sale.platform === state.activePlatform).length.toLocaleString("th-TH")} รายการ`;
  el.salesSelectedCount.textContent = state.selectedSales.size.toLocaleString("th-TH");
  el.salesBulkBar.classList.toggle("active", state.selectedSales.size > 0);
  const visibleIds = rows.map((row) => row.id);
  const checked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedSales.has(id));
  el.salesSelectAll.checked = checked;
  el.salesSelectAll.indeterminate = !checked && visibleIds.some((id) => state.selectedSales.has(id));
  el.salesTable.innerHTML = rows.length ? rows.map((sale) => `
    <tr class="${state.selectedSales.has(sale.id) ? "row-selected" : ""}">
      <td class="check-col"><input type="checkbox" data-sale-select="${escapeHtml(sale.id)}" ${state.selectedSales.has(sale.id) ? "checked" : ""}></td>
      <td>${escapeHtml(sale.orderDate || "-")}</td>
      <td>${escapeHtml(platformName(sale.platform))}</td>
      <td><span class="sku">${escapeHtml(sale.orderNo || "-")}</span></td>
      <td><div class="row-title" title="${escapeHtml(sale.productName)}">${escapeHtml(sale.productName)}</div><div class="subline">${escapeHtml(sale.optionName || "")}</div></td>
      <td>${matchLabel(sale)}</td>
      <td class="num">${money(sale.grossSales)}</td>
      <td class="num">${money(sale.totalFee)}</td>
      <td class="num">${money(sale.sellerDiscount)}</td>
      <td class="num">${money(sale.totalCost)}</td>
      <td class="num ${sale.profit >= 0 ? "profit" : "loss"}">${money(sale.profit)}</td>
      <td>${statusLabel(sale)}</td>
      <td><div class="action-buttons">
        <button class="btn secondary mini" type="button" data-sale-edit="${escapeHtml(sale.id)}">แก้ไข</button>
        <button class="btn danger mini" type="button" data-sale-delete="${escapeHtml(sale.id)}">ลบ</button>
      </div></td>
    </tr>
  `).join("") : `<tr><td colspan="13"><div class="empty">ยังไม่มีรายการขายในแพลตฟอร์มนี้</div></td></tr>`;

  el.salesTable.querySelectorAll("[data-sale-select]").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? state.selectedSales.add(input.dataset.saleSelect) : state.selectedSales.delete(input.dataset.saleSelect);
      renderSales();
    });
  });
  el.salesTable.querySelectorAll("[data-sale-edit]").forEach((button) => button.addEventListener("click", () => openSaleEdit(button.dataset.saleEdit)));
  el.salesTable.querySelectorAll("[data-sale-delete]").forEach((button) => button.addEventListener("click", () => deleteSale(button.dataset.saleDelete)));
}

function toggleAllSales() {
  const query = normalizeName(el.salesSearch.value);
  state.sales.forEach((sale) => {
    const visible = sale.platform === state.activePlatform && (!query || [sale.productName, sale.optionName, sale.orderNo, sale.orderStatus, sale.refundStatus].some((value) => normalizeName(value).includes(query)));
    if (visible) {
      el.salesSelectAll.checked ? state.selectedSales.add(sale.id) : state.selectedSales.delete(sale.id);
    }
  });
  renderSales();
}

function openSaleAdd() {
  state.editingSaleId = null;
  el.saleDialogTitle.textContent = "เพิ่มรายการขาย";
  el.saleForm.reset();
  el.salePlatformInput.value = state.activePlatform;
  el.saleStatusInput.value = "สำเร็จแล้ว";
  el.saleQtyInput.value = 1;
  el.saleCostSearchInput.value = "";
  populateCostSelect(el.saleCostInput, "ยังไม่จับคู่ต้นทุน", "", "", { requireQuery: true });
  updateSalePreview();
  el.saleDialog.showModal();
}

function openSaleEdit(id) {
  const sale = getSale(id);
  if (!sale) return;
  state.editingSaleId = id;
  el.saleDialogTitle.textContent = "แก้ไขรายการขาย";
  el.salePlatformInput.value = sale.platform;
  el.saleDateInput.value = sale.orderDate || "";
  el.saleOrderInput.value = sale.orderNo || "";
  el.saleStatusInput.value = sale.orderStatus || "";
  el.saleRefundInput.value = sale.refundStatus || "";
  el.saleProductInput.value = sale.productName || "";
  el.saleOptionInput.value = sale.optionName || "";
  el.saleQtyInput.value = sale.qty || 1;
  el.salePriceInput.value = sale.salePrice || 0;
  el.saleCommissionInput.value = sale.commissionFee || 0;
  el.saleTransactionInput.value = sale.transactionFee || 0;
  el.saleServiceInput.value = sale.serviceFee || 0;
  el.saleDiscountInput.value = sale.sellerDiscount || 0;
  el.saleCostSearchInput.value = buildSaleCostSearchText(sale);
  populateCostSelect(el.saleCostInput, "ยังไม่จับคู่ต้นทุน", el.saleCostSearchInput.value, sale.matchedCostId || "", { requireQuery: true });
  el.saleCostInput.value = sale.matchedCostId || "";
  updateSalePreview();
  el.saleDialog.showModal();
}

function updateSalePreview() {
  const hasFeeAmounts = [el.saleCommissionInput, el.saleTransactionInput, el.saleServiceInput].some((input) => input.value !== "");
  const sale = calculateSale({
    id: state.editingSaleId || "preview",
    platform: el.salePlatformInput.value || state.activePlatform,
    orderStatus: cleanText(el.saleStatusInput.value),
    refundStatus: cleanText(el.saleRefundInput.value),
    qty: toNumber(el.saleQtyInput.value) || 1,
    salePrice: toNumber(el.salePriceInput.value),
    commissionFee: toNumber(el.saleCommissionInput.value),
    transactionFee: toNumber(el.saleTransactionInput.value),
    serviceFee: toNumber(el.saleServiceInput.value),
    sellerDiscount: toNumber(el.saleDiscountInput.value),
    matchedCostId: el.saleCostInput.value,
    feeFromFile: hasFeeAmounts,
  });
  el.saleCalcPreview.innerHTML = [
    ["ยอดขาย", money(sale.grossSales)],
    ["ค่าธรรมเนียม", money(sale.totalFee)],
    ["ส่วนลดผู้ขาย", money(sale.sellerDiscount)],
    ["ต้นทุน", money(sale.totalCost)],
    ["กำไร", money(sale.profit)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function searchSaleCosts() {
  const currentId = el.saleCostInput.value;
  populateCostSelect(el.saleCostInput, "ยังไม่จับคู่ต้นทุน", el.saleCostSearchInput.value, currentId, { requireQuery: true });
  if (currentId) el.saleCostInput.value = currentId;
  updateSalePreview();
  showToast("ค้นหาสินค้าต้นทุนแล้ว");
}

function saveSaleFromForm(event) {
  event.preventDefault();
  const matchStatus = el.saleCostInput.value ? "matched" : findProductMatch({
    productName: el.saleProductInput.value,
    optionName: el.saleOptionInput.value,
  }).status;
  const hasFeeAmounts = [el.saleCommissionInput, el.saleTransactionInput, el.saleServiceInput].some((input) => input.value !== "");
  const existingSale = state.editingSaleId ? getSale(state.editingSaleId) : null;
  const sale = calculateSale({
    id: state.editingSaleId || createId("s"),
    platform: el.salePlatformInput.value,
    orderNo: cleanText(el.saleOrderInput.value),
    orderStatus: cleanText(el.saleStatusInput.value),
    refundStatus: cleanText(el.saleRefundInput.value),
    orderDate: el.saleDateInput.value,
    productName: cleanText(el.saleProductInput.value),
    optionName: cleanText(el.saleOptionInput.value),
    qty: toNumber(el.saleQtyInput.value) || 1,
    salePrice: toNumber(el.salePriceInput.value),
    sellerDiscount: toNumber(el.saleDiscountInput.value),
    commissionFee: toNumber(el.saleCommissionInput.value),
    transactionFee: toNumber(el.saleTransactionInput.value),
    serviceFee: toNumber(el.saleServiceInput.value),
    feeFromFile: hasFeeAmounts,
    discountIncludedInSalePrice: existingSale?.discountIncludedInSalePrice || false,
    matchedCostId: el.saleCostInput.value,
    matchStatus,
    manualCostMatch: Boolean(el.saleCostInput.value),
    forceIncluded: false,
  });
  if (state.editingSaleId) {
    const index = state.sales.findIndex((item) => item.id === state.editingSaleId);
    if (index >= 0) state.sales[index] = sale;
  } else {
    state.sales.push(sale);
  }
  el.saleDialog.close();
  renderAll();
  showToast("บันทึกรายการขายแล้ว");
}

function openBulkSaleEdit() {
  if (!state.selectedSales.size) return;
  populateCostSelect(el.bulkSaleCostInput, "ไม่เปลี่ยนต้นทุน");
  el.bulkSalePlatformInput.value = "";
  el.bulkSaleCostInput.value = "";
  el.bulkSaleStatusInput.value = "";
  el.bulkSaleRefundInput.value = "";
  el.bulkSaleForceIncludedInput.checked = false;
  el.salesBulkDialog.showModal();
}

function saveSalesBulkForm(event) {
  event.preventDefault();
  const platform = el.bulkSalePlatformInput.value;
  const costId = el.bulkSaleCostInput.value;
  const orderStatus = cleanText(el.bulkSaleStatusInput.value);
  const refundStatus = cleanText(el.bulkSaleRefundInput.value);
  const forceIncluded = el.bulkSaleForceIncludedInput.checked;
  state.sales = state.sales.map((sale) => {
    if (!state.selectedSales.has(sale.id)) return sale;
    const next = {
      ...sale,
      platform: platform || sale.platform,
      matchedCostId: costId || sale.matchedCostId,
      matchStatus: costId ? "matched" : sale.matchStatus,
      manualCostMatch: costId ? true : sale.manualCostMatch,
      orderStatus: orderStatus || sale.orderStatus,
      refundStatus: refundStatus || sale.refundStatus,
      forceIncluded: forceIncluded || sale.forceIncluded,
    };
    return calculateSale(next);
  });
  el.salesBulkDialog.close();
  state.selectedSales.clear();
  renderAll();
  showToast("แก้ไขรายการขายหลายรายการแล้ว");
}

function deleteSale(id) {
  const sale = getSale(id);
  if (!sale || !confirm(`ลบรายการขาย "${sale.productName}"?`)) return;
  state.sales = state.sales.filter((item) => item.id !== id);
  renderAll();
  showToast("ลบรายการขายแล้ว");
}

function bulkDeleteSales() {
  if (!state.selectedSales.size || !confirm(`ลบรายการขาย ${state.selectedSales.size} รายการ?`)) return;
  state.sales = state.sales.filter((item) => !state.selectedSales.has(item.id));
  state.selectedSales.clear();
  renderAll();
  showToast("ลบรายการขายที่เลือกแล้ว");
}

function exportProducts() {
  if (!ensureXlsxReady()) return;
  if (!state.products.length) {
    showToast("ไม่มีข้อมูลสินค้า", true);
    return;
  }
  const rows = [
    ["SKU", "รูปภาพสินค้า", "ชื่อสินค้า", "ตัวเลือก", "สี", "ราคาส่ง", "ค่าแพค", "รวมต้นทุน (รวม VAT 7%)", "สต็อก", "สถานะ"],
    ...state.products.map((product) => [
      product.sku, product.imageUrl, product.productName, product.optionName, product.color,
      product.wholesalePrice, product.packingCost, product.totalCost, product.stock, product.status,
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  applyProductTemplateLayout(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, "สินค้า");
  XLSX.writeFile(workbook, "TJC-ELECTRIC-ต้นทุนสินค้า-ราคา-สต็อก.xlsx");
}

function exportSales() {
  const rows = state.sales.filter((sale) => sale.platform === state.activePlatform);
  if (!rows.length) {
    showToast("ไม่มีรายการขาย", true);
    return;
  }
  const data = [
    ["วันที่", "แพลตฟอร์ม", "คำสั่งซื้อ", "สถานะคำสั่งซื้อ", "สถานะคืนเงิน/คืนสินค้า", "ชื่อสินค้า", "ตัวเลือก", "จำนวน", "ราคาขาย/ชิ้น", "ยอดขาย", "ค่าคอมมิชชั่น", "Transaction Fee", "ค่าบริการ", "รวมค่าธรรมเนียม", "ส่วนลดผู้ขาย", "ต้นทุน", "กำไร", "% กำไร", "นับกำไร"],
    ...rows.map((sale) => [
      sale.orderDate, platformName(sale.platform), sale.orderNo, sale.orderStatus, sale.refundStatus,
      sale.productName, sale.optionName, sale.qty, sale.salePrice, sale.grossSales,
      sale.commissionFee, sale.transactionFee, sale.serviceFee, sale.totalFee,
      sale.sellerDiscount, sale.totalCost, sale.profit, sale.margin,
      sale.includedInProfit ? "ใช่" : "ไม่",
    ]),
  ];
  writeWorkbook(`รายการขายและกำไร-${platformName(state.activePlatform)}.xlsx`, "รายการขาย", data);
}

function writeWorkbook(filename, sheetName, data) {
  if (!ensureXlsxReady()) return;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = data[0].map((header) => ({ wch: Math.max(12, String(header).length + 2) }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filename);
  showToast("ส่งออก Excel แล้ว");
}

function drawTrendChart(canvas, rows) {
  drawChart(canvas, (ctx, width, height) => {
    drawAxes(ctx, width, height);
    if (!rows.length) return drawNoData(ctx, width, height);
    const max = Math.max(...rows.flatMap((row) => [row.sales, row.profit, 0]));
    const chart = getChartBox(width, height);
    const step = chart.w / Math.max(rows.length, 1);
    rows.forEach((row, index) => {
      const x = chart.x + index * step + step * .18;
      const salesH = max ? (row.sales / max) * chart.h : 0;
      const profitH = max ? (Math.max(row.profit, 0) / max) * chart.h : 0;
      ctx.fillStyle = "#9fc7a5";
      ctx.fillRect(x, chart.y + chart.h - salesH, step * .26, salesH);
      ctx.fillStyle = row.profit >= 0 ? "#216e3a" : "#c0272d";
      ctx.fillRect(x + step * .3, chart.y + chart.h - profitH, step * .26, profitH);
      if (index % Math.ceil(rows.length / 6 || 1) === 0) drawText(ctx, row.label.slice(5), x, height - 10, 10, "#63705f");
    });
    drawLegend(ctx, [["ยอดขาย", "#9fc7a5"], ["กำไร", "#216e3a"]], chart.x, 18);
  });
}

function drawHorizontalChart(canvas, rows, unitLabel, color) {
  drawChart(canvas, (ctx, width, height) => {
    if (!rows.length) return drawNoData(ctx, width, height);
    const chart = { x: 130, y: 24, w: width - 160, h: height - 46 };
    const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
    const rowH = chart.h / rows.length;
    rows.forEach((row, index) => {
      const y = chart.y + index * rowH + 6;
      const barW = Math.abs(row.value) / max * chart.w;
      drawText(ctx, row.label, 10, y + 13, 11, "#172014");
      ctx.fillStyle = row.value >= 0 ? color : "#c0272d";
      ctx.fillRect(chart.x, y, barW, Math.max(10, rowH - 12));
      drawText(ctx, `${money(row.value)} ${unitLabel}`, chart.x + barW + 6, y + 12, 10, "#63705f");
    });
  });
}

function drawChart(canvas, painter) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || canvas.parentElement.clientWidth || 480));
  const height = Number(canvas.getAttribute("height")) || 240;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  painter(ctx, width, height);
}

function drawAxes(ctx, width, height) {
  const chart = getChartBox(width, height);
  ctx.strokeStyle = "#dce6d8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chart.x, chart.y);
  ctx.lineTo(chart.x, chart.y + chart.h);
  ctx.lineTo(chart.x + chart.w, chart.y + chart.h);
  ctx.stroke();
}

function getChartBox(width, height) {
  return { x: 44, y: 34, w: width - 62, h: height - 62 };
}

function drawNoData(ctx, width, height) {
  drawText(ctx, "ยังไม่มีข้อมูลสำหรับกราฟนี้", width / 2 - 78, height / 2, 13, "#63705f");
}

function drawLegend(ctx, items, x, y) {
  items.forEach(([label, color], index) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + index * 86, y - 9, 12, 12);
    drawText(ctx, label, x + 17 + index * 86, y, 11, "#63705f");
  });
}

function drawText(ctx, text, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `${size}px Sarabun, Tahoma, sans-serif`;
  ctx.fillText(String(text), x, y);
}

function groupTrend(rows) {
  const grouped = new Map();
  rows.forEach((sale) => {
    const key = sale.orderDate || "ไม่ระบุ";
    const item = grouped.get(key) || { label: key, sales: 0, profit: 0 };
    item.sales += sale.grossSales;
    item.profit += sale.profit;
    grouped.set(key, item);
  });
  return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function groupBy(rows, key, valueKey, limit, labeler = (value) => value) {
  const grouped = new Map();
  rows.forEach((row) => {
    const raw = row[key] || "ไม่ระบุ";
    grouped.set(raw, (grouped.get(raw) || 0) + Number(row[valueKey] || 0));
  });
  return Array.from(grouped.entries())
    .map(([label, value]) => ({ label: String(labeler(label)).slice(0, 24), value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

function populateCostSelect(select, emptyLabel, query = "", currentId = "", options = {}) {
  const normalizedQuery = normalizeName(query);
  if (options.requireQuery && !normalizedQuery) {
    const currentProduct = currentId ? getProduct(currentId) : null;
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)} - กรุณาค้นหาก่อน</option>` +
      (currentProduct ? `<option value="${escapeHtml(currentProduct.id)}">${escapeHtml(productCostLabel(currentProduct))}</option>` : "");
    return;
  }
  const filtered = state.products.filter((product) => {
    if (!normalizedQuery || product.id === currentId) return true;
    return normalizeName(productCostSearchText(product)).includes(normalizedQuery);
  });
  const visibleProducts = filtered.length ? filtered : (options.requireQuery ? [] : state.products);
  const emptyOption = visibleProducts.length ? emptyLabel : `${emptyLabel} - ไม่พบผลค้นหา`;
  select.innerHTML = `<option value="">${escapeHtml(emptyOption)}</option>` + visibleProducts.map((product) => {
    return `<option value="${escapeHtml(product.id)}">${escapeHtml(productCostLabel(product))}</option>`;
  }).join("");
}

function productCostLabel(product) {
  const parts = [
    product.productName,
    product.color ? `สี: ${product.color}` : "",
    product.optionName ? `ตัวเลือก: ${product.optionName}` : "",
    product.sku ? `SKU: ${product.sku}` : "",
  ].filter(Boolean);
  return `${parts.join(" / ")} - ${money(product.totalCost)}`;
}

function productCostSearchText(product) {
  return [
    product.productName,
    product.color,
    product.optionName,
    product.sku,
    product.totalCost,
    money(product.totalCost),
  ].filter(Boolean).join(" ");
}

function buildSaleCostSearchText(sale) {
  return [sale.productName, sale.optionName, sale.sku].filter(Boolean).join(" ");
}

function matchLabel(sale) {
  if (sale.matchedCostId && getProduct(sale.matchedCostId)) return `<span class="match-pill ok">จับคู่แล้ว</span>`;
  if (sale.matchStatus === "ambiguous") return `<span class="match-pill wait">รอเลือกต้นทุน</span>`;
  return `<span class="match-pill miss">ไม่พบต้นทุน</span>`;
}

function statusLabel(sale) {
  if (sale.includedInProfit) return `<span class="status-pill ok">นับกำไร</span>`;
  if (cleanText(sale.orderStatus) === "สำเร็จแล้ว" && !cleanText(sale.refundStatus) && !getProduct(sale.matchedCostId)) {
    return `<span class="status-pill skip">รอเลือกต้นทุน</span>`;
  }
  const reason = sale.refundStatus ? "คืนเงิน/คืนสินค้า" : "สถานะไม่สำเร็จ";
  return `<span class="status-pill skip">${escapeHtml(reason)}</span>`;
}

function productThumb(product) {
  const imageUrl = resolveProductImageUrl(product.imageUrl);
  if (imageUrl) {
    return `<img class="product-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.productName || "สินค้า")}" loading="lazy">`;
  }
  const initials = cleanText(product.sku || product.productName).slice(0, 2).toUpperCase() || "T";
  return `<span class="product-thumb placeholder">${escapeHtml(initials)}</span>`;
}

function stockStatusPill(product) {
  const kind = stockKind(product.stock);
  const label = displayStockStatus(product);
  return `<span class="status-pill stock-${kind}">${escapeHtml(label)}</span>`;
}

function displayStockStatus(product) {
  const kind = stockKind(product?.stock);
  if (kind !== "in") return stockStatusText(product?.stock);
  return cleanText(product?.status) || stockStatusText(product?.stock);
}

function stockKind(stock) {
  const qty = toNumber(stock);
  if (qty <= 0) return "out";
  if (qty <= LOW_STOCK_THRESHOLD) return "low";
  return "in";
}

function stockClass(stock) {
  const kind = stockKind(stock);
  if (kind === "out") return "loss";
  if (kind === "low") return "warn";
  return "profit";
}

function stockStatusText(stock) {
  const kind = stockKind(stock);
  if (kind === "out") return "หมด";
  if (kind === "low") return "สต็อกต่ำ";
  return "มีสินค้าพร้อมจำหน่าย";
}

function getProduct(id) {
  return state.products.find((product) => product.id === id);
}

function getSale(id) {
  return state.sales.find((sale) => sale.id === id);
}

function platformName(id) {
  return getPlatform(id)?.name || id || "-";
}

function findHeader(headers, needles, fallback) {
  const index = headers.findIndex((header) => needles.some((needle) => normalizeName(header).includes(normalizeName(needle))));
  return index >= 0 ? index : fallback;
}

function findProductSubHeader(headers, subHeader, fallback) {
  const target = normalizeName(subHeader);
  const index = headers.findIndex((header) => {
    const normalized = normalizeName(header);
    return normalized === target || normalized.endsWith(` ${target}`) || (target === "ตัวเลือก" && normalized === "ชื่อตัวเลือก");
  });
  return index >= 0 ? index : fallback;
}

function setSelectValue(select, value) {
  select.value = value >= 0 ? String(value) : "";
}

function getSelectIndex(select) {
  const value = select.value;
  return value === "" ? -1 : Number(value);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return cleanText(value).toLowerCase();
}

function normalizeSku(value) {
  return normalizeName(value).replace(/\s+/g, "");
}

function normalizeVariant(value) {
  return normalizeName(value)
    .replace(/สี/g, "")
    .replace(/[+\-_,/()]/g, "")
    .replace(/\s+/g, "");
}

function variantTokens(value) {
  return normalizeName(value)
    .replace(/สี/g, " ")
    .split(/[+\-_,/()\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreProductMatch(product, sale) {
  const saleName = normalizeName(sale.productName);
  const productName = normalizeName(product.productName);
  const nameScore = scoreNameMatch(productName, saleName);
  if (nameScore < 35) return 0;
  let score = nameScore;

  const saleText = `${sale.productName || ""} ${sale.optionName || ""} ${sale.color || ""}`;
  const saleVariant = normalizeVariant(saleText);
  const productOption = normalizeVariant(product.optionName);
  const productColor = normalizeVariant(product.color);
  const productVariant = normalizeVariant(`${product.optionName || ""} ${product.color || ""}`);

  if (productOption && productColor && saleVariant && productVariant && (saleVariant === productVariant || saleVariant.includes(productVariant) || productVariant.includes(saleVariant))) {
    score += 80;
  }
  if (productOption && saleVariant && (saleVariant.includes(productOption) || productOption.includes(saleVariant))) {
    score += 45;
  }
  if (productColor && saleVariant && (saleVariant.includes(productColor) || productColor.includes(saleVariant))) {
    score += 45;
  }

  const productTokens = variantTokens(`${product.optionName || ""} ${product.color || ""}`);
  const saleTokens = new Set(variantTokens(saleText));
  const matchedTokens = productTokens.filter((token) => saleTokens.has(token)).length;
  score += matchedTokens * 15;
  score -= numericFeatureMismatchPenalty(product.productName, sale.productName);

  return score;
}

function numericFeatureMismatchPenalty(productName, saleName) {
  return ["ประตู", "ชั้น"].reduce((penalty, label) => {
    const productValue = extractNumberBeforeLabel(productName, label);
    const saleValue = extractNumberBeforeLabel(saleName, label);
    return productValue && saleValue && productValue !== saleValue ? penalty + 70 : penalty;
  }, 0);
}

function extractNumberBeforeLabel(value, label) {
  const match = normalizeName(value).match(new RegExp(`(\\d+)\\s*${label}`));
  return match ? match[1] : "";
}

function scoreNameMatch(productName, saleName) {
  if (!productName || !saleName) return 0;
  if (productName === saleName) return 100;
  if (saleName.includes(productName) || productName.includes(saleName)) return 85;
  const productTokens = variantTokens(productName);
  const saleTokens = new Set(variantTokens(saleName));
  if (!productTokens.length || !saleTokens.size) return 0;
  const matched = productTokens.filter((token) => saleTokens.has(token) || [...saleTokens].some((saleToken) => saleToken.includes(token) || token.includes(saleToken))).length;
  const ratio = matched / productTokens.length;
  return ratio >= 0.45 ? Math.round(45 + ratio * 35) : 0;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[,%฿\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function absNumber(value) {
  return Math.abs(toNumber(value));
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = cleanText(value);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const thai = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (thai) return `${thai[3]}-${thai[2].padStart(2, "0")}-${thai[1].padStart(2, "0")}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function money(value) {
  return `฿${formatNumber(value)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function calculateProductTotalCost(wholesalePrice, packingCost) {
  return round2(toNumber(wholesalePrice) * (1 + VAT_RATE) + toNumber(packingCost));
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureXlsxReady() {
  if (window.XLSX) return true;
  showToast("ยังโหลดไลบรารี Excel ไม่สำเร็จ กรุณาต่อ internet แล้ว refresh หน้า", true);
  return false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.style.background = isError ? "#bd2a2a" : "#265f37";
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => el.toast.classList.remove("show"), 2800);
}
