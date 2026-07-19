const {
  addShiftMovement,
  createId,
  calculateSalePrice,
  closeShift,
  getOpenShift,
  listByStore,
  listProducts,
  listSales,
  markSaleDeleted,
  openShift,
  readStore,
  removeShiftMovement,
  saveProduct,
  saveSale,
  seedProductsIfEmpty,
  suppliers,
  writeStore,
} = window.DB;

const params = new URLSearchParams(window.location.search);
const local = params.get("local") || "Central";
const clients = ["Consumidor final", "Lorena", "Ulices", "Josue", "Juan y Bety", "Gera", "Laura"];
const accountClients = ["Lorena", "Ulices"];

let products = [];
let cart = [];
let activeView = "sell";
let selectedMiniProductId = "";
let cafeMode = "counter";
let selectedTableId = "mesa_1";
let paymentTarget = "cart";
let isSavingSale = false;

const TABLE_COUNT = 8;
const TABLE_STORE = "cafeTablesByLocal";
const CLIENT_ACCOUNT_STORE = "clientAccountsById";

const $ = (id) => document.getElementById(id);

function money(value) {
  return `$ ${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function kg(value) {
  const grams = Math.round(Number(value || 0) * 1000);
  if (grams < 1000) return `${grams} g`;
  return `${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg`;
}

function saleTotal() {
  return cart.reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function currentClient() {
  return $("clientSelect")?.value || "Consumidor final";
}

function isAccountClient(clientName = currentClient()) {
  return accountClients.includes(clientName);
}

function paymentTotalValue() {
  return paymentTarget === "table" ? tableTotal(getTableOrder()) : saleTotal();
}

function getTableOrders() {
  const all = readStore(TABLE_STORE, {});
  return all[local] || {};
}

function saveTableOrders(tables) {
  const all = readStore(TABLE_STORE, {});
  all[local] = tables;
  writeStore(TABLE_STORE, all);
}

function getTableOrder(tableId = selectedTableId) {
  const tables = getTableOrders();
  const storedOrder = tables[tableId] || {};
  const items = Array.isArray(storedOrder.items)
    ? storedOrder.items
    : Object.values(storedOrder.items || {});

  return {
    status: "free",
    createdAt: new Date().toISOString(),
    ...storedOrder,
    id: tableId,
    items,
  };
}

function saveTableOrder(order) {
  const tables = getTableOrders();
  tables[order.id] = { ...order, updatedAt: new Date().toISOString() };
  saveTableOrders(tables);
}

function tableTotal(order = getTableOrder()) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function loadProducts() {
  seedProductsIfEmpty();
  products = listProducts();
}

function adjustStockForItems(items, direction) {
  const records = readStore("productsById", {});
  (items || []).forEach((item) => {
    const product = records[item.productId];
    if (!product) return;
    product.stock = Number(product.stock || 0) + (Number(item.quantity || 0) * direction);
    product.updatedAt = new Date().toISOString();
  });
  writeStore("productsById", records);
  loadProducts();
}

function applySaleStock(sale) {
  adjustStockForItems(sale.items, -1);
}

function restoreSaleStock(sale) {
  adjustStockForItems(sale.items, 1);
}

function saveClientAccount(entry) {
  const records = readStore(CLIENT_ACCOUNT_STORE, {});
  records[entry.id] = entry;
  writeStore(CLIENT_ACCOUNT_STORE, records);
  return entry;
}

function listClientAccounts(clientName) {
  return listByStore(CLIENT_ACCOUNT_STORE)
    .filter((entry) => entry.client === clientName && !entry.paidAt && !entry.deletedAt)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function currentProductPrice(productId, fallbackPrice) {
  const product = products.find((item) => item.id === productId);
  return Number(product?.salePrice ?? fallbackPrice ?? 0);
}

function accountItemTotal(item) {
  return Math.round(Number(item.quantity || 0) * currentProductPrice(item.productId, item.unitPrice));
}

function accountEntryTotal(entry) {
  return (entry.items || []).reduce((sum, item) => sum + accountItemTotal(item), 0);
}

function accountItemText(item) {
  const quantity = item.weighable ? kg(item.quantity) : `${Number(item.quantity || 0)} un.`;
  return `${item.name || "Producto"} x ${quantity}`;
}

function currentShift() {
  return getOpenShift(local);
}

function requireOpenShift() {
  if (currentShift()) return true;
  alert("Primero abri turno en la seccion Turnos.");
  showView("shift");
  return false;
}

function showView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  if (viewName === "sell" && local === "Cafeteria" && cafeMode === "tables") {
    $("cafeTableView").classList.remove("hidden");
    renderCafeTables();
  } else {
    const view = document.getElementById(`${viewName}View`);
    if (!view) {
      alert(`No encontre la pantalla ${viewName}. Avisame con esta foto.`);
      return;
    }
    view.classList.remove("hidden");
  }
  document.querySelectorAll(".sidebar nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  if (viewName === "shift") renderShift();
  if (viewName === "notebook") renderNotebook();
  if (viewName === "products") renderMiniProducts();
  if (viewName === "clients") renderClients();
}

function setCafeMode(mode) {
  cafeMode = mode;
  document.querySelectorAll("[data-cafe-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.cafeMode === mode);
  });
  showView("sell");
}

function renderProducts() {
  const search = $("productSearch").value.trim().toLowerCase();
  const filtered = products.filter((product) => {
    const text = `${product.name} ${product.barcode || ""}`.toLowerCase();
    const category = product.category || "Panaderia";
    return text.includes(search) && (local !== "Cafeteria" || category !== "Cafeteria");
  });

  $("productGrid").innerHTML = filtered.map((product) => `
    <button class="product-card ${product.weighable ? "weighable" : ""}" data-product-id="${product.id}">
      <strong>${product.name}</strong>
      <span>${money(product.salePrice)}${product.weighable ? "/kg" : ""}</span>
      <small>Stock: ${product.weighable ? kg(product.stock) : `${product.stock || 0}`}</small>
    </button>
  `).join("");
}

function tableLabel(tableId) {
  return `Mesa ${String(tableId || "").replace("mesa_", "")}`;
}

function statusLabel(status) {
  if (status === "pending") return "Pendiente";
  if (status === "delivered") return "Entregado";
  return "Libre";
}

function renderCafeTables() {
  const tables = getTableOrders();
  const tableItems = Array.from({ length: TABLE_COUNT }, (_, index) => {
    const id = `mesa_${index + 1}`;
    return tables[id] || getTableOrder(id);
  });

  $("tableList").innerHTML = tableItems.map((table) => `
    <button class="table-list-item ${table.id === selectedTableId ? "active" : ""} ${table.status}" type="button" data-table-id="${table.id}">
      <span>${tableLabel(table.id)}</span>
      <strong>${statusLabel(table.status)} - ${money(tableTotal(table))}</strong>
    </button>
  `).join("");

  $("tableMap").innerHTML = tableItems.map((table) => `
    <button class="table-dot ${table.id === selectedTableId ? "active" : ""} ${table.status}" type="button" data-table-id="${table.id}">
      ${String(table.id).replace("mesa_", "")}
    </button>
  `).join("");

  renderCafeProducts();
  renderSelectedTable();
}

function renderCafeProducts() {
  const search = $("cafeProductSearch").value.trim().toLowerCase();
  const filtered = products.filter((product) => {
    const text = `${product.name} ${product.barcode || ""}`.toLowerCase();
    return (product.category || "Panaderia") === "Cafeteria" && text.includes(search);
  });

  $("cafeProductGrid").innerHTML = filtered.length === 0
    ? `<p class="muted">No hay productos de cafeteria. Marcalos con categoria Cafeteria en Productos.</p>`
    : filtered.map((product) => `
      <article class="cafe-product-card ${product.weighable ? "weighable" : ""}">
        <strong>${product.name}</strong>
        <span>${money(product.salePrice)}${product.weighable ? "/kg" : ""}</span>
        <small>${product.weighable ? "Pesable" : "Producto hecho"}</small>
        <button class="primary-button" type="button" data-cafe-product-id="${product.id}">Anadir</button>
      </article>
    `).join("");
}

function renderSelectedTable() {
  const order = getTableOrder();
  $("selectedTableTitle").textContent = `${tableLabel(selectedTableId)} - ${statusLabel(order.status)}`;
  const items = order.items || [];

  $("tableOrderPreview").innerHTML = items.length === 0
    ? `<p class="muted">No hay pedidos en preparacion.</p>`
    : items.map((item) => `<p>${item.quantity} x ${item.name} - ${money(item.total)}</p>`).join("");

  $("tableTicket").innerHTML = items.length === 0
    ? `<p class="muted">Todavia no hay productos.</p>`
    : items.map((item) => `
      <div class="table-ticket-row">
        <span>${item.quantity} x ${item.name}</span>
        <label class="table-item-price">
          <small>Precio c/u</small>
          <input type="number" min="0" step="1" value="${Number(item.unitPrice || 0)}" data-table-item-price="${item.id}" aria-label="Precio unitario de ${item.name}">
        </label>
        <strong>${money(item.total)}</strong>
        <button class="delete-button" type="button" data-table-item-id="${item.id}">-</button>
      </div>
    `).join("");

  $("tableTotal").textContent = money(tableTotal(order));
}

function selectTable(tableId) {
  selectedTableId = tableId;
  renderCafeTables();
}

function addCafeProduct(productId) {
  if (!requireOpenShift()) return;
  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const order = getTableOrder();
  const existing = order.items.find((item) => item.productId === product.id && !item.weighable);
  if (existing) {
    existing.quantity += 1;
    existing.total = existing.quantity * existing.unitPrice;
  } else {
    order.items.push({
      id: createId("table_item"),
      productId: product.id,
      name: product.name,
      weighable: !!product.weighable,
      quantity: 1,
      unitPrice: Number(product.salePrice || 0),
      total: Number(product.salePrice || 0),
    });
  }
  order.status = "pending";
  saveTableOrder(order);
  renderCafeTables();
}

function removeCafeItem(itemId) {
  const order = getTableOrder();
  order.items = (order.items || []).filter((item) => item.id !== itemId);
  order.status = order.items.length > 0 ? order.status : "free";
  saveTableOrder(order);
  renderCafeTables();
}

function updateCafeItemPrice(itemId, rawPrice) {
  const unitPrice = Number(rawPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    alert("Ingresa un precio valido.");
    renderSelectedTable();
    return;
  }

  const order = getTableOrder();
  const item = (order.items || []).find((entry) => entry.id === itemId);
  if (!item) return;
  item.unitPrice = unitPrice;
  item.total = Math.round(Number(item.quantity || 0) * unitPrice);
  saveTableOrder(order);
  renderCafeTables();
}

function markTableDelivered() {
  const order = getTableOrder();
  if ((order.items || []).length === 0) return;
  order.status = "delivered";
  saveTableOrder(order);
  renderCafeTables();
}

function printTableTicket() {
  const order = getTableOrder();
  if ((order.items || []).length === 0) {
    alert("La mesa no tiene productos.");
    return;
  }
  const lines = order.items.map((item) => `${item.quantity} x ${item.name} - ${money(item.total)}`).join("\n");
  const text = `${tableLabel(order.id)}\n\n${lines}\n\nTotal: ${money(tableTotal(order))}`;
  const printWindow = window.open("", "_blank", "width=360,height=520");
  printWindow.document.write(`<pre style="font-family: Arial; font-size: 16px; white-space: pre-wrap;">${text}</pre>`);
  printWindow.document.close();
  printWindow.print();
}

function fillMiniSuppliers() {
  $("miniSupplierInput").innerHTML = suppliers.map((supplier) => (
    `<option value="${supplier}">${supplier}</option>`
  )).join("");
}

function renderMiniProducts() {
  loadProducts();
  const search = $("miniProductSearch").value.trim().toLowerCase();
  const filtered = products.filter((product) => {
    const text = `${product.name} ${product.barcode || ""} ${product.supplier || ""}`.toLowerCase();
    return text.includes(search);
  });

  $("miniProductList").innerHTML = filtered.length === 0
    ? `<p class="muted">No hay productos para mostrar.</p>`
    : filtered.map((product) => `
      <button class="mini-product-item ${product.id === selectedMiniProductId ? "active" : ""}" type="button" data-mini-product-id="${product.id}">
        <strong>${product.name}</strong>
        <small>Venta: ${money(product.salePrice)} | Costo: ${money(product.cost)}</small>
        <small>Stock: ${product.stock || 0} ${product.weighable ? "kg" : "un."}</small>
        <small>Proveedor: ${product.supplier || "Otro"} | ${product.category || "Panaderia"}</small>
        <small>Codigo: ${product.barcode || "Sin codigo"}</small>
      </button>
    `).join("");
}

function resetMiniProductForm() {
  selectedMiniProductId = "";
  $("miniProductForm").reset();
  $("miniProductId").value = "";
  $("miniStockInput").value = "0";
  $("miniSupplierInput").value = "Otro";
  $("miniCategoryInput").value = "Panaderia";
  $("miniProductTitle").textContent = "Anadir producto";
  renderMiniProducts();
}

function selectMiniProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  selectedMiniProductId = product.id;
  $("miniProductId").value = product.id;
  $("miniNameInput").value = product.name;
  $("miniCostInput").value = product.cost || 0;
  $("miniSaleInput").value = product.salePrice || 0;
  $("miniBarcodeInput").value = product.barcode || "";
  $("miniStockInput").value = product.stock || 0;
  $("miniSupplierInput").value = product.supplier || "Otro";
  $("miniCategoryInput").value = product.category || "Panaderia";
  $("miniWeighableInput").checked = !!product.weighable;
  $("miniProductTitle").textContent = "Modificar producto";
  renderMiniProducts();
}

function readMiniProductForm() {
  const cost = Number($("miniCostInput").value || 0);
  const salePrice = $("miniSaleInput").value === "" ? calculateSalePrice(cost) : $("miniSaleInput").value;

  return {
    id: $("miniProductId").value,
    name: $("miniNameInput").value,
    cost,
    salePrice,
    barcode: $("miniBarcodeInput").value,
    stock: $("miniStockInput").value,
    supplier: $("miniSupplierInput").value,
    category: $("miniCategoryInput").value,
    weighable: $("miniWeighableInput").checked,
  };
}

function addProduct(productId) {
  if (!isAccountClient() && !requireOpenShift()) return;
  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const existing = cart.find((item) => item.productId === product.id && !item.weighable);
  if (existing) {
    existing.quantity += 1;
    existing.total = existing.quantity * existing.unitPrice;
  } else {
    const quantity = product.weighable ? 1 : 1;
    cart.push({
      id: createId("cart"),
      productId: product.id,
      name: product.name,
      weighable: !!product.weighable,
      quantity,
      unitPrice: Number(product.salePrice || 0),
      total: Number(product.salePrice || 0) * quantity,
    });
  }
  renderCart();
}

function renderCart() {
  if (cart.length === 0) {
    $("cartList").innerHTML = `<p class="cart-empty">Todavia no agregaste productos.</p>`;
  } else {
    $("cartList").innerHTML = cart.map((item) => `
      <div class="cart-row" data-cart-id="${item.id}">
        <div>
          <strong>${item.name}</strong>
          ${item.weighable ? `<small>${money(item.unitPrice)} por kg</small>` : ""}
        </div>
        <input class="quantity-input" type="number" min="0" step="1" value="${item.weighable ? Math.round(item.quantity * 1000) : item.quantity}">
        <input class="price-input" type="number" min="0" step="1" value="${item.total}">
        <button class="delete-button" type="button">X</button>
      </div>
    `).join("");
  }
  $("cartTotal").textContent = money(saleTotal());
}

function updateCartRow(row, changedInput) {
  const item = cart.find((cartItem) => cartItem.id === row.dataset.cartId);
  if (!item) return;
  const quantityInput = row.querySelector(".quantity-input");
  const priceInput = row.querySelector(".price-input");
  const quantity = Number(quantityInput.value || 0);
  const total = Number(priceInput.value || 0);

  if (item.weighable) {
    if (changedInput === quantityInput) {
      item.quantity = quantity / 1000;
      item.total = Math.round(item.quantity * item.unitPrice);
      priceInput.value = item.total;
    } else {
      item.total = total;
      item.quantity = item.unitPrice > 0 ? total / item.unitPrice : 0;
      quantityInput.value = Math.round(item.quantity * 1000);
    }
  } else {
    if (changedInput === quantityInput) {
      item.quantity = quantity;
      item.total = Math.round(item.quantity * item.unitPrice);
      priceInput.value = item.total;
    } else {
      item.total = total;
      item.unitPrice = item.quantity > 0 ? total / item.quantity : total;
    }
  }
  $("cartTotal").textContent = money(saleTotal());
}

function saveClientAccountSale() {
  if (isSavingSale) return;
  const client = currentClient();
  if (!isAccountClient(client)) return;

  const ok = confirm(`Anotar esta cuenta a ${client}? No se suma al turno.`);
  if (!ok) return;

  const entry = {
    id: createId("account"),
    client,
    local,
    date: new Date().toISOString(),
    items: cart.map((item) => ({ ...item })),
    originalTotal: saleTotal(),
    status: "open",
  };

  try {
    isSavingSale = true;
    saveClientAccount(entry);
    applySaleStock({ items: entry.items });
    cart = [];
    loadProducts();
    renderProducts();
    if (local === "Cafeteria") renderCafeProducts();
    renderCart();
    alert(`Cuenta anotada a ${client}.`);
  } catch (error) {
    alert(`No se pudo anotar la cuenta: ${error.message}`);
  } finally {
    isSavingSale = false;
  }
}

function openPayment() {
  if (cart.length === 0) {
    alert("Primero agrega productos.");
    return;
  }
  if (isAccountClient()) {
    saveClientAccountSale();
    return;
  }
  if (!requireOpenShift()) return;
  paymentTarget = "cart";
  $("paymentTotal").textContent = money(saleTotal());
  $("cashInput").value = 0;
  $("transferInput").value = 0;
  updatePaymentStatus();
  $("paymentDialog").showModal();
  setTimeout(() => $("cashInput").focus(), 50);
}

function openTablePayment() {
  const order = getTableOrder();
  if ((order.items || []).length === 0) {
    alert("La mesa no tiene productos.");
    return;
  }
  if (!requireOpenShift()) return;
  paymentTarget = "table";
  $("paymentTotal").textContent = money(tableTotal(order));
  $("cashInput").value = 0;
  $("transferInput").value = 0;
  updatePaymentStatus();
  $("paymentDialog").showModal();
  setTimeout(() => $("cashInput").focus(), 50);
}

function updatePaymentStatus() {
  const total = paymentTotalValue();
  const paid = Number($("cashInput").value || 0) + Number($("transferInput").value || 0);
  const status = $("paymentStatus");
  status.classList.remove("ok", "warn");
  if (paid >= total) {
    status.textContent = paid > total ? `Vuelto ${money(paid - total)}` : "Pago completo";
    status.classList.add("ok");
  } else {
    status.textContent = `Faltan ${money(total - paid)}`;
    status.classList.add("warn");
  }
}

async function saveCurrentSale() {
  if (isSavingSale) return;
  const total = paymentTotalValue();
  const cash = Number($("cashInput").value || 0);
  const transfer = Number($("transferInput").value || 0);
  const paid = cash + transfer;

  if (paid < total) {
    alert(`Faltan ${money(total - paid)}.`);
    return;
  }

  const shift = currentShift();
  if (!shift) {
    alert("Primero abri turno en la seccion Turnos.");
    return;
  }
  const shiftSales = listSales({ local, shiftId: shift.id, includeDeleted: true });
  const sale = {
    id: createId("sale"),
    saleNumber: shiftSales.length + 1,
    local,
    shiftId: shift.id,
    date: new Date().toISOString(),
    client: $("clientSelect").value,
    origin: paymentTarget === "table" ? "Mesa" : "Mostrador",
    tableId: paymentTarget === "table" ? selectedTableId : "",
    items: paymentTarget === "table"
      ? getTableOrder().items.map((item) => ({ ...item }))
      : cart.map((item) => ({ ...item })),
    total,
    cash,
    transfer,
    change: Math.max(0, paid - total),
    method: cash > 0 && transfer > 0 ? "Mixto" : transfer > 0 ? "Digital" : "Efectivo",
  };

  try {
    isSavingSale = true;
    saveSale(sale);
    applySaleStock(sale);
    await window.DB.flushWrites();
    renderProducts();
    if (local === "Cafeteria") renderCafeProducts();
    if (paymentTarget === "table") {
      saveTableOrder({
        ...getTableOrder(),
        status: "free",
        items: [],
        paidSaleId: sale.id,
        paidAt: new Date().toISOString(),
      });
      renderCafeTables();
    } else {
      cart = [];
      renderCart();
    }
    $("paymentDialog").close();
    alert(`Venta ${sale.saleNumber} guardada en Cuaderno.`);
  } catch (error) {
    console.error(error);
    alert("No se pudo guardar la venta. No cierres la pagina y avisame.");
  } finally {
    isSavingSale = false;
  }
}

function renderShift() {
  const shift = currentShift();
  if (!shift) {
    $("shiftSummary").innerHTML = `
      <h3>Abrir caja</h3>
      <p class="muted">Para vender primero hay que abrir turno.</p>
      <label>Efectivo inicial</label>
      <input id="openShiftCash" type="number" min="0" step="1" value="0">
      <button class="primary-button" data-open-shift type="button" style="width: 100%; margin-top: 10px;">Abrir caja</button>
    `;
    $("expenseList").innerHTML = `<p class="muted">Abri caja para cargar gastos.</p>`;
    $("reinforcementList").innerHTML = `<p class="muted">Abri caja para cargar refuerzos.</p>`;
    return;
  }
  const sales = listSales({ local, shiftId: shift.id });
  const expenseTotal = (shift.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reinforcementTotal = (shift.reinforcements || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashSales = sales.reduce((sum, sale) => sum + Number(sale.cash || 0) - Number(sale.change || 0), 0);
  const digitalSales = sales.reduce((sum, sale) => sum + Number(sale.transfer || 0), 0);
  const expectedCash = Number(shift.initialCash || 0) + cashSales + reinforcementTotal - expenseTotal;

  $("shiftSummary").innerHTML = `
    <h3>Resumen</h3>
    <div class="summary-row"><span>Abierto</span><strong>${new Date(shift.openedAt).toLocaleString("es-AR")}</strong></div>
    <div class="summary-row"><span>Efectivo inicial</span><strong>${money(shift.initialCash)}</strong></div>
    <div class="summary-row"><span>Gastos</span><strong>${money(expenseTotal)}</strong></div>
    <div class="summary-row"><span>Ventas en efectivo</span><strong>${money(cashSales)}</strong></div>
    <div class="summary-row"><span>Ventas digital</span><strong>${money(digitalSales)}</strong></div>
    <div class="summary-row"><span>Refuerzos</span><strong>${money(reinforcementTotal)}</strong></div>
    <div class="summary-row"><span>Efectivo teorico en caja</span><strong>${money(expectedCash)}</strong></div>
    <button class="primary-button" data-close-shift style="background: var(--red); border-color: var(--red); width: 100%; margin-top: 14px;" type="button">Cerrar caja</button>
  `;

  renderMovements("expense");
  renderMovements("reinforcement");
}

function renderMovements(type) {
  const shift = currentShift();
  if (!shift) return;
  const field = type === "expense" ? "expenses" : "reinforcements";
  const listId = type === "expense" ? "expenseList" : "reinforcementList";
  const items = shift[field] || [];
  $(listId).innerHTML = items.length === 0
    ? `<p class="muted">Sin ${type === "expense" ? "gastos" : "refuerzos"} cargados.</p>`
    : items.map((item) => `
      <div class="movement-row">
        <span>${item.detail || "-"}</span>
        <strong>${money(item.amount)}</strong>
        <button class="delete-button" data-movement-type="${type}" data-movement-id="${item.id}">X</button>
      </div>
    `).join("");
}

function saleItemsText(sale) {
  const items = sale.items || [];
  if (items.length === 0) return "Sin detalle";
  return items.map((item) => {
    const quantity = item.weighable ? kg(item.quantity) : `${Number(item.quantity || 0)} un.`;
    return `${item.name || "Producto"} x ${quantity}`;
  }).join(", ");
}

function renderNotebook() {
  const shift = currentShift();
  if (!shift) {
    $("notebookSubtitle").textContent = "No hay turno abierto.";
    $("salesList").innerHTML = `<p class="muted">Abri turno para ver las ventas del dia.</p>`;
    return;
  }
  const sales = listSales({ local, shiftId: shift.id, includeDeleted: true });
  $("notebookSubtitle").textContent = `Historial del turno abierto desde ${new Date(shift.openedAt).toLocaleString("es-AR")}.`;
  $("salesList").innerHTML = sales.length === 0
    ? `<p class="muted">Todavia no hay ventas guardadas.</p>`
    : sales.map((sale) => `
      <article class="sale-item ${sale.deletedAt ? "deleted-sale" : ""}">
        <div>
          <strong>Venta ${sale.saleNumber || "-"}${sale.tableId ? ` - ${tableLabel(sale.tableId)}` : ""}${sale.deletedAt ? " - Anulada" : ""}</strong>
          <small>${new Date(sale.date).toLocaleString("es-AR")} | ${sale.method || "-"}${sale.deletedAt ? ` | ${sale.deletedReason}` : ""}</small>
          <small>${saleItemsText(sale)}</small>
        </div>
        <strong>${money(sale.total)}</strong>
        ${sale.deletedAt ? `<span class="cancelled-badge">Anulada</span>` : `<button class="invoice-button" type="button">Facturar</button>`}
        ${sale.deletedAt ? "" : `<button class="delete-button" data-sale-id="${sale.id}" type="button">X</button>`}
      </article>
    `).join("");
}

function renderClients() {
  const container = $("clientAccounts");
  if (!container) return;

  container.innerHTML = accountClients.map((client) => {
    const entries = listClientAccounts(client);
    const total = entries.reduce((sum, entry) => sum + accountEntryTotal(entry), 0);
    const detail = entries.length === 0
      ? `<p class="muted">Sin productos anotados.</p>`
      : entries.map((entry) => `
        <div class="account-entry">
          <strong>${new Date(entry.date).toLocaleString("es-AR")}</strong>
          <span>${(entry.items || []).map(accountItemText).join(", ")}</span>
          <b>${money(accountEntryTotal(entry))}</b>
        </div>
      `).join("");

    return `
      <article class="client-card">
        <div class="client-card-head">
          <div>
            <h3>${client}</h3>
            <p class="muted">${entries.length} cuenta${entries.length === 1 ? "" : "s"} pendiente${entries.length === 1 ? "" : "s"}</p>
          </div>
          <strong>${money(total)}</strong>
        </div>
        <div class="client-actions">
          <button class="primary-button" type="button" data-print-client="${client}" ${entries.length === 0 ? "disabled" : ""}>Imprimir cuenta</button>
        </div>
        <div class="account-list">${detail}</div>
      </article>
    `;
  }).join("");
}

function printClientAccount(client) {
  const entries = listClientAccounts(client);
  if (entries.length === 0) {
    alert(`No hay cuenta pendiente para ${client}.`);
    return;
  }
  const total = entries.reduce((sum, entry) => sum + accountEntryTotal(entry), 0);
  const rows = entries.map((entry) => `
    <tr>
      <td>${new Date(entry.date).toLocaleString("es-AR")}</td>
      <td>${(entry.items || []).map(accountItemText).join("<br>")}</td>
      <td>${money(accountEntryTotal(entry))}</td>
    </tr>
  `).join("");
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("El navegador bloqueo la ventana de impresion.");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Cuenta ${client}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 28px; color: #111827; }
          h1 { margin: 0 0 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border-bottom: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
          .total { margin-top: 22px; text-align: right; font-size: 22px; font-weight: 800; }
        </style>
      </head>
      <body>
        <h1>Cuenta de ${client}</h1>
        <p>Precios actualizados al ${new Date().toLocaleString("es-AR")}.</p>
        <table>
          <thead><tr><th>Fecha</th><th>Productos</th><th>Importe actual</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total">Total: ${money(total)}</div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function addMovement(type) {
  const detailId = type === "expense" ? "expenseDetail" : "reinforcementDetail";
  const amountId = type === "expense" ? "expenseAmount" : "reinforcementAmount";
  const detail = $(detailId).value.trim();
  const amount = Number($(amountId).value || 0);
  if (!detail || amount <= 0) {
    alert("Completa detalle e importe.");
    return;
  }
  try {
    addShiftMovement(local, type, detail, amount);
  } catch (error) {
    alert(error.message);
    return;
  }
  $(detailId).value = "";
  $(amountId).value = "";
  renderShift();
}

function setupEvents() {
  window.addEventListener("panaderia:store-changed", (event) => {
    const storeName = event.detail?.name;
    if (storeName === "productsById") {
      loadProducts();
      renderProducts();
      renderMiniProducts();
      if (local === "Cafeteria") renderCafeProducts();
    }
    if (["salesById", "shiftsById"].includes(storeName)) {
      if (activeView === "shift") renderShift();
      if (activeView === "notebook") renderNotebook();
    }
    if (storeName === TABLE_STORE && local === "Cafeteria") {
      renderCafeTables();
    }
    if (storeName === CLIENT_ACCOUNT_STORE && activeView === "clients") {
      renderClients();
    }
  });

  window.addEventListener("panaderia:database-error", () => {
    alert("La base de datos no confirmo el guardado. Revisa internet y avisame con una foto si vuelve a pasar.");
  });

  document.querySelectorAll(".sidebar nav button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("productSearch").addEventListener("input", renderProducts);
  $("cafeProductSearch").addEventListener("input", renderCafeProducts);
  document.querySelectorAll("[data-cafe-mode]").forEach((button) => {
    button.addEventListener("click", () => setCafeMode(button.dataset.cafeMode));
  });
  $("miniProductSearch").addEventListener("input", renderMiniProducts);
  $("miniNewProductButton").addEventListener("click", resetMiniProductForm);
  $("miniCostInput").addEventListener("input", () => {
    $("miniSaleInput").value = calculateSalePrice($("miniCostInput").value);
  });

  $("miniProductList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mini-product-id]");
    if (button) selectMiniProduct(button.dataset.miniProductId);
  });

  document.querySelector(".quick-stock").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-delta]");
    if (!button) return;
    $("miniStockInput").value = Number($("miniStockInput").value || 0) + Number(button.dataset.stockDelta || 0);
  });

  $("miniProductForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const product = saveProduct(readMiniProductForm());
      loadProducts();
      selectMiniProduct(product.id);
      renderProducts();
      alert("Producto guardado.");
    } catch (error) {
      alert(error.message);
    }
  });
  $("productSearch").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = event.target.value.trim();
    const exact = products.find((product) => String(product.barcode || "") === query);
    if (!exact) return;
    event.preventDefault();
    addProduct(exact.id);
    event.target.value = "";
    renderProducts();
  });

  $("productGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-product-id]");
    if (card) addProduct(card.dataset.productId);
  });

  $("tableList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-table-id]");
    if (button) selectTable(button.dataset.tableId);
  });

  $("tableMap").addEventListener("click", (event) => {
    const button = event.target.closest("[data-table-id]");
    if (button) selectTable(button.dataset.tableId);
  });

  $("cafeProductGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cafe-product-id]");
    if (button) addCafeProduct(button.dataset.cafeProductId);
  });

  $("tableTicket").addEventListener("click", (event) => {
    const button = event.target.closest("[data-table-item-id]");
    if (button) removeCafeItem(button.dataset.tableItemId);
  });

  $("tableTicket").addEventListener("change", (event) => {
    const input = event.target.closest("[data-table-item-price]");
    if (input) updateCafeItemPrice(input.dataset.tableItemPrice, input.value);
  });

  $("tableTicket").addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-table-item-price]");
    if (input && event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });

  $("markDeliveredButton").addEventListener("click", markTableDelivered);
  $("printTableButton").addEventListener("click", printTableTicket);
  $("chargeTableButton").addEventListener("click", openTablePayment);

  $("cartList").addEventListener("input", (event) => {
    const row = event.target.closest(".cart-row");
    if (row) updateCartRow(row, event.target);
  });

  $("cartList").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-button");
    if (!button) return;
    const row = button.closest(".cart-row");
    cart = cart.filter((item) => item.id !== row.dataset.cartId);
    renderCart();
  });

  $("chargeButton").addEventListener("click", openPayment);
  $("closePayment").addEventListener("click", () => $("paymentDialog").close());
  $("cashInput").addEventListener("input", updatePaymentStatus);
  $("transferInput").addEventListener("input", updatePaymentStatus);
  $("paymentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveCurrentSale();
  });

  $("paymentDialog").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCurrentSale();
    }
  });

  $("addExpenseButton").addEventListener("click", () => addMovement("expense"));
  $("addReinforcementButton").addEventListener("click", () => addMovement("reinforcement"));

  document.addEventListener("click", (event) => {
    const openShiftButton = event.target.closest("[data-open-shift]");
    if (openShiftButton) {
      openShift(local, Number($("openShiftCash").value || 0));
      renderShift();
      return;
    }

    const closeShiftButton = event.target.closest("[data-close-shift]");
    if (closeShiftButton) {
      const actualCash = prompt("Con cuanto efectivo cerro realmente?", "0");
      if (actualCash === null) return;
      closeShift(local, Number(actualCash || 0));
      renderShift();
      return;
    }

    const movementButton = event.target.closest("[data-movement-id]");
    if (movementButton) {
      removeShiftMovement(local, movementButton.dataset.movementType, movementButton.dataset.movementId);
      renderShift();
    }

    const printClientButton = event.target.closest("[data-print-client]");
    if (printClientButton) {
      printClientAccount(printClientButton.dataset.printClient);
      return;
    }

    const saleButton = event.target.closest("[data-sale-id]");
    if (saleButton && confirm("Seguro que queres anular esta venta? Va a quedar marcada en el cuaderno.")) {
      const sale = listSales({ local, includeDeleted: true }).find((item) => item.id === saleButton.dataset.saleId);
      if (!sale || sale.deletedAt) return;
      restoreSaleStock(sale);
      markSaleDeleted(sale.id, "Anulada desde cuaderno");
      renderNotebook();
      renderShift();
      renderProducts();
      if (local === "Cafeteria") renderCafeProducts();
    }
  });
}

function init() {
  $("localName").textContent = local;
  $("clientSelect").innerHTML = clients.map((client) => `<option>${client}</option>`).join("");
  if (local === "Cafeteria") {
    $("cafeModeSwitch").classList.remove("hidden");
  }
  fillMiniSuppliers();
  loadProducts();
  setupEvents();
  renderProducts();
  resetMiniProductForm();
  renderCart();
}

init();

