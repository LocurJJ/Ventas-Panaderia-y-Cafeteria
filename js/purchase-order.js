const {
  createId,
  listByStore,
  listProducts,
  listSales,
  saveProduct,
  upsertById,
} = window.DB;

const $ = (id) => document.getElementById(id);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let suggestedProducts = [];
let hasRemoteProducts = false;
let hasRemoteSales = false;

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

function isOwnProduction(product) {
  return normalized(product.supplier).includes("elaboracion propia");
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

function buildSuggestions() {
  const products = listProducts();
  const productsById = new Map(products.map(function (product) {
    return [product.id, product];
  }));
  const productsByName = new Map(products.map(function (product) {
    return [normalized(product.name), product];
  }));
  const since = Date.now() - WEEK_MS;
  const recentSales = listSales().filter(function (sale) {
    const time = new Date(sale.date || 0).getTime();
    return Number.isFinite(time) && time >= since;
  });
  const weeklyByProduct = new Map();

  recentSales.forEach(function (sale) {
    (sale.items || []).forEach(function (item) {
      const product = productsById.get(item.productId) || productsByName.get(normalized(item.name));
      if (!product || isOwnProduction(product)) return;
      weeklyByProduct.set(product.id, Number(weeklyByProduct.get(product.id) || 0) + Number(item.quantity || 0));
    });
  });

  suggestedProducts = products
    .filter(function (product) {
      return !isOwnProduction(product) && Number(weeklyByProduct.get(product.id) || 0) > 0;
    })
    .map(function (product) {
      const weeklySales = Number(weeklyByProduct.get(product.id) || 0);
      const stock = Number(product.stock || 0);
      const packQuantity = Math.max(0.001, Number(product.packQuantity || 1));
      const missingUnits = Math.max(0, weeklySales - stock);
      return {
        product: product,
        weeklySales: weeklySales,
        stock: stock,
        packQuantity: packQuantity,
        suggestedPacks: Math.ceil(missingUnits / packQuantity),
        urgency: missingUnits,
      };
    })
    .sort(function (a, b) {
      return b.urgency - a.urgency
        || b.weeklySales - a.weeklySales
        || a.stock - b.stock
        || a.product.name.localeCompare(b.product.name);
    })
    .slice(0, 20);

  return {
    products: products,
    recentSales: recentSales,
  };
}

function renderSummary(context) {
  const orders = activeOrders();
  $("orderSummary").innerHTML =
    '<article><span>Ventas analizadas</span><strong>' + context.recentSales.length + '</strong><small>Últimos 7 días · las 3 bocas</small></article>' +
    '<article><span>Productos sugeridos</span><strong>' + suggestedProducts.length + '</strong><small>Máximo 20</small></article>' +
    '<article><span>Órdenes activas</span><strong>' + orders.length + '</strong><small>Pendientes en Compra</small></article>';
}

function renderSuggestions() {
  const context = buildSuggestions();
  renderSummary(context);
  $("suggestionEmpty").classList.toggle("hidden", suggestedProducts.length > 0);
  $("createOrderButton").disabled = suggestedProducts.length === 0;

  $("suggestionRows").innerHTML = suggestedProducts.map(function (row) {
    const product = row.product;
    const unit = product.weighable ? "kg" : "un.";
    return '<tr data-product-id="' + escapeHtml(product.id) + '">' +
      '<td><strong>' + escapeHtml(product.name) + '</strong></td>' +
      '<td><label class="compact-field"><span class="sr-only">Cantidad por pack</span><input type="number" min="0.001" step="0.001" value="' + row.packQuantity + '" data-pack-size></label></td>' +
      '<td><span class="supplier-name">' + escapeHtml(product.supplier || "Otro") + '</span></td>' +
      '<td>' + numberText(row.weeklySales) + ' ' + unit + '</td>' +
      '<td class="' + (row.stock < row.weeklySales ? "low-stock" : "") + '">' + numberText(row.stock) + ' ' + unit + '</td>' +
      '<td><label class="order-quantity"><span>Sugerido: ' + row.suggestedPacks + ' packs</span><input type="number" min="0" step="1" inputmode="numeric" placeholder="' + row.suggestedPacks + '" data-order-packs aria-label="Packs de ' + escapeHtml(product.name) + '"></label></td>' +
      '</tr>';
  }).join("");

  updateSelectedCount();
}

function updateSelectedCount() {
  const count = Array.from(document.querySelectorAll("[data-order-packs]")).filter(function (input) {
    return Number(input.value || 0) > 0;
  }).length;
  $("selectedProductsText").textContent = count + (count === 1 ? " producto seleccionado" : " productos seleccionados");
}

function createOrder() {
  const items = [];

  document.querySelectorAll("#suggestionRows tr").forEach(function (rowElement) {
    const packs = Math.max(0, Math.floor(Number(rowElement.querySelector("[data-order-packs]").value || 0)));
    if (!packs) return;
    const suggestion = suggestedProducts.find(function (row) {
      return row.product.id === rowElement.dataset.productId;
    });
    if (!suggestion) return;

    const packQuantity = Math.max(0.001, Number(rowElement.querySelector("[data-pack-size]").value || 1));
    const product = suggestion.product;
    if (Number(product.packQuantity || 1) !== packQuantity) {
      saveProduct(Object.assign({}, product, { packQuantity: packQuantity }));
    }

    items.push({
      id: createId("purchase_item"),
      productId: product.id,
      name: product.name,
      supplier: product.supplier || "Otro",
      weighable: !!product.weighable,
      packQuantity: packQuantity,
      suggestedPacks: suggestion.suggestedPacks,
      orderedPacks: packs,
      weeklySales: Number(suggestion.weeklySales.toFixed(3)),
      stockAtCreation: Number(suggestion.stock),
      receivedAt: null,
    });
  });

  if (!items.length) {
    alert("Indicá cuántos packs querés pedir en al menos un producto.");
    return;
  }

  const suppliers = new Set(items.map(function (item) { return item.supplier; }));
  const order = {
    id: createId("purchase_order"),
    createdAt: new Date().toISOString(),
    status: "active",
    items: items,
  };
  upsertById("purchaseOrdersById", order);
  document.querySelectorAll("[data-order-packs]").forEach(function (input) { input.value = ""; });
  updateSelectedCount();
  renderActiveOrders();
  alert("Orden creada para " + suppliers.size + (suppliers.size === 1 ? " mayorista." : " mayoristas."));
}

function renderActiveOrders() {
  const orders = activeOrders();
  $("activeOrderList").innerHTML = orders.length === 0
    ? '<div class="empty-purchase"><strong>No hay órdenes activas.</strong><span>Cuando crees una aparecerá acá y en el celular.</span></div>'
    : orders.map(function (order) {
        const pending = (order.items || []).filter(function (item) { return !item.receivedAt; });
        const suppliers = new Set(pending.map(function (item) { return item.supplier || "Otro"; }));
        return '<a class="active-order-card" href="lista-compra.html">' +
          '<div><strong>Orden del ' + dateText(order.createdAt) + '</strong><span>' + suppliers.size + ' mayoristas · ' + pending.length + ' productos pendientes</span></div>' +
          '<span class="order-arrow">›</span>' +
          '</a>';
      }).join("");
}

function refresh() {
  renderSuggestions();
  renderActiveOrders();
}

$("suggestionRows").addEventListener("input", function (event) {
  if (event.target.matches("[data-order-packs]")) updateSelectedCount();
});

$("refreshSuggestionsButton").addEventListener("click", renderSuggestions);
$("createOrderButton").addEventListener("click", createOrder);

window.addEventListener("panaderia:store-changed", function (event) {
  const name = event.detail && event.detail.name;
  if (name === "productsById") hasRemoteProducts = true;
  if (name === "salesById") hasRemoteSales = true;
  if (name === "purchaseOrdersById") renderActiveOrders();
  if ((name === "productsById" || name === "salesById") && hasRemoteProducts && hasRemoteSales) {
    renderSuggestions();
  }
});

window.addEventListener("panaderia:database-error", function () {
  alert("No se pudo sincronizar la orden. Revisá la conexión a internet.");
});

refresh();
