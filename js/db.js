(() => {
const DB_PREFIX = "panaderia_josue_v2.";
const REMOTE_ROOT = "panaderia_josue_v2";
const STORE_DEFAULTS = {
  cafeTablesByLocal: {},
  clientAccountsById: {},
  productsById: {},
  salesById: {},
  shiftsById: {},
  whatsappProducts: [],
};

const cache = {};
const remoteReadyStores = {};
const pendingWrites = new Set();

const suppliers = [
  "Oscar",
  "Baqueano",
  "de Quesos (Leo)",
  "Grupo MAX",
  "Maxi Consumo",
  "Don angel",
  "Golosinas",
  "Serenisima",
  "Pastas",
  "Tapas",
  "Coca Cola",
  "Elaboracion propia",
  "Otro",
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
  pendingWrites.add(promise);
  promise
    .catch((error) => {
      console.error(`No se pudo sincronizar ${label} con Firebase`, error);
      window.dispatchEvent(new CustomEvent("panaderia:database-error", { detail: { label, error } }));
    })
    .finally(() => pendingWrites.delete(promise));
  return promise;
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
  localStorage.setItem(DB_PREFIX + name, JSON.stringify(value));
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
    stock: Number(rawProduct.stock || 0),
    supplier: rawProduct.supplier || "Otro",
    category: rawProduct.category || "Panaderia",
    weighable: !!rawProduct.weighable,
  };
}

function saveProduct(rawProduct) {
  const product = normalizeProduct(rawProduct);
  if (!product.name) {
    throw new Error("Falta el nombre del producto.");
  }
  return upsertById("productsById", product);
}

function listProducts() {
  seedProductsIfEmpty();
  return listByStore("productsById").sort((a, b) => a.name.localeCompare(b.name));
}

function initRemoteSync() {
  if (!remoteDb()) return;

  Object.keys(STORE_DEFAULTS).forEach((name) => {
    remoteRef(name).on("value", (snapshot) => {
      const value = snapshot.val();
      remoteReadyStores[name] = true;
      saveLocalStore(name, value === null ? fallbackFor(name) : value);
      dispatchStoreChange(name);
    }, (error) => {
      console.error(`No se pudo leer ${name} desde Firebase`, error);
      window.dispatchEvent(new CustomEvent("panaderia:database-error", { detail: { label: name, error } }));
    });
  });
}

async function flushWrites() {
  const writes = Array.from(pendingWrites);
  if (writes.length === 0) return;
  await Promise.all(writes);
}

window.DB = {
  addShiftMovement,
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
  suppliers,
  updateShift,
  upsertById,
  writeStore,
};

initRemoteSync();
})();
