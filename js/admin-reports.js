const { listByStore, listSales } = window.DB;

const DEFAULT_STORES = ["Central", "Cafeteria"];
const EXPENSES_VIEW = "__expenses__";
const STATISTICS_VIEW = "__statistics__";
const GENERAL_STATISTICS = "__all__";
const $ = (id) => document.getElementById(id);
const REPORT_TIME_ZONE = "America/Argentina/Buenos_Aires";

let expandedShiftId = "";

function dateKey(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", { timeZone: REPORT_TIME_ZONE });
}

function monthRange(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(reference);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function setDateRange(from, to) {
  $("reportDateFrom").value = from;
  $("reportDateTo").value = to;
}

function selectedDateRange() {
  return {
    from: $("reportDateFrom").value,
    to: $("reportDateTo").value,
  };
}

function isInSelectedRange(value) {
  const key = dateKey(value);
  const { from, to } = selectedDateRange();
  return !!key && (!from || key >= from) && (!to || key <= to);
}

function moveMonth(offset) {
  const current = $("reportDateFrom").value || monthRange().from;
  const [year, month] = current.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 15, 12));
  const range = monthRange(target);
  setDateRange(range.from, range.to);
  expandedShiftId = "";
  renderReports();
}

function periodText() {
  const { from, to } = selectedDateRange();
  if (!from && !to) return "Todo el historial";
  const format = (value) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  };
  if (from && from === to) return format(from);
  return `${from ? format(from) : "Inicio"} al ${to ? format(to) : "hoy"}`;
}

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

function shiftData(shift, providedSales = null) {
  const sales = providedSales || listSales({ shiftId: shift.id });
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
  select.innerHTML = [
    ...stores().map((store) => (
      `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`
    )),
    `<option value="${EXPENSES_VIEW}">Gastos</option>`,
    `<option value="${STATISTICS_VIEW}">Estadistica</option>`,
  ].join("");
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


function expenseDayKey(value) {
  if (!value) return "sin-fecha";
  return new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function expenseDayLabel(value) {
  if (!value) return "Sin fecha registrada";
  const text = new Date(value).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function expenseTime(value) {
  if (!value) return "Sin hora";
  return new Date(value).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function allExpenses() {
  return listByStore("shiftsById")
    .flatMap((shift) => (shift.expenses || []).map((expense) => ({
      ...expense,
      local: shift.local || "Local",
      shiftId: shift.id,
      date: expense.date || shift.openedAt,
    })))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function renderExpenseReport() {
  const expenses = allExpenses().filter((expense) => isInSelectedRange(expense.date));
  const grouped = new Map();

  expenses.forEach((expense) => {
    const key = expenseDayKey(expense.date);
    if (!grouped.has(key)) {
      grouped.set(key, { date: expense.date, expenses: [] });
    }
    grouped.get(key).expenses.push(expense);
  });

  const days = [...grouped.values()];
  $("reportTitle").textContent = "Gastos de caja";
  $("reportDescription").textContent = `Movimientos cargados desde Turnos, separados por dia. Periodo: ${periodText()}.`;

  $("reportSummary").innerHTML = `
    <article>
      <span>Total de gastos</span>
      <strong>${money(totalOf(expenses, "amount"))}</strong>
    </article>
    <article>
      <span>Movimientos</span>
      <strong>${expenses.length}</strong>
    </article>
    <article>
      <span>Dias con gastos</span>
      <strong>${days.length}</strong>
    </article>
  `;

  $("shiftReportList").innerHTML = days.length === 0
    ? `<div class="empty-report"><strong>No hay gastos cargados.</strong><span>Los gastos apareceran aca cuando se agreguen desde Turnos.</span></div>`
    : `<div class="expense-day-list">${days.map((day) => {
        const subtotal = totalOf(day.expenses, "amount");
        return `
          <article class="expense-day">
            <header class="expense-day-head">
              <div>
                <strong>${expenseDayLabel(day.date)}</strong>
                <span>${day.expenses.length} ${day.expenses.length === 1 ? "movimiento" : "movimientos"}</span>
              </div>
              <strong>${money(subtotal)}</strong>
            </header>
            <div class="expense-rows">
              ${day.expenses.map((expense) => `
                <div class="expense-row">
                  <time>${expenseTime(expense.date)}</time>
                  <span class="expense-local">${escapeHtml(expense.local)}</span>
                  <span class="expense-detail">${escapeHtml(expense.detail || "Sin detalle")}</span>
                  <strong>${money(expense.amount)}</strong>
                </div>
              `).join("")}
            </div>
          </article>
        `;
      }).join("")}</div>`;
}

function itemRevenue(item) {
  const storedTotal = Number(item.total);
  if (Number.isFinite(storedTotal)) return storedTotal;
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

function statisticsData() {
  const scope = $("statisticsStoreSelect").value;
  const sales = listSales(scope === GENERAL_STATISTICS ? {} : { local: scope })
    .filter((sale) => isInSelectedRange(sale.date));
  const products = new Map();
  const daily = new Map();

  sales.forEach((sale) => {
    const day = dateKey(sale.date);
    if (!daily.has(day)) {
      daily.set(day, {
        date: day,
        salesCount: 0,
        totalRevenue: 0,
        products: new Set(),
      });
    }
    const dailyRow = daily.get(day);
    dailyRow.salesCount += 1;
    dailyRow.totalRevenue += Number(sale.total || 0);

    (sale.items || []).forEach((item) => {
      const name = String(item.name || "Producto sin nombre").trim() || "Producto sin nombre";
      const key = item.productId || name.toLocaleLowerCase("es-AR");
      const current = products.get(key) || {
        productId: item.productId || "",
        name,
        weighable: !!item.weighable,
        quantity: 0,
        revenue: 0,
        saleIds: new Set(),
      };

      current.quantity += Number(item.quantity || 0);
      current.revenue += itemRevenue(item);
      current.saleIds.add(sale.id);
      products.set(key, current);
      dailyRow.products.add(key);
    });
  });

  const ranking = [...products.values()]
    .map((product) => ({
      productId: product.productId,
      name: product.name,
      weighable: product.weighable,
      quantity: product.quantity,
      revenue: Math.round(product.revenue),
      salesCount: product.saleIds.size,
    }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, 50)
    .map((product, index) => ({ rank: index + 1, ...product }));

  const dailyBreakdown = [...daily.values()]
    .map((row) => ({
      date: row.date,
      salesCount: row.salesCount,
      totalRevenue: Math.round(row.totalRevenue),
      differentProducts: row.products.size,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    scope,
    sales,
    ranking,
    dailyBreakdown,
    totalRevenue: totalOf(sales, "total"),
    differentProducts: products.size,
  };
}

function quantityText(product) {
  const value = Number(product.quantity || 0).toLocaleString("es-AR", {
    minimumFractionDigits: product.weighable ? 0 : 0,
    maximumFractionDigits: product.weighable ? 3 : 0,
  });
  return product.weighable ? `${value} kg` : `${value} un.`;
}

function statisticsScopeLabel(scope) {
  return scope === GENERAL_STATISTICS ? "General" : scope;
}

function renderStatisticsReport() {
  const data = statisticsData();
  const scopeLabel = statisticsScopeLabel(data.scope);

  $("reportTitle").textContent = `Estadistica de productos - ${scopeLabel}`;
  $("reportDescription").textContent = `Top 50 de productos y resumen por dia. Periodo: ${periodText()}.`;
  $("statisticsToolbar").hidden = false;

  $("reportSummary").innerHTML = `
    <article>
      <span>Ventas analizadas</span>
      <strong>${data.sales.length}</strong>
    </article>
    <article>
      <span>Total vendido</span>
      <strong>${money(data.totalRevenue)}</strong>
    </article>
    <article>
      <span>Productos diferentes</span>
      <strong>${data.differentProducts}</strong>
    </article>
  `;

  $("shiftReportList").innerHTML = data.ranking.length === 0
    ? `<div class="empty-report"><strong>No hay ventas para ${escapeHtml(scopeLabel)}.</strong><span>El ranking aparecera cuando existan ventas registradas.</span></div>`
    : `
      <div class="statistics-card">
        <div class="statistics-heading">
          <strong>Top 50 productos</strong>
          <span>Ordenado por cantidad vendida</span>
        </div>
        <div class="statistics-table-wrap">
          <table class="statistics-table">
            <thead>
              <tr>
                <th scope="col">Puesto</th>
                <th scope="col">Producto</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Ventas</th>
                <th scope="col">Facturado</th>
              </tr>
            </thead>
            <tbody>
              ${data.ranking.map((product) => `
                <tr>
                  <td><span class="statistics-rank">${product.rank}</span></td>
                  <td><strong>${escapeHtml(product.name)}</strong></td>
                  <td>${quantityText(product)}</td>
                  <td>${product.salesCount}</td>
                  <td><strong>${money(product.revenue)}</strong></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="statistics-card statistics-daily-card">
        <div class="statistics-heading">
          <strong>Resumen por dia</strong>
          <span>${periodText()}</span>
        </div>
        <div class="statistics-table-wrap">
          <table class="statistics-table statistics-daily-table">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Ventas</th>
                <th scope="col">Productos diferentes</th>
                <th scope="col">Facturado</th>
              </tr>
            </thead>
            <tbody>
              ${data.dailyBreakdown.map((day) => `
                <tr>
                  <td><strong>${escapeHtml(day.date.split("-").reverse().join("/"))}</strong></td>
                  <td>${day.salesCount}</td>
                  <td>${day.differentProducts}</td>
                  <td><strong>${money(day.totalRevenue)}</strong></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
}

function exportStatistics() {
  const data = statisticsData();
  const scopeLabel = statisticsScopeLabel(data.scope);
  const payload = {
    report: "Top de productos vendidos",
    generatedAt: new Date().toISOString(),
    scope: scopeLabel,
    period: selectedDateRange(),
    criteria: "Cantidad vendida",
    limit: 50,
    summary: {
      salesAnalyzed: data.sales.length,
      totalRevenue: data.totalRevenue,
      differentProducts: data.differentProducts,
    },
    dailyBreakdown: data.dailyBreakdown,
    topProducts: data.ranking.map((product) => ({
      rank: product.rank,
      productId: product.productId || null,
      name: product.name,
      quantity: Number(product.quantity.toFixed(3)),
      unit: product.weighable ? "kg" : "units",
      salesCount: product.salesCount,
      revenue: product.revenue,
    })),
  };
  const safeScope = scopeLabel.toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `estadistica-productos-${safeScope}-${day}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderReports() {
  const selectedStore = $("reportStoreSelect").value;

  $("statisticsToolbar").hidden = selectedStore !== STATISTICS_VIEW;

  if (selectedStore === EXPENSES_VIEW) {
    renderExpenseReport();
    return;
  }

  if (selectedStore === STATISTICS_VIEW) {
    renderStatisticsReport();
    return;
  }

  $("reportTitle").textContent = "Reporte de turnos";
  $("reportDescription").textContent = `Consulta como cerro cada turno. Periodo: ${periodText()}.`;

  const salesByShift = new Map();
  listSales({ local: selectedStore }).forEach((sale) => {
    if (!salesByShift.has(sale.shiftId)) salesByShift.set(sale.shiftId, []);
    salesByShift.get(sale.shiftId).push(sale);
  });

  const rows = listByStore("shiftsById")
    .filter((shift) => shift.local === selectedStore)
    .filter((shift) => isInSelectedRange(shift.openedAt))
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))
    .map((shift) => shiftData(shift, salesByShift.get(shift.id) || []));

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

$("statisticsStoreSelect").addEventListener("change", renderReports);

["reportDateFrom", "reportDateTo"].forEach((id) => {
  $(id).addEventListener("change", () => {
    expandedShiftId = "";
    renderReports();
  });
});

$("previousMonthButton").addEventListener("click", () => moveMonth(-1));
$("currentMonthButton").addEventListener("click", () => {
  const range = monthRange();
  setDateRange(range.from, range.to);
  expandedShiftId = "";
  renderReports();
});
$("nextMonthButton").addEventListener("click", () => moveMonth(1));
$("exportStatisticsButton").addEventListener("click", exportStatistics);

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

const initialRange = monthRange();
setDateRange(initialRange.from, initialRange.to);
refreshReports();
