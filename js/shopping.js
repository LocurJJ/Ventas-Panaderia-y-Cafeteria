const {
  listByStore,
  listProducts,
  saveProduct,
  upsertById,
} = window.DB;

const $ = (id) => document.getElementById(id);
let selectedGroupKey = "";
let receiving = null;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateText(value) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function numberText(value) {
  return Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
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

function supplierGroups() {
  const groups = [];

  activeOrders().forEach(function (order) {
    const bySupplier = new Map();
    (order.items || []).forEach(function (item) {
      const supplier = item.supplier || "Otro";
      if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
      bySupplier.get(supplier).push(item);
    });

    bySupplier.forEach(function (items, supplier) {
      const pendingItems = items.filter(function (item) { return !item.receivedAt; });
      if (!pendingItems.length) return;
      groups.push({
        key: order.id + "::" + supplier,
        order: order,
        supplier: supplier,
        items: items,
        pendingItems: pendingItems,
      });
    });
  });

  return groups;
}

function renderStatus(groups) {
  const pendingProducts = groups.reduce(function (sum, group) {
    return sum + group.pendingItems.length;
  }, 0);
  const suppliers = new Set(groups.map(function (group) { return group.supplier; }));

  $("pendingBadge").textContent = pendingProducts;
  $("shoppingStatus").innerHTML =
    '<article><strong>' + suppliers.size + '</strong><span>mayoristas pendientes</span></article>' +
    '<article><strong>' + pendingProducts + '</strong><span>productos por conseguir</span></article>';
}

function renderInbox(groups) {
  $("supplierChatList").innerHTML = groups.length === 0
    ? '<div class="empty-purchase compact-empty"><strong>Todo comprado</strong><span>No hay productos pendientes.</span></div>'
    : groups.map(function (group) {
        const active = group.key === selectedGroupKey ? " active" : "";
        return '<button class="supplier-chat' + active + '" type="button" data-group-key="' + escapeHtml(group.key) + '">' +
          '<span class="supplier-avatar">' + escapeHtml(group.supplier.charAt(0).toUpperCase()) + '</span>' +
          '<span class="supplier-chat-copy"><strong>' + escapeHtml(group.supplier) + '</strong><small>Orden ' + dateText(group.order.createdAt) + '</small><span>' + group.pendingItems.length + (group.pendingItems.length === 1 ? " producto pendiente" : " productos pendientes") + '</span></span>' +
          '<span class="notification-badge">' + group.pendingItems.length + '</span>' +
          '</button>';
      }).join("");
}

function renderDetail(groups) {
  const group = groups.find(function (item) { return item.key === selectedGroupKey; });
  if (!group) {
    selectedGroupKey = groups.length ? groups[0].key : "";
  }
  const selected = groups.find(function (item) { return item.key === selectedGroupKey; });

  if (!selected) {
    $("supplierDetail").innerHTML = '<div class="empty-purchase"><strong>No hay compras pendientes.</strong><span>Una nueva orden preparada desde la PC aparecerá acá.</span></div>';
    return;
  }

  $("supplierDetail").innerHTML =
    '<header class="supplier-detail-head"><div><p class="eyebrow">Mayorista</p><h2>' + escapeHtml(selected.supplier) + '</h2><span>Orden del ' + dateText(selected.order.createdAt) + '</span></div><span class="notification-badge">' + selected.pendingItems.length + '</span></header>' +
    '<div class="shopping-item-list">' +
      selected.items.map(function (item) {
        const received = !!item.receivedAt;
        const unit = item.weighable ? "kg" : "un.";
        const detail = received
          ? 'Comprado: ' + numberText(item.receivedPacks) + ' packs · +' + numberText(item.receivedUnits) + ' ' + unit + ' al stock'
          : 'Pedido: ' + numberText(item.orderedPacks) + ' packs · ' + numberText(item.packQuantity) + ' ' + unit + ' por pack';
        return '<button class="shopping-item' + (received ? " received" : "") + '" type="button" data-order-id="' + escapeHtml(selected.order.id) + '" data-item-id="' + escapeHtml(item.id) + '"' + (received ? " disabled" : "") + '>' +
          '<span class="item-check">' + (received ? "✓" : "") + '</span>' +
          '<span class="shopping-item-copy"><strong>' + escapeHtml(item.name) + '</strong><span>' + detail + '</span>' +
          (received ? '<small>Confirmado ' + dateText(item.receivedAt) + '</small>' : '<small>Tocá para confirmar la cantidad conseguida</small>') +
          '</span></button>';
      }).join("") +
    '</div>';
}

function render() {
  const groups = supplierGroups();
  renderStatus(groups);
  renderInbox(groups);
  renderDetail(groups);
}

function findOrderAndItem(orderId, itemId) {
  const order = listByStore("purchaseOrdersById").find(function (entry) {
    return entry.id === orderId;
  });
  const item = order && (order.items || []).find(function (entry) {
    return entry.id === itemId;
  });
  return order && item ? { order: order, item: item } : null;
}

function openReceiveDialog(orderId, itemId) {
  const found = findOrderAndItem(orderId, itemId);
  if (!found || found.item.receivedAt) return;
  receiving = found;
  const item = found.item;
  $("receiveProductName").textContent = item.name;
  $("receiveProductInfo").textContent = "Pedido: " + numberText(item.orderedPacks) + " packs · " + numberText(item.packQuantity) + (item.weighable ? " kg" : " unidades") + " por pack";
  $("receivedPacksInput").value = Math.max(1, Number(item.orderedPacks || 1));
  updateStockPreview();
  $("receiveDialog").showModal();
  setTimeout(function () {
    $("receivedPacksInput").focus();
    $("receivedPacksInput").select();
  }, 50);
}

function updateStockPreview() {
  if (!receiving) return;
  const packs = Math.max(0, Math.floor(Number($("receivedPacksInput").value || 0)));
  const units = packs * Number(receiving.item.packQuantity || 1);
  $("stockPreview").textContent = "Se sumarán " + numberText(units) + (receiving.item.weighable ? " kg" : " unidades") + " al stock.";
}

function confirmReceived() {
  if (!receiving) return;
  const packs = Math.max(0, Math.floor(Number($("receivedPacksInput").value || 0)));
  if (packs < 1) {
    alert("Ingresá al menos 1 pack. Si no lo conseguiste, dejalo pendiente.");
    return;
  }

  const latest = findOrderAndItem(receiving.order.id, receiving.item.id);
  if (!latest || latest.item.receivedAt) {
    $("receiveDialog").close();
    receiving = null;
    render();
    return;
  }

  const products = listProducts();
  const product = products.find(function (entry) {
    return entry.id === latest.item.productId;
  });
  if (!product) {
    alert("No encontré el producto en el stock. No se realizó ningún cambio.");
    return;
  }

  const units = packs * Number(latest.item.packQuantity || 1);
  saveProduct(Object.assign({}, product, {
    stock: Number(product.stock || 0) + units,
  }));

  const updatedItems = latest.order.items.map(function (item) {
    if (item.id !== latest.item.id) return item;
    return Object.assign({}, item, {
      receivedPacks: packs,
      receivedUnits: units,
      receivedAt: new Date().toISOString(),
    });
  });
  const completed = updatedItems.every(function (item) { return !!item.receivedAt; });

  upsertById("purchaseOrdersById", Object.assign({}, latest.order, {
    items: updatedItems,
    status: completed ? "completed" : "active",
    completedAt: completed ? new Date().toISOString() : null,
  }));

  $("receiveDialog").close();
  receiving = null;
  render();
}

$("supplierChatList").addEventListener("click", function (event) {
  const button = event.target.closest("[data-group-key]");
  if (!button) return;
  selectedGroupKey = button.dataset.groupKey;
  render();
  if (window.innerWidth < 780) {
    $("supplierDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

$("supplierDetail").addEventListener("click", function (event) {
  const button = event.target.closest("[data-order-id][data-item-id]");
  if (!button) return;
  openReceiveDialog(button.dataset.orderId, button.dataset.itemId);
});

$("receivedPacksInput").addEventListener("input", updateStockPreview);
$("cancelReceiveButton").addEventListener("click", function () {
  $("receiveDialog").close();
  receiving = null;
});
$("receiveForm").addEventListener("submit", function (event) {
  event.preventDefault();
  confirmReceived();
});

window.addEventListener("panaderia:store-changed", function (event) {
  const name = event.detail && event.detail.name;
  if (name === "purchaseOrdersById" || name === "productsById") render();
});

window.addEventListener("panaderia:database-error", function () {
  alert("No se pudo confirmar la compra. Revisá la conexión antes de volver a intentar.");
});

render();
