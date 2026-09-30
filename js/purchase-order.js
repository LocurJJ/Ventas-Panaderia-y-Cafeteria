const { createId, listByStore, listProducts, listSales, saveProduct, suppliers, upsertById } = window.DB;
const { LOCALS, label, localOf, remaining, weeklySales } = window.Purchases;
const $ = id => document.getElementById(id);
const PAGE_SIZE = 20;
let selectedLocal = new URLSearchParams(location.search).get("local");
if (!LOCALS.includes(selectedLocal)) selectedLocal = "";
let generalProducts = [], catalogSearch = "", catalogPage = 1, isSavingCatalog = false;
const draftsByLocal = Object.fromEntries(LOCALS.map(local => [local, new Map()]));
function drafts() { return draftsByLocal[selectedLocal]; }
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

function canonicalSupplier(value) {
  const aliases = {
    "banylac": "Banylac",
    "baqueano": "Baqueano",
    "cafeteria esmeralda": "Cafeteria Esmeralda",
    "chipa": "Chipá",
    "coca cola": "Coca-Cola",
    "coca-cola": "Coca-Cola",
    "cookies": "cookies",
    "costo zero": "Costo Zero",
    "de quesos (leo)": "De quesos (Leo)",
    "don angel": "Don angel",
    "golosinas": "Golosinas",
    "grupo max": "Grupo max",
    "oscar": "Oscar",
    "otro": "Otros",
    "otros": "Otros",
    "pan de miga": "Pan de miga",
    "pastas": "Pastas",
    "serenisima": "Serenisima",
    "tapas": "Tapas",
    "elaboracion propia": "Elaboracion propia",
  };
  return aliases[normalized(value)] || String(value || "Otros").trim();
}

function isOwnSupplier(value) {
  return canonicalSupplier(value) === "Elaboracion propia";
}


function activeOrders() {
  return listByStore("purchaseOrdersById").filter(order =>
    (order.items || []).some(item => localOf(order,item) === selectedLocal && remaining(item) > 0));
}
function pendingEntryForProduct(productId) {
  for (const order of activeOrders()) {
    const item = order.items.find(item => item.productId === productId && localOf(order,item) === selectedLocal && remaining(item) > 0);
    if (item) return {order,item};
  }
  return null;
}
function buildCatalog() {
  const products = listProducts();
  const weekly = weeklySales(listSales(), products, selectedLocal);
  generalProducts = products.map(product => ({product,weeklySales:weekly.get(product.id) || 0}));
}
function stateFor(row) {
  const draft = drafts().get(row.product.id) || {};
  return { packQuantity: Number(draft.packQuantity ?? row.product.packQuantity ?? 1),
    supplier: canonicalSupplier(draft.supplier ?? row.product.supplier),
    stock: Number(draft.stock ?? window.DB.productStock(row.product, selectedLocal)),
    orderPacks: draft.orderPacks };
}
function suggestedPacks(row,state) {
  return isOwnSupplier(state.supplier) ? 0 : Math.ceil(Math.max(0,row.weeklySales-state.stock)/Math.max(0.001,state.packQuantity));
}
function supplierOptions(selected) {
  return Array.from(new Set([...suppliers,selected,...generalProducts.map(row=>row.product.supplier)].map(canonicalSupplier)))
    .map(supplier=>`<option value="${escapeHtml(supplier)}"${supplier===selected?" selected":""}>${escapeHtml(supplier)}</option>`).join("");
}
function rowHtml(row) {
  const p=row.product, state=stateFor(row), unit=p.weighable?"kg":"un.", pending=pendingEntryForProduct(p.id);
  const suggestion=suggestedPacks(row,state);
  let control='<span class="no-purchase">Elaboración propia</span>';
  if(pending) control=`<div class="row-order-control pending-control"><span>Pedido: ${numberText(remaining(pending.item))} packs pendientes</span><button type="button" class="row-order-button pending" data-order-action="remove">Quitar pendiente</button></div>`;
  else if(!isOwnSupplier(state.supplier)) control=`<div class="row-order-control"><label class="order-quantity"><span class="suggestion-hint">Sugerido: ${suggestion} packs</span><input type="number" min="1" step="1" value="${state.orderPacks ?? ""}" placeholder="${suggestion}" data-field="orderPacks" aria-label="Packs de ${escapeHtml(p.name)}"></label><button type="button" class="row-order-button order" data-order-action="add">Ordenar</button></div>`;
  return `<tr data-product-id="${escapeHtml(p.id)}">
    <td><strong>${escapeHtml(p.name)}</strong></td>
    <td><label class="compact-field"><span class="sr-only">Cantidad por pack</span><input type="number" min="0.001" step="0.001" value="${state.packQuantity}" data-field="packQuantity"></label></td>
    <td><label class="compact-field"><span class="sr-only">Mayorista</span><select data-field="supplier">${supplierOptions(state.supplier)}</select></label></td>
    <td>${numberText(row.weeklySales)} ${unit}</td>
    <td><label class="stock-field"><span class="sr-only">Stock ${label(selectedLocal)}</span><input type="number" step="0.001" value="${state.stock}" data-field="stock"><small>${unit} en ${label(selectedLocal)}</small></label></td>
    <td>${control}</td></tr>`;
}
function matchingRows() {
  return generalProducts.filter(({product:p}) => normalized(`${p.name} ${p.barcode || ""} ${p.supplier || ""}`).includes(catalogSearch));
}
function renderSaveStatus() {
  const count=Array.from(drafts().values()).filter(d=>["stock","supplier","packQuantity"].some(key=>Object.hasOwn(d,key))).length;
  $("catalogSaveStatus").textContent=count?`${count} productos con cambios sin guardar.`:`Stock de ${label(selectedLocal)}. El proveedor y el tamaño del pack son compartidos entre los locales.`;
  $("saveCatalogButton").disabled=isSavingCatalog || !count;
}
function renderCatalog() {
  document.querySelectorAll('[data-order-local]').forEach(button=>{
    const active=button.dataset.orderLocal===selectedLocal;
    button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
  });
  $("orderWorkspace").classList.toggle("hidden",!selectedLocal);
  $("chooseLocalNotice").classList.toggle("hidden",!!selectedLocal);
  if(!selectedLocal)return;
  buildCatalog();
  const matching=matchingRows(),pages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
  catalogPage=Math.max(1,Math.min(catalogPage,pages));
  $("catalogTitle").textContent=`Pedido de ${label(selectedLocal)}`;
  $("catalogDescription").textContent=`Todos los productos. Sugerencias según las ventas de los últimos 7 días y el stock de ${label(selectedLocal)}.`;
  $("stockColumnTitle").textContent=`Stock ${label(selectedLocal)}`;
  $("suggestionRows").innerHTML=matching.slice((catalogPage-1)*PAGE_SIZE,catalogPage*PAGE_SIZE).map(rowHtml).join("");
  $("suggestionEmpty").classList.toggle("hidden",matching.length>0);
  $("suggestionEmptyText").textContent=catalogSearch?"Probá otro nombre, código o mayorista.":"No hay productos cargados.";
  $("catalogPageInput").value=catalogPage;$("catalogPageInput").max=pages;$("catalogTotalPages").textContent=pages;
  $("previousCatalogPage").disabled=catalogPage===1;$("nextCatalogPage").disabled=catalogPage===pages;
  const entries=window.Purchases.entries(listByStore("purchaseOrdersById"),selectedLocal);
  $("orderSummary").innerHTML=`<article><span>Local</span><strong>${label(selectedLocal)}</strong><small>Stock y ventas propios</small></article><article><span>Productos</span><strong>${generalProducts.length}</strong><small>Catálogo completo</small></article><article><span>Pendientes</span><strong>${entries.length}</strong><small>Productos por comprar</small></article>`;
  $("activeOrderList").innerHTML=entries.length
    ? `<a class="active-order-card" href="lista-compra.html?local=${selectedLocal}"><div><strong>Ver pedido de ${label(selectedLocal)}</strong><span>${entries.length} productos · ${numberText(entries.reduce((sum,e)=>sum+remaining(e.item),0))} packs pendientes</span></div><span class="order-arrow">›</span></a>`
    : '<p class="muted">Todavía no hay productos pendientes para este local.</p>';
  $("legacyOrderNotice").classList.toggle("hidden",!entries.some(e=>!e.order.local&&!e.item.local));
  renderSaveStatus();
}
function updateDraft(event) {
  const field=event.target.dataset.field,rowElement=event.target.closest('[data-product-id]');
  if(!field||!rowElement||!selectedLocal)return;
  const id=rowElement.dataset.productId;
  if(!drafts().has(id))drafts().set(id,{});
  const draft=drafts().get(id),row=generalProducts.find(row=>row.product.id===id);
  if(field==='stock'&&!Object.hasOwn(draft,'stockBaseline'))draft.stockBaseline=window.DB.productStock(row.product,selectedLocal);
  draft[field]=field==='supplier'?event.target.value:(event.target.value===''&&field==='orderPacks'?undefined:Number(event.target.value));
  const hint=rowElement.querySelector('.suggestion-hint');
  if(hint)hint.textContent=`Sugerido: ${suggestedPacks(row,stateFor(row))} packs`;
  renderSaveStatus();
}
async function saveCatalogChanges(showMessage) {
  if(isSavingCatalog)return false;
  isSavingCatalog=true;renderSaveStatus();
  const local=selectedLocal, currentDrafts=drafts();
  try {
    for(const [id,draft] of currentDrafts) {
      const product=listProducts().find(p=>p.id===id);if(!product)continue;
      if(Object.hasOwn(draft,'packQuantity')&&(!Number.isFinite(draft.packQuantity)||draft.packQuantity<=0))throw Error('La cantidad por pack debe ser mayor que cero.');
      if(Object.hasOwn(draft,'supplier')||Object.hasOwn(draft,'packQuantity')) {
        saveProduct({...product,supplier:draft.supplier??product.supplier,packQuantity:draft.packQuantity??product.packQuantity});
        await window.DB.flushWrites();delete draft.supplier;delete draft.packQuantity;
      }
      if(Object.hasOwn(draft,'stock')) {
        try {
          window.DB.setProductStock(id,draft.stock,local,{expected:draft.stockBaseline,reason:'Conteo desde pedido de '+label(local)});
          await window.DB.flushWrites();
        } finally { delete draft.stock;delete draft.stockBaseline; }
      }
    }
    if(showMessage)alert('Cambios guardados.');
    return true;
  } catch(error) {alert(error.message);return false;}
  finally {isSavingCatalog=false;renderCatalog();}
}
let ordering=false;
async function orderProduct(productId) {
  if(ordering)return;ordering=true;
  try {
    if(!await saveCatalogChanges(false))return;
    buildCatalog();
    const row=generalProducts.find(row=>row.product.id===productId);
    if(!row||pendingEntryForProduct(productId))return;
    const state=stateFor(row),packs=state.orderPacks??suggestedPacks(row,state);
    if(isOwnSupplier(state.supplier))return;
    if(!Number.isSafeInteger(packs)||packs<1)throw Error('Ingresá una cantidad entera de packs mayor que cero.');
    const item={id:createId('purchase_item'),local:selectedLocal,productId,name:row.product.name,
      supplier:canonicalSupplier(state.supplier),weighable:!!row.product.weighable,packQuantity:state.packQuantity,
      suggestedPacks:suggestedPacks(row,state),orderedPacks:packs,weeklySales:row.weeklySales,stockAtCreation:state.stock,receivedAt:null};
    // Independent request IDs prevent one store from overwriting another store's order.
    upsertById('purchaseOrdersById',{id:createId('purchase_order'),local:selectedLocal,createdAt:new Date().toISOString(),status:'active',items:[item]});
    await window.DB.flushWrites();drafts().delete(productId);
  } catch(error) {alert(error.message);}
  finally {ordering=false;renderCatalog();}
}
async function removePendingProduct(productId) {
  const pending=pendingEntryForProduct(productId);if(!pending)return;
  if(!confirm(`¿Quitar lo pendiente de ${pending.item.name} para ${label(selectedLocal)}?`))return;
  try {
    window.DB.updatePurchaseOrder(pending.order.id,current=>{
      if(!current)return;
      return {...current,items:(current.items||[]).map(item=>item.id===pending.item.id?{...item,cancelledAt:new Date().toISOString()}:item)};
    });
    await window.DB.flushWrites();
  } catch(error){alert(error.message);}
  renderCatalog();
}
document.querySelectorAll('[data-order-local]').forEach(button=>button.addEventListener('click',()=>{
  if(isSavingCatalog||ordering)return;
  selectedLocal=button.dataset.orderLocal;catalogSearch='';catalogPage=1;$("catalogSearchInput").value='';
  history.replaceState(null,'','?local='+selectedLocal);renderCatalog();
}));
$("suggestionRows").addEventListener('input',updateDraft);
$("suggestionRows").addEventListener('change',updateDraft);
$("suggestionRows").addEventListener('click',event=>{const button=event.target.closest('[data-order-action]'),row=event.target.closest('[data-product-id]');if(!button||!row)return;if(button.dataset.orderAction==='add')orderProduct(row.dataset.productId);else removePendingProduct(row.dataset.productId);});
$("catalogSearchInput").addEventListener('input',event=>{catalogSearch=normalized(event.target.value);catalogPage=1;renderCatalog();});
$("catalogPageInput").addEventListener('change',event=>{catalogPage=Number(event.target.value)||1;renderCatalog();});
$("previousCatalogPage").addEventListener('click',()=>{catalogPage--;renderCatalog();});
$("nextCatalogPage").addEventListener('click',()=>{catalogPage++;renderCatalog();});
$("refreshSuggestionsButton").addEventListener('click',renderCatalog);
$("saveCatalogButton").addEventListener('click',()=>saveCatalogChanges(true));
window.addEventListener('panaderia:store-changed',event=>{if(['productsById','salesById','purchaseOrdersById'].includes(event.detail?.name)&&!isSavingCatalog&&!ordering)renderCatalog();});
window.addEventListener('panaderia:database-error',()=>alert('No se pudo confirmar el guardado. Revisá la conexión antes de continuar.'));
renderCatalog();
