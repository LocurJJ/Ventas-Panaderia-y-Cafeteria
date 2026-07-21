const { listSales, upsertById } = window.DB;

const ARCA_API_URL = String(
  window.ARCA_API_URL || "http://127.0.0.1:8765",
).replace(/\/$/, "");
const $ = (id) => document.getElementById(id);

let sales = [];
let selectedSaleId = "";
let activeArcaView = "sales";

function money(value, decimals = 0) {
  return `$ ${Number(value || 0).toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayText() {
  return new Date().toLocaleDateString("es-AR");
}

function saleDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "sin-fecha";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saleDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const formatted = date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  if (saleDayKey(date) === saleDayKey(today)) return `Hoy · ${formatted}`;
  if (saleDayKey(date) === saleDayKey(yesterday)) return `Ayer · ${formatted}`;
  return formatted;
}

function invoiceFor(sale) {
  return sale?.invoice || sale?.arcaInvoice || null;
}

function isInvoiced(sale) {
  const invoice = invoiceFor(sale);
  return invoice?.status === "issued" && invoice?.mode !== "homologacion" && !!invoice.cae;
}

function isTestInvoiced(sale) {
  const invoice = invoiceFor(sale);
  return invoice?.status === "test_issued" && !!invoice.cae;
}

function hasArcaReceipt(sale) {
  return isInvoiced(sale) || isTestInvoiced(sale);
}

function paymentText(sale) {
  const cash = Number(sale.cash || 0);
  const digital = Number(sale.transfer || 0);
  if (cash > 0 && digital > 0) return "Mixto: efectivo y medios electronicos";
  if (digital > 0) return "Otros medios de pago electronico";
  return "Efectivo";
}

function paymentCode(sale) {
  const cash = Number(sale.cash || 0);
  const digital = Number(sale.transfer || 0);
  if (cash > 0 && digital > 0) return "MIXTO";
  if (digital > 0) return "OTROS_MEDIOS_ELECTRONICOS";
  return "EFECTIVO";
}

function saleItemsText(sale) {
  const items = sale.items || [];
  if (items.length === 0) return "Sin detalle de productos";
  return items.map((item) => {
    const quantity = item.weighable
      ? `${Number(item.quantity || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg`
      : `${Number(item.quantity || 0)} un.`;
    return `${item.name || "Producto"} x ${quantity}`;
  }).join(", ");
}

function refreshSales() {
  sales = listSales({ includeDeleted: false });
}

function selectedStoreSales() {
  const store = $("arcaStoreSelect").value;
  return sales.filter((sale) => sale.local === store);
}

function statusButton(sale) {
  if (isInvoiced(sale)) {
    return `<button class="invoice-status issued" type="button" data-invoice-sale-id="${escapeHtml(sale.id)}">Facturada</button>`;
  }
  if (isTestInvoiced(sale)) {
    return `<button class="invoice-status test-issued" type="button" data-invoice-sale-id="${escapeHtml(sale.id)}">Prueba ARCA</button>`;
  }
  return `<button class="invoice-status pending" type="button" data-invoice-sale-id="${escapeHtml(sale.id)}">No facturada</button>`;
}

function renderSalesSummary(rows) {
  const issued = rows.filter(isInvoiced);
  const tests = rows.filter(isTestInvoiced);
  const pending = rows.filter((sale) => !hasArcaReceipt(sale));
  $("salesStatusSummary").innerHTML = `
    <article><span>Ventas</span><strong>${rows.length}</strong></article>
    <article class="summary-issued"><span>Facturadas</span><strong>${issued.length}</strong></article>
    <article class="summary-test"><span>Pruebas ARCA</span><strong>${tests.length}</strong></article>
    <article class="summary-pending"><span>No facturadas</span><strong>${pending.length}</strong></article>
  `;
}

function saleCard(sale) {
  const invoice = invoiceFor(sale);
  return `
    <article class="arca-sale-card ${isInvoiced(sale) ? "is-issued" : isTestInvoiced(sale) ? "is-test-issued" : ""}">
      <div class="arca-sale-main">
        <div>
          <strong>Venta ${escapeHtml(sale.saleNumber || "-")}${sale.tableId ? ` - Mesa ${escapeHtml(String(sale.tableId).replace("mesa_", ""))}` : ""}</strong>
          <small>${dateText(sale.date)} | ${escapeHtml(sale.local || "-")} | ${escapeHtml(paymentText(sale))}</small>
          <small>${escapeHtml(saleItemsText(sale))}</small>
          ${isInvoiced(sale) ? `<small class="invoice-number">Factura ${escapeHtml(invoice.invoiceNumber || "-")} | CAE ${escapeHtml(invoice.cae)}</small>` : ""}
          ${isTestInvoiced(sale) ? `<small class="test-invoice-number">Prueba sin validez fiscal ${escapeHtml(invoice.invoiceNumber || "-")} | CAE ${escapeHtml(invoice.cae)}</small>` : ""}
        </div>
        <strong class="arca-sale-total">${money(sale.total)}</strong>
      </div>
      ${statusButton(sale)}
    </article>
  `;
}

function renderSalesByDay(rows) {
  const orderedRows = [...rows].sort((a, b) => new Date(b.date) - new Date(a.date));
  const groups = new Map();

  orderedRows.forEach((sale) => {
    const key = saleDayKey(sale.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sale);
  });

  return [...groups.values()].map((daySales) => {
    const total = daySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const count = daySales.length;
    return `
      <section class="arca-day-group">
        <header class="arca-day-header">
          <div>
            <strong>${escapeHtml(saleDayLabel(daySales[0]?.date))}</strong>
            <small>${count} ${count === 1 ? "venta" : "ventas"}</small>
          </div>
          <strong>${money(total)}</strong>
        </header>
        <div class="arca-day-sales">
          ${daySales.map(saleCard).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderSales() {
  const rows = selectedStoreSales();
  renderSalesSummary(rows);
  $("arcaSalesList").innerHTML = rows.length === 0
    ? `<div class="arca-empty"><strong>No hay ventas en ${escapeHtml($("arcaStoreSelect").value)}.</strong><span>Las ventas guardadas en el cuaderno apareceran aca.</span></div>`
    : renderSalesByDay(rows);
}

function renderReports() {
  const status = $("invoiceStatusFilter").value;
  const store = $("arcaStoreSelect").value;
  const storeRows = sales.filter((sale) => sale.local === store);
  const issued = storeRows.filter(isInvoiced);
  const tests = storeRows.filter(isTestInvoiced);
  const pending = storeRows.filter((sale) => !hasArcaReceipt(sale));
  const rows = status === "issued" ? issued : status === "test_issued" ? tests : status === "pending" ? pending : storeRows;
  const issuedTotal = issued.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const testTotal = tests.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const pendingTotal = pending.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

  $("invoiceReportSummary").innerHTML = `
    <article><span>Total vendido</span><strong>${money(storeRows.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</strong></article>
    <article class="summary-issued"><span>Total facturado</span><strong>${money(issuedTotal)}</strong></article>
    <article class="summary-test"><span>Homologacion</span><strong>${money(testTotal)}</strong></article>
    <article class="summary-pending"><span>Pendiente</span><strong>${money(pendingTotal)}</strong></article>
  `;
  $("invoiceReportList").innerHTML = rows.length === 0
    ? `<div class="arca-empty"><strong>No hay comprobantes para este filtro.</strong></div>`
    : renderSalesByDay(rows);
}

function renderAll() {
  renderSales();
  renderReports();
}

function showView(view) {
  activeArcaView = view;
  $("salesView").classList.toggle("hidden", view !== "sales");
  $("reportsView").classList.toggle("hidden", view !== "reports");
  document.querySelectorAll("[data-arca-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.arcaView === view);
  });
  if (view === "reports") renderReports();
}

function currentSale() {
  return sales.find((sale) => sale.id === selectedSaleId) || null;
}

function renderInvoiceTotals() {
  const sale = currentSale();
  if (!sale) return;
  const total = Number(sale.total || 0);
  const rate = Number($("invoiceVatRate").value || 0);
  const net = rate > 0 ? total / (1 + (rate / 100)) : total;
  const vat = total - net;
  $("invoiceTotals").innerHTML = `
    <div><span>Precio final</span><strong>${money(total, 2)}</strong></div>
    <div><span>Neto gravado</span><strong>${money(net, 2)}</strong></div>
    <div><span>IVA ${String(rate).replace(".", ",")} % incluido</span><strong>${money(vat, 2)}</strong></div>
    <div class="invoice-total-line"><span>Total</span><strong>${money(total, 2)}</strong></div>
  `;
}

function showInvoiceResult(sale) {
  const invoice = invoiceFor(sale);
  if (!invoice) return;
  const isTest = isTestInvoiced(sale);
  $("invoiceResultTitle").textContent = isTest ? "Comprobante de prueba autorizado" : "Comprobante autorizado";
  $("authorizedBox").innerHTML = `
    <strong>${isTest ? "Homologacion - sin validez fiscal" : "Comprobante autorizado"}</strong>
    <span>Factura B ${escapeHtml(invoice.invoiceNumber || "-")}</span>
    <span>CAE ${escapeHtml(invoice.cae || "-")}</span>
    <span>${invoice.issuedAt ? dateText(invoice.issuedAt) : ""}</span>
  `;
  const link = $("openInvoiceLink");
  const url = invoice.pdfUrl || invoice.publicUrl || "";
  link.classList.toggle("hidden", !url);
  if (url) link.href = url;
  $("invoiceResultDialog").showModal();
}

function openInvoiceDialog(saleId) {
  const sale = sales.find((item) => item.id === saleId);
  if (!sale) return;
  if (hasArcaReceipt(sale)) {
    showInvoiceResult(sale);
    return;
  }
  selectedSaleId = sale.id;
  $("invoiceDate").value = todayText();
  $("invoicePayment").value = paymentText(sale);
  $("invoiceVatRate").value = "10.5";
  $("invoiceSaleInfo").innerHTML = `
    <div>
      <strong>Venta ${escapeHtml(sale.saleNumber || "-")} - ${escapeHtml(sale.local || "-")}</strong>
      <span>${escapeHtml(saleItemsText(sale))}</span>
    </div>
    <strong>${money(sale.total, 2)}</strong>
  `;
  $("invoiceMessage").classList.add("hidden");
  $("invoiceMessage").textContent = "";
  $("confirmInvoice").disabled = false;
  $("confirmInvoice").textContent = "Confirmar factura";
  renderInvoiceTotals();
  $("invoiceDialog").showModal();
}

function invoicePayload(sale) {
  return {
    idempotencyKey: sale.id,
    saleId: sale.id,
    local: sale.local,
    invoiceType: "B",
    invoiceDate: new Date().toISOString().slice(0, 10),
    receiver: { taxCondition: "CONSUMIDOR_FINAL" },
    payment: {
      code: paymentCode(sale),
      cash: Number(sale.cash || 0),
      electronic: Number(sale.transfer || 0),
    },
    item: {
      description: "Producto de panaderia",
      quantity: 1,
      unit: "UNIDADES",
      vatRate: Number($("invoiceVatRate").value),
      finalPrice: Number(sale.total || 0),
    },
  };
}

function showInvoiceMessage(text, type = "error") {
  const message = $("invoiceMessage");
  message.textContent = text;
  message.className = `invoice-message ${type}`;
}

async function confirmInvoice() {
  const sale = currentSale();
  if (!sale || hasArcaReceipt(sale)) return;

  if (!ARCA_API_URL) {
    showInvoiceMessage("La pantalla ya esta lista. Falta conectar el servidor seguro de ARCA para emitir un CAE real; la venta continua como No facturada.");
    return;
  }

  const button = $("confirmInvoice");
  button.disabled = true;
  button.textContent = "Emitiendo...";
  showInvoiceMessage("Enviando el comprobante a ARCA. No cierres esta ventana.", "info");

  try {
    const response = await fetch(`${ARCA_API_URL}/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ARCA-Confirm": sale.id,
      },
      body: JSON.stringify(invoicePayload(sale)),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "ARCA rechazo el comprobante.");
    if (!result.cae || !result.invoiceNumber) throw new Error("ARCA no devolvio un CAE valido.");

    const updatedSale = upsertById("salesById", {
      ...sale,
      invoice: {
        status: result.status || (result.mode === "homologacion" ? "test_issued" : "issued"),
        mode: result.mode || "homologacion",
        fiscalValidity: result.mode !== "homologacion",
        invoiceType: "B",
        invoiceNumber: result.invoiceNumber,
        pointOfSale: result.pointOfSale || "",
        cae: result.cae,
        caeExpiration: result.caeExpiration || "",
        vatRate: Number($("invoiceVatRate").value),
        issuedAt: result.issuedAt || new Date().toISOString(),
        pdfUrl: result.pdfUrl || "",
        publicUrl: result.publicUrl || "",
      },
    });
    refreshSales();
    renderAll();
    $("invoiceDialog").close();
    showInvoiceResult(updatedSale);
  } catch (error) {
    showInvoiceMessage(error.message || "No se pudo emitir la factura.");
  } finally {
    button.disabled = false;
    button.textContent = "Confirmar factura";
  }
}

async function checkArcaConnection() {
  const banner = $("integrationBanner");
  try {
    const response = await fetch(`${ARCA_API_URL}/health`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error("Servidor no disponible");
    if (!result.credentialsReady) {
      banner.classList.add("error-banner");
      banner.innerHTML = "<strong>Facturador local sin certificado.</strong><span>Ejecuta el instalador y selecciona el certificado y la clave privada.</span>";
      return;
    }
    if (!result.enabled) {
      banner.classList.remove("error-banner");
      banner.classList.add("test-banner");
      banner.innerHTML = `<strong>Facturador local instalado - emision pausada</strong><span>${result.mode === "produccion" ? "Produccion" : "Homologacion"}, punto de venta ${escapeHtml(result.pointOfSale)}. Falta habilitarlo despues de la prueba final.</span>`;
      return;
    }
    banner.classList.remove("error-banner");
    banner.classList.toggle("test-banner", result.mode === "homologacion");
    banner.innerHTML = result.mode === "produccion"
      ? `<strong>Facturador local conectado - produccion</strong><span>Punto de venta ${escapeHtml(result.pointOfSale)}. Los comprobantes tendran validez fiscal.</span>`
      : `<strong>Facturador local conectado - homologacion</strong><span>Punto de venta ${escapeHtml(result.pointOfSale)}. Los comprobantes son pruebas sin validez fiscal.</span>`;
  } catch (error) {
    banner.classList.add("error-banner");
    banner.innerHTML = "<strong>El facturador local esta apagado.</strong><span>Abre Facturador ARCA desde el Escritorio de esta computadora. Ninguna venta sera marcada como facturada.</span>";
  }
}

document.querySelectorAll("[data-arca-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.arcaView));
});

$("arcaStoreSelect").addEventListener("change", renderAll);
$("invoiceStatusFilter").addEventListener("change", renderReports);
$("invoiceVatRate").addEventListener("change", renderInvoiceTotals);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-invoice-sale-id]");
  if (button) openInvoiceDialog(button.dataset.invoiceSaleId);
});

$("closeInvoiceDialog").addEventListener("click", () => $("invoiceDialog").close());
$("cancelInvoice").addEventListener("click", () => $("invoiceDialog").close());
$("invoiceForm").addEventListener("submit", (event) => {
  event.preventDefault();
  confirmInvoice();
});
$("closeInvoiceResult").addEventListener("click", () => $("invoiceResultDialog").close());
$("newInvoiceButton").addEventListener("click", () => $("invoiceResultDialog").close());

window.addEventListener("panaderia:store-changed", (event) => {
  if (event.detail?.name !== "salesById") return;
  refreshSales();
  renderAll();
});

window.addEventListener("panaderia:database-error", () => {
  $("integrationBanner").classList.add("error-banner");
  $("integrationBanner").innerHTML = "<strong>No se pudieron actualizar las ventas.</strong><span>Revisa la conexion a internet.</span>";
});

refreshSales();
renderAll();
showView(activeArcaView);
checkArcaConnection();

