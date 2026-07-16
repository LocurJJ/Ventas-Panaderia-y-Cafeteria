const { listByStore, listSales } = window.DB;

const DEFAULT_STORES = ["Central", "Cafeteria"];
const $ = (id) => document.getElementById(id);

let expandedShiftId = "";

function money(value) {
  return `$ ${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
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
  if (!value) return "Sin registrar";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function totalOf(items, field) {
  return (items || []).reduce((sum, item) => sum + Number(item[field] || 0), 0);
}

function shiftData(shift) {
  const sales = listSales({ shiftId: shift.id });
  const sold = totalOf(sales, "total");
  const cash = sales.reduce((sum, sale) => (
    sum + Number(sale.cash || 0) - Number(sale.change || 0)
  ), 0);
  const digital = totalOf(sales, "transfer");
  const expenses = totalOf(shift.expenses, "amount");
  const reinforcements = totalOf(shift.reinforcements, "amount");
  const theoreticalCash = Number(shift.initialCash || 0) + cash + reinforcements - expenses;
  const hasActualCash = shift.actualCash !== undefined && shift.actualCash !== null && shift.actualCash !== "";
  const actualCash = hasActualCash ? Number(shift.actualCash || 0) : null;

  return {
    shift,
    sales,
    sold,
    cash,
    digital,
    expenses,
    reinforcements,
    theoreticalCash,
    actualCash,
    difference: actualCash === null ? null : actualCash - theoreticalCash,
  };
}

function stores() {
  const stored = listByStore("shiftsById").map((shift) => shift.local).filter(Boolean);
  const extraStores = [...new Set(stored)]
    .filter((store) => !DEFAULT_STORES.includes(store))
    .sort((a, b) => a.localeCompare(b));
  return [...DEFAULT_STORES, ...extraStores];
}

function fillStoreSelect() {
  const select = $("reportStoreSelect");
  const previous = select.value;
  select.innerHTML = stores().map((store) => (
    `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`
  )).join("");
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function saleDescription(sale) {
  const items = (sale.items || []).map((item) => {
    const quantity = item.weighable
      ? `${Number(item.quantity || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg`
      : `${Number(item.quantity || 0)} x`;
    return `${quantity} ${item.name || "Producto"}`;
  });
  return items.length > 0 ? items.join(", ") : (sale.client || "Sin detalle");
}

function paymentText(sale) {
  if (Number(sale.cash || 0) > 0 && Number(sale.transfer || 0) > 0) return "Mixto";
  if (Number(sale.transfer || 0) > 0) return "Transferencia";
  return "Efectivo";
}

function metricRow(label, value, className = "") {
  return `
    <div class="report-metric ${className}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderDetail(data) {
  const { shift, sales } = data;
  const salesDetail = sales.length === 0
    ? `<p class="muted">Este turno no tiene ventas registradas.</p>`
    : `<ul class="report-sale-list">${sales.map((sale) => `
        <li>
          <span>Venta ${escapeHtml(sale.saleNumber || "-")}: ${escapeHtml(saleDescription(sale))}</span>
          <strong>${money(sale.total)} - ${paymentText(sale)}</strong>
        </li>
      `).join("")}</ul>`;

  return `
    <div class="shift-report-detail">
      <p class="report-dates">
        <span><b>Fecha:</b> ${dateText(shift.openedAt)}</span>
        <span><b>Cierre:</b> ${shift.closedAt ? dateText(shift.closedAt) : "Turno abierto"}</span>
      </p>
      <div class="report-metrics">
        ${metricRow("Efectivo inicial", money(shift.initialCash))}
        ${metricRow("Total vendido", money(data.sold))}
        ${metricRow("Ventas en efectivo", money(data.cash))}
        ${metricRow("Ventas digitales", money(data.digital))}
        ${metricRow("Gastos", money(data.expenses))}
        ${metricRow("Refuerzos", money(data.reinforcements))}
        ${metricRow("Cierre de caja teorico", money(data.theoreticalCash))}
        ${metricRow("Cerro realmente con", data.actualCash === null ? "Pendiente" : money(data.actualCash))}
        ${metricRow(
          "Diferencia",
          data.difference === null ? "Pendiente" : money(data.difference),
          data.difference > 0 ? "positive" : data.difference < 0 ? "negative" : ""
        )}
      </div>
      <div class="report-detail-heading">Detalle de ventas</div>
      ${salesDetail}
    </div>
  `;
}

function renderSummary(rows) {
  const closedRows = rows.filter((data) => data.shift.closedAt);
  $("reportSummary").innerHTML = `
    <article>
      <span>Turnos</span>
      <strong>${rows.length}</strong>
    </article>
    <article>
      <span>Total vendido</span>
      <strong>${money(rows.reduce((sum, data) => sum + data.sold, 0))}</strong>
    </article>
    <article>
      <span>Diferencia acumulada</span>
      <strong>${money(closedRows.reduce((sum, data) => sum + Number(data.difference || 0), 0))}</strong>
    </article>
  `;
}

function renderReports() {
  const selectedStore = $("reportStoreSelect").value;
  const rows = listByStore("shiftsById")
    .filter((shift) => shift.local === selectedStore)
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))
    .map(shiftData);

  renderSummary(rows);
  $("shiftReportList").innerHTML = rows.length === 0
    ? `<div class="empty-report"><strong>No hay turnos para ${escapeHtml(selectedStore)}.</strong><span>Los turnos apareceran aca cuando se abran desde Ventas.</span></div>`
    : rows.map((data) => {
      const { shift, sales, sold } = data;
      const expanded = shift.id === expandedShiftId;
      return `
        <article class="shift-report ${expanded ? "expanded" : ""}">
          <button class="shift-report-head" type="button" data-shift-id="${escapeHtml(shift.id)}" aria-expanded="${expanded}">
            <div>
              <strong>${escapeHtml(shift.local || "Local")}</strong>
              <span>${dateText(shift.openedAt)} - ${shift.closedAt ? `Hasta ${dateText(shift.closedAt)}` : "Turno abierto"} - ${sales.length} ventas</span>
            </div>
            <div class="shift-report-total">
              <strong>${money(sold)}</strong>
              <span class="expand-icon">${expanded ? "âˆ’" : ">"}</span>
            </div>
          </button>
          ${expanded ? renderDetail(data) : ""}
        </article>
      `;
    }).join("");
}

function refreshReports() {
  fillStoreSelect();
  renderReports();
}

$("reportStoreSelect").addEventListener("change", () => {
  expandedShiftId = "";
  renderReports();
});

$("shiftReportList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-shift-id]");
  if (!button) return;
  expandedShiftId = expandedShiftId === button.dataset.shiftId ? "" : button.dataset.shiftId;
  renderReports();
});

window.addEventListener("panaderia:store-changed", (event) => {
  if (["shiftsById", "salesById"].includes(event.detail?.name)) refreshReports();
});

window.addEventListener("panaderia:database-error", () => {
  $("shiftReportList").innerHTML = `<p class="error">No se pudieron actualizar los reportes. Revisa la conexion.</p>`;
});

refreshReports();
