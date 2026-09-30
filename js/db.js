(() => {
const DB_PREFIX = "panaderia_josue_v2.";
const REMOTE_ROOT = "panaderia_josue_v2";
const STORE_DEFAULTS = {
  cafeTablesByLocal: {},
  clientAccountsById: {},
  productsById: {},
  purchaseOrdersById: {},
  salesById: {},
  shiftsById: {},
  whatsappProducts: [],
};

const cache = {};
const remoteReadyStores = {};
const pendingWrites = new Set();
const REMOTE_ONLY_STORES = new Set(["salesById"]);

const suppliers = [
  "Banylac",
  "Baqueano",
  "Cafeteria Esmeralda",
  "Chipá",
  "Coca-Cola",
  "cookies",
  "Costo Zero",
  "De quesos (Leo)",
  "Don angel",
  "Golosinas",
  "Grupo max",
  "Oscar",
  "Otros",
  "Pan de miga",
  "Pastas",
  "Serenisima",
  "Tapas",
  "Elaboracion propia",
];

function createId(prefix) {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${Date.now()}_${randomPart}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fallbackFor(name, fallback) {
  if (fallback !== undefined) return fallback;
  return STORE_DEFAULTS[name] !== undefined ? clone(STORE_DEFAULTS[name]) : {};
}

function remoteDb() {
  return window.panaderiaFirebaseDb || null;
}

function remoteRef(name) {
  const db = remoteDb();
  return db ? db.ref(`${REMOTE_ROOT}/${name}`) : null;
}

function dispatchStoreChange(name) {
  window.dispatchEvent(new CustomEvent("panaderia:store-changed", { detail: { name } }));
}

function rememberPending(promise, label) {
  const trackedPromise = promise
    .catch((error) => {
      console.error(`No se pudo sincronizar ${label} con Firebase`, error);
      window.dispatchEvent(new CustomEvent("panaderia:database-error", { detail: { label, error } }));
      throw error;
    })
    .finally(() => pendingWrites.delete(trackedPromise));
  trackedPromise.catch(() => {});
  pendingWrites.add(trackedPromise);
  return trackedPromise;
}

function syncStoreToRemote(name, value) {
  const ref = remoteRef(name);
  if (!ref) return null;
  return rememberPending(ref.set(value), name);
}

function syncRecordToRemote(storeName, id, value) {
  const ref = remoteRef(storeName);
  if (!ref || !id) return null;
  return rememberPending(ref.child(id).set(value), `${storeName}/${id}`);
}

function removeRecordFromRemote(storeName, id) {
  const ref = remoteRef(storeName);
  if (!ref || !id) return null;
  return rememberPending(ref.child(id).remove(), `${storeName}/${id}`);
}

function saveLocalStore(name, value) {
  cache[name] = value;
  const storageKey = DB_PREFIX + name;

  // El historial de ventas crece sin limite y supera rapidamente la cuota
  // de localStorage. Firebase conserva el historial completo; en el navegador
  // solo mantenemos la copia en memoria de la sesion.
  if (REMOTE_ONLY_STORES.has(name)) {
    localStorage.removeItem(storageKey);
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    const quotaExceeded = error?.name === "QuotaExceededError"
      || error?.code === 22
      || error?.code === 1014;
    if (!quotaExceeded) throw error;

    // Una copia local llena nunca debe impedir la escritura remota.
    console.warn(`No se pudo guardar ${name} en localStorage por falta de espacio.`);
  }
}

function hasStoreData(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}

function readStore(name, fallback) {
  if (cache[name] !== undefined) return cache[name];
  try {
    const stored = localStorage.getItem(DB_PREFIX + name);
    if (stored) {
      cache[name] = JSON.parse(stored);
      return cache[name];
    }
    return fallbackFor(name, fallback);
  } catch {
    return fallbackFor(name, fallback);
  }
}

function writeStore(name, value, options = {}) {
  saveLocalStore(name, value);
  if (options.syncRemote !== false) {
    syncStoreToRemote(name, value);
  }
  dispatchStoreChange(name);
}

function upsertById(storeName, record) {
  const records = readStore(storeName, {});
  records[record.id] = {
    ...(records[record.id] || {}),
    ...record,
    updatedAt: new Date().toISOString(),
  };
  writeStore(storeName, records, { syncRemote: false });
  syncRecordToRemote(storeName, record.id, records[record.id]);
  return records[record.id];
}

function removeById(storeName, id) {
  const records = readStore(storeName, {});
  delete records[id];
  writeStore(storeName, records, { syncRemote: false });
  removeRecordFromRemote(storeName, id);
}

function listByStore(storeName) {
  return Object.values(readStore(storeName, {}));
}

function saveSale(sale) {
  if (!sale.id) {
    throw new Error("La venta no tiene ID.");
  }

  const latest = readStore("salesById", {});
  if (latest[sale.id]) {
    return latest[sale.id];
  }

  latest[sale.id] = sale;
  writeStore("salesById", latest, { syncRemote: false });
  syncRecordToRemote("salesById", sale.id, sale);
  return sale;
}

function listSales(filters = {}) {
  return listByStore("salesById")
    .filter((sale) => !filters.local || sale.local === filters.local)
    .filter((sale) => !filters.shiftId || sale.shiftId === filters.shiftId)
    .filter((sale) => filters.includeDeleted || !sale.deletedAt)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function markSaleDeleted(id, reason) {
  const records = readStore("salesById", {});
  if (!records[id]) return null;
  records[id] = {
    ...records[id],
    deletedAt: new Date().toISOString(),
    deletedReason: reason || "Venta anulada",
  };
  writeStore("salesById", records, { syncRemote: false });
  syncRecordToRemote("salesById", id, records[id]);
  return records[id];
}

function getOpenShift(local) {
  return listByStore("shiftsById").find((shift) => shift.local === local && !shift.closedAt) || null;
}

function openShift(local, initialCash) {
  const existing = getOpenShift(local);
  if (existing) return existing;
  return upsertById("shiftsById", {
    id: createId("shift"),
    local,
    openedAt: new Date().toISOString(),
    initialCash: Number(initialCash || 0),
    expenses: [],
    reinforcements: [],
  });
}

function updateShift(shift) {
  return upsertById("shiftsById", shift);
}

function closeShift(local, actualCash) {
  const shift = getOpenShift(local);
  if (!shift) return null;
  return updateShift({
    ...shift,
    closedAt: new Date().toISOString(),
    actualCash: Number(actualCash || 0),
  });
}

function addShiftMovement(local, type, detail, amount) {
  const shift = getOpenShift(local);
  if (!shift) throw new Error("Primero hay que abrir caja.");
  const field = type === "expense" ? "expenses" : "reinforcements";
  const movement = {
    id: createId(type),
    detail,
    amount: Number(amount || 0),
    date: new Date().toISOString(),
  };
  shift[field] = [...(shift[field] || []), movement];
  updateShift(shift);
  return movement;
}

function removeShiftMovement(local, type, id) {
  const shift = getOpenShift(local);
  if (!shift) return;
  const field = type === "expense" ? "expenses" : "reinforcements";
  shift[field] = (shift[field] || []).filter((movement) => movement.id !== id);
  updateShift(shift);
}

function seedProductsIfEmpty() {
  if (remoteDb() && !remoteReadyStores.productsById) return;
  const existing = listByStore("productsById");
  if (existing.length > 0) return;

  const samples = [
    { name: "Leche cremigal 1L", salePrice: 1700, cost: 0, barcode: "", stock: 100, weighable: false },
    { name: "Leche sere ent 1L", salePrice: 2000, cost: 0, barcode: "", stock: 95, weighable: false },
    { name: "Pan", salePrice: 2800, cost: 0, barcode: "1", stock: 50, weighable: true },
    { name: "Baggio multifruta 200ml", salePrice: 700, cost: 0, barcode: "", stock: 30, weighable: false },
    { name: "Surtido 1K", salePrice: 6500, cost: 0, barcode: "", stock: 20, weighable: true },
    { name: "Pepas 1/4", salePrice: 4000, cost: 0, barcode: "", stock: 10, weighable: false },
  ];

  const records = {};
  samples.forEach((product) => {
    const id = createId("product");
    records[id] = { id, supplier: "Otro", ...product };
  });
  writeStore("productsById", records);
}

function roundToNearest100(value) {
  return Math.round(Number(value || 0) / 100) * 100;
}

function calculateSalePrice(cost) {
  return roundToNearest100(Number(cost || 0) * 1.3);
}

function normalizeProduct(rawProduct) {
  return {
    id: rawProduct.id || createId("product"),
    name: String(rawProduct.name || "").trim(),
    cost: Number(rawProduct.cost || 0),
    salePrice: Number(rawProduct.salePrice || calculateSalePrice(rawProduct.cost)),
    barcode: String(rawProduct.barcode || "").trim(),
    stock: Math.max(0, Number(rawProduct.stock || 0)),
    supplier: rawProduct.supplier || "Otro",
    category: rawProduct.category || "Panaderia",
    packQuantity: Math.max(0.001, Number(rawProduct.packQuantity || 1)),
    weighable: !!rawProduct.weighable,
  };
}

// Stock is maintained per location. The legacy total is a derived compatibility field.
const STOCK_LOCALS = ["Central", "Sucursal", "Cafeteria"];
function stockNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("La cantidad de stock no es válida.");
  return Math.round(number * 1000) / 1000;
}
function stockByLocal(product) {
  const source = product?.stockByLocal;
  return Object.fromEntries(STOCK_LOCALS.map((local) => [local,
    stockNumber(source ? (source[local] ?? 0) : (local === "Central" ? (product?.stock || 0) : 0))]));
}
function totalStock(product) {
  return stockNumber(Object.values(stockByLocal(product)).reduce((sum, n) => sum + n, 0));
}
function productStock(product, local) {
  if (!STOCK_LOCALS.includes(local)) throw new Error("Seleccioná un local válido.");
  return stockByLocal(product)[local];
}
function withStock(product) {
  const quantities = stockByLocal(product);
  return { ...product, stockByLocal: quantities, stock: totalStock(product),
    legacyStock: product.legacyStock ?? (product.stockByLocal ? null : Number(product.stock || 0)),
    stockAllocationPending: product.stockAllocationPending ?? !product.stockByLocal };
}
function updateProductTransaction(id, transform) {
  const records = readStore("productsById", {});
  const previous = records[id];
  const next = transform(previous || null);
  if (!next) throw new Error("El stock cambió en otra computadora. Volvé a abrir el producto y revisá las cantidades.");
  records[id] = next;
  saveLocalStore("productsById", records);
  dispatchStoreChange("productsById");
  const ref = remoteRef("productsById")?.child(id);
  if (ref) {
    // Never replace another location's quantities with a stale browser copy.
    const promise = ref.transaction((current) => transform(current), undefined, false).then((result) => {
      const latest = readStore("productsById", {});
      if (result.snapshot.val()) latest[id] = result.snapshot.val();
      else delete latest[id];
      saveLocalStore("productsById", latest);
      dispatchStoreChange("productsById");
      if (!result.committed) throw new Error("El producto o su stock cambió. Actualizá antes de guardar otra vez.");
    }).catch((error) => {
      const latest = readStore("productsById", {});
      if (latest[id] === next) {
        if (previous) latest[id] = previous; else delete latest[id];
        saveLocalStore("productsById", latest);
        dispatchStoreChange("productsById");
      }
      throw error;
    });
    rememberPending(promise, `productsById/${id}/stock`);
  }
  return withStock(next);
}
function saveProduct(rawProduct) {
  const product = normalizeProduct(rawProduct);
  if (!product.name) throw new Error("Falta el nombre del producto.");
  const existing = readStore("productsById", {})[product.id];
  const initial = rawProduct.stockByLocal || { Central: product.stock, Sucursal: 0, Cafeteria: 0 };
  return updateProductTransaction(product.id, (current) => {
    if (!current && existing) return;
    const source = current || { ...product, stockByLocal: initial, stockAllocationPending: false };
    return { ...withStock(source), ...product, stockByLocal: stockByLocal(source),
      stock: totalStock(source), updatedAt: new Date().toISOString() };
  });
}
function changeProductStock(productId, value, mode, local, options = {}) {
  if (!STOCK_LOCALS.includes(local)) throw new Error("Indicá a qué local pertenece el stock.");
  const amount = stockNumber(value);
  const operationId = options.id || createId("stock");
  const date = new Date().toISOString();
  return updateProductTransaction(productId, (current) => {
    if (!current) return;
    const applied = current.stockMovements?.[operationId];
    if (applied) {
      if (applied.local !== local || (mode === "adjust" && applied.delta !== amount)) {
        throw new Error("Este ingreso ya fue registrado con otra cantidad o local. Revisá el historial del producto.");
      }
      return current;
    }
    const source = withStock(current);
    const quantities = stockByLocal(source);
    if (mode === "set" && options.expected !== undefined && quantities[local] !== options.expected) return;
    const before = quantities[local];
    quantities[local] = stockNumber(mode === "set" ? amount : before + amount);
    return { ...source, stockByLocal: quantities, stock: totalStock({stockByLocal: quantities}), updatedAt: date,
      legacyStock: current.legacyStock ?? (current.stockByLocal ? null : Number(current.stock || 0)),
      stockMovements: { ...(current.stockMovements || {}), [operationId]: {
        id: operationId, local, date, before, after: quantities[local], delta: stockNumber(quantities[local] - before),
        reason: options.reason || (mode === "set" ? "Corrección" : "Entrada de mercadería")
      } }
    };
  });
}
function adjustProductStock(productId, delta, local, options) {
  return changeProductStock(productId, delta, "adjust", local, options);
}
function setProductStock(productId, stock, local, options) {
  return changeProductStock(productId, stock, "set", local, options);
}
function setProductStocks(productId, quantities, expected, reason = "Conteo por local") {
  const desired = stockByLocal({stockByLocal: quantities});
  const id = createId("count");
  const date = new Date().toISOString();
  return updateProductTransaction(productId, (current) => {
    if (!current) return;
    if (current.stockMovements?.[id]) return current;
    const before = stockByLocal(current);
    if (expected && STOCK_LOCALS.some(local => before[local] !== expected[local])) return;
    return { ...current, stockByLocal: desired, stock: totalStock({stockByLocal: desired}),
      stockAllocationPending: false, updatedAt: date,
      legacyStock: current.legacyStock ?? (current.stockByLocal ? null : Number(current.stock || 0)),
      stockMovements: { ...(current.stockMovements || {}), [id]: {id, date, reason, before, after: desired} }
    };
  });
}
function listProducts() {
  seedProductsIfEmpty();
  return listByStore("productsById").map(withStock).sort((a, b) => a.name.localeCompare(b.name));
}

function initRemoteSync() {
  if (!remoteDb()) return;

  const requestedStores = Array.isArray(window.PANADERIA_SYNC_STORES)
    ? window.PANADERIA_SYNC_STORES.filter((name) => STORE_DEFAULTS[name] !== undefined)
    : Object.keys(STORE_DEFAULTS);

  requestedStores.forEach((name) => {
    remoteRef(name).on("value", (snapshot) => {
      const value = snapshot.val();
      const localValue = readStore(name, fallbackFor(name));
      remoteReadyStores[name] = true;

      if (!hasStoreData(value) && name === "productsById" && hasStoreData(localValue)) {
        syncStoreToRemote(name, localValue);
        dispatchStoreChange(name);
        return;
      }

      saveLocalStore(name, value === null ? fallbackFor(name) : value);
      dispatchStoreChange(name);
    }, (error) => {
      console.error(`No se pudo leer ${name} desde Firebase`, error);
      window.dispatchEvent(new CustomEvent("panaderia:database-error", { detail: { label: name, error } }));
    });
  });
}

function updatePurchaseOrder(id, transform) {
  const records = readStore("purchaseOrdersById", {});
  const previous = records[id];
  const next = transform(previous || null);
  if (!next) throw new Error("El pedido cambió. Actualizá e intentá nuevamente.");
  records[id] = next;
  saveLocalStore("purchaseOrdersById", records);
  dispatchStoreChange("purchaseOrdersById");
  const ref = remoteRef("purchaseOrdersById")?.child(id);
  if (ref) rememberPending(ref.transaction(transform, undefined, false).then(result => {
    const latest = readStore("purchaseOrdersById", {});
    if(result.snapshot.val()) latest[id] = result.snapshot.val(); else delete latest[id];
    saveLocalStore("purchaseOrdersById", latest);dispatchStoreChange("purchaseOrdersById");
    if(!result.committed)throw new Error("El pedido cambió. Actualizá e intentá nuevamente.");
  }).catch(error => {
    const latest = readStore("purchaseOrdersById", {});
    if(latest[id] === next) {
      if(previous)latest[id]=previous;else delete latest[id];
      saveLocalStore("purchaseOrdersById",latest);dispatchStoreChange("purchaseOrdersById");
    }
    throw error;
  }), "purchaseOrdersById/" + id);
  return next;
}

async function flushWrites() {
  const writes = Array.from(pendingWrites);
  if (writes.length === 0) return;
  await Promise.all(writes);
}

window.DB = {
  updatePurchaseOrder,
  STOCK_LOCALS,
  stockByLocal,
  productStock,
  totalStock,
  setProductStocks,
  addShiftMovement,
  adjustProductStock,
  createId,
  flushWrites,
  getOpenShift,
  initRemoteSync,
  listByStore,
  listSales,
  closeShift,
  markSaleDeleted,
  openShift,
  readStore,
  removeById,
  removeShiftMovement,
  calculateSalePrice,
  listProducts,
  normalizeProduct,
  saveProduct,
  saveSale,
  seedProductsIfEmpty,
  setProductStock,
  suppliers,
  updateShift,
  upsertById,
  writeStore,
};

initRemoteSync();
})();
