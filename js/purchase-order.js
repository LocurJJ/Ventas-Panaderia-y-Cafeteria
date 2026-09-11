const {
  createId,
  listByStore,
  listProducts,
  listSales,
  saveProduct,
  suppliers,
  upsertById,
} = window.DB;

const $ = (id) => document.getElementById(id);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

let importantProducts = [];
let generalProducts = [];
let recentSalesCount = 0;
let allSalesCount = 0;
let catalogSearch = "";
let catalogView = "important";
let catalogPage = 1;
let draftByProduct = new Map();
let hasRemoteProducts = false;
let hasRemoteSales = false;
let isSavingCatalog = false;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberText(value, maximumFractionDigits) {
  return Number(value || 0).toLocaleString("es-AR", {
    maximumFractionDigits: maximumFractionDigits == null ? 3 : maximumFractionDigits,
  });
}

function dateText(value) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalized(value) {
  return String(value || "")
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isOwnSupplier(value) {
  return normalized(value).includes("elaboracion propia");
}

function activeOrders() {
  return listByStore("purchaseOrdersById")
    .filter(function (order) {
      return order.status !== "completed" && (order.items || []).some(function (item) {
        return !item.receivedAt;
      });
    })
    .sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
}

function draftFor(productId) {
  if (!draftByProduct.has(productId)) draftByProduct.set(productId, {});
  return draftByProduct.get(productId);
}

function stateFor(row) {
  const draft = draftByProduct.get(row.product.id) || {};
  return {
    packQuantity: Object.prototype.hasOwnProperty.call(draft, "packQuantity")
      ? Number(draft.packQuantity)
      : Math.max(0.001, Number(row.product.packQuantity || 1)),
    supplier: Object.prototype.hasOwnProperty.call(draft, "supplier")
      ? draft.supplier
      : (row.product.supplier || "Otro"),
    stock: Object.prototype.hasOwnProperty.call(draft, "stock")
      ? Number(draft.stock)
      : Number(row.product.stock || 0),
    orderPacks: Math.max(0, Math.floor(Number(draft.orderPacks || 0))),
  };
}

function suggestedPacks(row, state) {
  if (isOwnSupplier(state.supplier)) return 0;
  const missingUnits = Math.max(0, Number(row.weeklySales || 0) - Number(state.stock || 0));
  return Math.ceil(missingUnits / Math.max(0.001, Number(state.packQuantity || 1)));
}

function buildCatalog() {
  const products = listProducts();
  const productsById = new Map(products.map(function (product) {
    return [product.id, product];
  }));
  const productsByName = new Map(products.map(function (product) {
    return [normalized(product.name), product];
  }));
  const allSales = listSales();
  const since = Date.now() - WEEK_MS;
  const weeklyByProduct = new Map();
  const historicalByProduct = new Map();

  allSales.forEach(function (sale) {
    const saleTime = new Date(sale.date || 0).getTime();
    const isRecent = Number.isFinite(saleTime) && saleTime >= since;

    (sale.items || []).forEach(function (item) {
      const product = productsById.get(item.productId) || productsByName.get(normalized(item.name));
      if (!product) return;
      const quantity = Number(item.quantity || 0);
      historicalByProduct.set(product.id, Number(historicalByProduct.get(product.id) || 0) + quantity);
      if (isRecent) {
        weeklyByProduct.set(product.id, Number(weeklyByProduct.get(product.id) || 0) + quantity);
      }
    });
  });

  allSalesCount = allSales.length;
  recentSalesCount = allSales.filter(function (sale) {
    const time = new Date(sale.date || 0).getTime();
    return Number.isFinite(time) && time >= since;
  }).length;

  generalProducts = products
    .map(function (product) {
      const weeklySales = Number(weeklyByProduct.get(product.id) || 0);
      const historicalSales = Number(historicalByProduct.get(product.id) || 0);
      return {
        product: product,
        weeklySales: weeklySales,
        historicalSales: historicalSales,
      };
    })
    .sort(function (a, b) {
      return a.product.name.localeCompare(b.product.name, "es-AR");
    });

  importantProducts = generalProducts
    .filter(function (row) {
      return !isOwnSupplier(row.product.supplier) && row.historicalSales > 0;
    })
    .sort(function (a, b) {
      return b.historicalSales - a.historicalSales
        || b.weeklySales - a.weeklySales
        || a.product.name.localeCompare(b.product.name, "es-AR");
    })
    .slice(0, 25);
}

function supplierOptions(selectedSupplier) {
  const values = new Set(suppliers.concat(generalProducts.map(function (row) {
    return row.product.supplier || "Otro";
  })));
  if (selectedSupplier) values.add(selectedSupplier);
  return Array.from(values).map(function (supplier) {
    return '<option value="' + escapeHtml(supplier) + '"' + (supplier === selectedSupplier ? " selected" : "") + '>' + escapeHtml(supplier) + '</option>';
  }).join("");
}

function matchingGeneralProducts() {
  if (!catalogSearch) return generalProducts;
  return generalProducts.filter(function (row) {
    const product = row.product;
    const searchable = normalized((product.name || "") + " " + (product.barcode || "") + " " + (product.supplier || ""));
    return searchable.includes(catalogSearch);
  });
}

function visibleRows() {
  if (catalogView === "important") return importantProducts;
  const matching = matchingGeneralProducts();
  const start = (catalogPage - 1) * PAGE_SIZE;
  return matching.slice(start, start + PAGE_SIZE);
}

function totalPages() {
  return Math.max(1, Math.ceil(matchingGeneralProducts().length / PAGE_SIZE));
}

function renderSummary() {
  const orders = activeOrders();
  $("orderSummary").innerHTML =
    '<article><span>Ventas históricas</span><strong>' + allSalesCount + '</strong><small>Central, Sucursal y Cafetería</small></article>' +
    '<article><span>Productos importantes</span><strong>' + importantProducts.length + '</strong><small>Los 25 más vendidos</small></article>' +
    '<article><span>Órdenes activas</span><strong>' + orders.length + '</strong><small>Pendientes en Compra</small></article>';
}

function rowHtml(row) {
  const product = row.product;
  const state = stateFor(row);
  const unit = product.weighable ? "kg" : "un.";
  const suggestion = suggestedPacks(row, state);
  const ownProduction = isOwnSupplier(state.supplier);
  const orderControl = ownProduction
    ? '<span class="no-purchase">Elaboración propia</span>'
    : '<label class="order-quantity"><span class="suggestion-hint">Sugerido: ' + suggestion + ' packs</span><input type="number" min="0" step="1" inputmode="numeric" value="' + (state.orderPacks || "") + '" placeholder="' + suggestion + '" data-field="orderPacks" aria-label="Packs de ' + escapeHtml(product.name) + '"></label>';

  return '<tr data-product-id="' + escapeHtml(product.id) + '">' +
    '<td><strong>' + escapeHtml(product.name) + '</strong></td>' +
    '<td><label class="compact-field"><span class="sr-only">Cantidad por pack</span><input type="number" min="0.001" step="0.001" value="' + state.packQuantity + '" data-field="packQuantity"></label></td>' +
    '<td><label class="compact-field"><span class="sr-only">Mayorista</span><select data-field="supplier">' + supplierOptions(state.supplier) + '</select></label></td>' +
    '<td>' + numberText(row.weeklySales) + ' ' + unit + '</td>' +
    '<td><label class="stock-field"><span class="sr-only">Stock actual</span><input class="' + (state.stock < row.weeklySales ? "low-stock-input" : "") + '" type="number" step="0.001" value="' + state.stock + '" data-field="stock"><small>' + unit + '</small></label></td>' +
    '<td>' + orderControl + '</td>' +
    '</tr>';
}

function renderPagination() {
  const pagination = $("catalogPagination");
  const pages = totalPages();
  pagination.classList.toggle("hidden", catalogView !== "general");
  $("catalogPageInput").max = pages;
  $("catalogPageInput").value = catalogPage;
  $("catalogTotalPages").textContent = pages;
  $("previousCatalogPage").disabled = catalogPage <= 1;
  $("nextCatalogPage").disabled = catalogPage >= pages;
}

function changedProductCount() {
  return Array.from(draftByProduct.entries()).filter(function (entry) {
    const product = generalProducts.find(function (row) { return row.product.id === entry[0]; });
    if (!product) return false;
    const draft = entry[1];
    return (Object.prototype.hasOwnProperty.call(draft, "packQuantity") && Number(draft.packQuantity) !== Number(product.product.packQuantity || 1))
      || (Object.prototype.hasOwnProperty.call(draft, "stock") && Number(draft.stock) !== Number(product.product.stock || 0))
      || (Object.prototype.hasOwnProperty.call(draft, "supplier") && draft.supplier !== (product.product.supplier || "Otro"));
  }).length;
}

function renderSaveStatus() {
  const count = changedProductCount();
  $("catalogSaveStatus").textContent = count === 0
    ? "Stock, mayorista y packs sin cambios."
    : count + (count === 1 ? " producto modificado sin guardar." : " productos modificados sin guardar.");
  $("catalogSaveStatus").classList.toggle("has-changes", count > 0);
  $("saveCatalogButton").disabled = count === 0;
}

function renderCatalog() {
  buildCatalog();
  catalogPage = Math.min(Math.max(1, catalogPage), totalPages());
  const rows = visibleRows();

  $("importantCount").textContent = importantProducts.length;
  $("generalCount").textContent = generalProducts.length;
  $("catalogTitle").textContent = catalogView === "important" ? "Lo más importante" : "General";
  $("catalogDescription").textContent = catalogView === "important"
    ? "Los 25 productos más vendidos de todo el historial. Elaboración propia no se incluye."
    : (catalogSearch
      ? "Resultados para “" + $("catalogSearchInput").value.trim() + "”, mostrados de 20 por página."
      : "Todos los productos, ordenados alfabéticamente y mostrados de 20 por página.");
  $("importantTab").classList.toggle("active", catalogView === "important");
  $("importantTab").setAttribute("aria-selected", catalogView === "important" ? "true" : "false");
  $("generalTab").classList.toggle("active", catalogView === "general");
  $("generalTab").setAttribute("aria-selected", catalogView === "general" ? "true" : "false");

  $("suggestionRows").innerHTML = rows.map(rowHtml).join("");
  $("suggestionEmpty").classList.toggle("hidden", rows.length > 0);
  $("suggestionEmptyText").textContent = catalogView === "important"
    ? "Cuando haya ventas registradas aparecerán aquí."
    : (catalogSearch ? "Probá con otro nombre, código o mayorista." : "No hay productos cargados.");
  $("createOrderButton").disabled = generalProducts.length === 0;
  renderPagination();
  renderSummary();
  renderSaveStatus();
  updateSelectedCount();
}

function updateRowSuggestion(rowElement) {
  const productId = rowElement.dataset.productId;
  const row = generalProducts.find(function (item) { return item.product.id === productId; });
  const hint = rowElement.querySelector(".suggestion-hint");
  const orderInput = rowElement.querySelector('[data-field="orderPacks"]');
  if (!row || !hint || !orderInput) return;
  const suggestion = suggestedPacks(row, stateFor(row));
  hint.textContent = "Sugerido: " + suggestion + " packs";
  orderInput.placeholder = suggestion;
}

function updateSelectedCount() {
  const count = Array.from(draftByProduct.values()).filter(function (draft) {
    return Number(draft.orderPacks || 0) > 0;
  }).length;
  $("selectedProductsText").textContent = count + (count === 1 ? " producto seleccionado" : " productos seleccionados");
}

function updateDraft(event) {
  const field = event.target.dataset.field;
  const rowElement = event.target.closest("[data-product-id]");
  if (!field || !rowElement) return;
  const draft = draftFor(rowElement.dataset.productId);

  if (field === "supplier") draft.supplier = event.target.value;
  if (field === "stock" || field === "packQuantity") draft[field] = Number(event.target.value || 0);
  if (field === "orderPacks") draft.orderPacks = Math.max(0, Math.floor(Number(event.target.value || 0)));

  if (field === "stock" || field === "packQuantity") updateRowSuggestion(rowElement);
  renderSaveStatus();
  updateSelectedCount();
}

function saveCatalogChanges(showMessage) {
  const changed = [];
  isSavingCatalog = true;

  generalProducts.forEach(function (row) {
    const product = row.product;
    const state = stateFor(row);
    const isChanged = Number(state.packQuantity) !== Number(product.packQuantity || 1)
      || Number(state.stock) !== Number(product.stock || 0)
      || state.supplier !== (product.supplier || "Otro");
    if (!isChanged) return;

    saveProduct(Object.assign({}, product, {
      packQuantity: Math.max(0.001, Number(state.packQuantity || 1)),
      supplier: state.supplier || "Otro",
      stock: Number(state.stock || 0),
    }));
    changed.push(product.id);

    const draft = draftFor(product.id);
    delete draft.packQuantity;
    delete draft.supplier;
    delete draft.stock;
  });

  isSavingCatalog = false;
  renderCatalog();
  if (showMessage) {
    alert(changed.length
      ? "Se guardaron los datos de " + changed.length + (changed.length === 1 ? " producto." : " productos.")
      : "No había cambios para guardar.");
  }
  return changed.length;
}

function createOrder() {
  saveCatalogChanges(false);
  buildCatalog();
  const items = [];

  draftByProduct.forEach(function (draft, productId) {
    const packs = Math.max(0, Math.floor(Number(draft.orderPacks || 0)));
    if (!packs) return;
    const row = generalProducts.find(function (item) { return item.product.id === productId; });
    if (!row) return;
    const state = stateFor(row);
    if (isOwnSupplier(state.supplier)) return;

    items.push({
      id: createId("purchase_item"),
      productId: row.product.id,
      name: row.product.name,
      supplier: state.supplier || "Otro",
      weighable: !!row.product.weighable,
      packQuantity: Math.max(0.001, Number(state.packQuantity || 1)),
      suggestedPacks: suggestedPacks(row, state),
      orderedPacks: packs,
      weeklySales: Number(row.weeklySales.toFixed(3)),
      stockAtCreation: Number(state.stock),
      receivedAt: null,
    });
  });

  if (!items.length) {
    alert("Indicá cuántos packs querés pedir en al menos un producto.");
    return;
  }

  const supplierCount = new Set(items.map(function (item) { return item.supplier; })).size;
  const order = {
    id: createId("purchase_order"),
    createdAt: new Date().toISOString(),
    status: "active",
    items: items,
  };
  upsertById("purchaseOrdersById", order);

  draftByProduct.forEach(function (draft, productId) {
    delete draft.orderPacks;
    if (!Object.keys(draft).length) draftByProduct.delete(productId);
  });

  renderCatalog();
  renderActiveOrders();
  alert("Orden creada para " + supplierCount + (supplierCount === 1 ? " mayorista." : " mayoristas."));
}

function renderActiveOrders() {
  const orders = activeOrders();
  $("activeOrderList").innerHTML = orders.length === 0
    ? '<div class="empty-purchase"><strong>No hay órdenes activas.</strong><span>Cuando crees una aparecerá acá y en el celular.</span></div>'
    : orders.map(function (order) {
        const pending = (order.items || []).filter(function (item) { return !item.receivedAt; });
        const supplierCount = new Set(pending.map(function (item) { return item.supplier || "Otro"; })).size;
        return '<a class="active-order-card" href="lista-compra.html">' +
          '<div><strong>Orden del ' + dateText(order.createdAt) + '</strong><span>' + supplierCount + ' mayoristas · ' + pending.length + ' productos pendientes</span></div>' +
          '<span class="order-arrow">›</span>' +
          '</a>';
      }).join("");
}

function changePage(nextPage) {
  catalogPage = Math.min(Math.max(1, nextPage), totalPages());
  renderCatalog();
  document.querySelector(".order-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("suggestionRows").addEventListener("input", updateDraft);
$("suggestionRows").addEventListener("change", updateDraft);

document.querySelector(".catalog-tabs").addEventListener("click", function (event) {
  const button = event.target.closest("[data-catalog-view]");
  if (!button) return;
  catalogView = button.dataset.catalogView;
  catalogSearch = "";
  $("catalogSearchInput").value = "";
  catalogPage = 1;
  renderCatalog();
});

$("catalogSearchInput").addEventListener("input", function () {
  catalogSearch = normalized(this.value);
  if (catalogSearch) catalogView = "general";
  catalogPage = 1;
  renderCatalog();
});

$("catalogPageInput").addEventListener("change", function () {
  changePage(Number(this.value || 1));
});
$("previousCatalogPage").addEventListener("click", function () { changePage(catalogPage - 1); });
$("nextCatalogPage").addEventListener("click", function () { changePage(catalogPage + 1); });
$("refreshSuggestionsButton").addEventListener("click", renderCatalog);
$("saveCatalogButton").addEventListener("click", function () { saveCatalogChanges(true); });
$("createOrderButton").addEventListener("click", createOrder);

window.addEventListener("panaderia:store-changed", function (event) {
  const name = event.detail && event.detail.name;
  if (name === "productsById") hasRemoteProducts = true;
  if (name === "salesById") hasRemoteSales = true;
  if (name === "purchaseOrdersById") {
    renderActiveOrders();
    renderSummary();
  }
  if (!isSavingCatalog && (name === "productsById" || name === "salesById") && hasRemoteProducts && hasRemoteSales) {
    renderCatalog();
  }
});

window.addEventListener("panaderia:database-error", function () {
  alert("No se pudo guardar el cambio. Revisá la conexión a internet.");
});

renderCatalog();
renderActiveOrders();
