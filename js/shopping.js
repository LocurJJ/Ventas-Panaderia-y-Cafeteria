const { listByStore, listProducts } = window.DB;
const { LOCALS, label, remaining, localOf, entries, aggregate } = window.Purchases;
const $ = id => document.getElementById(id);
let selectedLocal = new URLSearchParams(location.search).get('local') || 'General';
if(!['General',...LOCALS].includes(selectedLocal))selectedLocal='General';
let selectedGroupKey='', receiving=null, confirmingReceipt=false;
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

function normalizedSupplier(value) {
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
  return aliases[normalizedSupplier(value)] || String(value || "Otros").trim();
}



function supplierGroups() {
  const grouped=new Map();
  entries(listByStore('purchaseOrdersById'),selectedLocal).forEach(entry=>{
    const supplier=canonicalSupplier(entry.item.supplier),key=normalizedSupplier(supplier);
    if(!grouped.has(key))grouped.set(key,{key,supplier,entries:[]});
    grouped.get(key).entries.push(entry);
  });
  return Array.from(grouped.values()).map(group=>({...group,rows:aggregate(group.entries)}))
    .sort((a,b)=>a.supplier.localeCompare(b.supplier,'es-AR'));
}
function selectedGroup() { return supplierGroups().find(group=>group.key===selectedGroupKey); }
function breakdown(row) {
  return LOCALS.filter(local=>row.byLocal[local]>0).map(local=>`${label(local)}: ${numberText(row.byLocal[local])}`).join(' · ');
}
function purchaseLine(row) {
  return `- ${row.name}: ${numberText(row.packs)} packs (${numberText(row.packQuantity)} ${row.weighable?'kg':'un.'} por pack)`;
}
function buildPurchaseMessage() {
  const group=selectedGroup();if(!group)return '';
  const lines=[`Pedido a ${group.supplier}`];
  for(const local of LOCALS) {
    const ownEntries=group.entries.filter(entry=>entry.local===local);
    if(!ownEntries.length)continue;
    lines.push('',`${label(local)} pidió:`);
    aggregate(ownEntries).forEach(row=>{
      lines.push(purchaseLine(row));
      if(row.entries.some(entry=>entry.item.unavailableAt))lines.push('  No se consiguió todavía: '+numberText(row.entries.filter(e=>e.item.unavailableAt).reduce((n,e)=>n+remaining(e.item),0))+' packs.');
    });
  }
  if(selectedLocal==='General') {
    lines.push('','Total a comprar:');group.rows.forEach(row=>lines.push(purchaseLine(row)));
  }
  return lines.join('\n');
}
async function copyPurchaseMessage() {
  const message=buildPurchaseMessage();if(!message)return;
  try {await navigator.clipboard.writeText(message);}
  catch(error) {
    $('purchaseMessage').focus();$('purchaseMessage').select();
    if(!document.execCommand('copy')) {alert('Seleccioná el texto y copialo para pegarlo en WhatsApp.');return;}
  }
  const button=$('copyPurchaseMessageButton');button.textContent='Copiado';
  setTimeout(()=>{button.textContent='Copiar para WhatsApp';},1500);
}
function render() {
  const groups=supplierGroups();
  if(!groups.some(group=>group.key===selectedGroupKey))selectedGroupKey=groups[0]?.key||'';
  document.querySelectorAll('[data-shopping-local]').forEach(button=>{
    const active=button.dataset.shoppingLocal===selectedLocal;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  const count=groups.reduce((n,group)=>n+group.rows.length,0),packs=groups.reduce((n,group)=>n+group.rows.reduce((sum,row)=>sum+row.packs,0),0);
  $('pendingBadge').textContent=count;
  $('shoppingStatus').innerHTML=`<article><strong>${label(selectedLocal)}</strong><span>${selectedLocal==='General'?'Todos los locales':'Pedido del local'}</span></article><article><strong>${numberText(packs)}</strong><span>packs pendientes · ${groups.length} mayoristas</span></article>`;
  $('supplierChatList').innerHTML=groups.length?groups.map(group=>`<button class="supplier-chat${group.key===selectedGroupKey?' active':''}" type="button" data-group-key="${escapeHtml(group.key)}"><span class="supplier-avatar">${escapeHtml(group.supplier.charAt(0).toUpperCase())}</span><span class="supplier-chat-copy"><strong>${escapeHtml(group.supplier)}</strong><small>${group.rows.length} productos pendientes</small><span>${numberText(group.rows.reduce((n,row)=>n+row.packs,0))} packs</span></span><span class="notification-badge">${group.rows.length}</span></button>`).join(''):'<div class="empty-purchase compact-empty"><strong>Sin pedidos pendientes</strong><span>No hay compras para esta vista.</span></div>';
  const group=groups.find(group=>group.key===selectedGroupKey);
  $('supplierDetail').innerHTML=group?`<header class="supplier-detail-head"><div><p class="eyebrow">Mayorista · ${label(selectedLocal)}</p><h2>${escapeHtml(group.supplier)}</h2><span>${group.rows.length} productos por conseguir</span></div></header><div class="shopping-item-list">${group.rows.map((row,index)=>{
    const unavailable=row.entries.every(entry=>entry.item.unavailableAt);
    return `<div class="purchase-row"><button class="shopping-item" type="button" data-receive-row="${index}"><span class="item-check">${unavailable?'×':''}</span><span class="shopping-item-copy"><strong>${escapeHtml(row.name)}</strong><span>Total a comprar: ${numberText(row.packs)} packs · ${numberText(row.packQuantity)} ${row.weighable?'kg':'un.'} por pack</span><small>${breakdown(row)}</small><small>${unavailable?'No se consiguió. Tocá para confirmar si ahora está disponible.':'Tocá para confirmar lo recibido por cada local.'}</small></span></button><button class="unavailable-button" type="button" data-unavailable-row="${index}">${unavailable?'Volver a pendiente':'× No se consiguió'}</button></div>`;
  }).join('')}</div>`:'<div class="empty-purchase"><strong>No hay compras pendientes.</strong><span>Los pedidos de cada local aparecerán acá.</span></div>';
  $('purchaseMessageTitle').textContent=group?`${selectedLocal==='General'?'Pedidos por local':label(selectedLocal)+' pidió'} · ${group.supplier}`:'Mensaje para WhatsApp';
  $('purchaseMessage').value=buildPurchaseMessage();$('copyPurchaseMessageButton').disabled=!group;
  $('shoppingLegacyNotice').classList.toggle('hidden',!group?.entries.some(entry=>!entry.order.local&&!entry.item.local));
}
function findEntry(orderId,itemId) {
  const order=listByStore('purchaseOrdersById').find(order=>order.id===orderId);
  const item=order?.items?.find(item=>item.id===itemId);
  return item?{order,item,local:localOf(order,item)}:null;
}
function openReceiveDialog(index) {
  const row=selectedGroup()?.rows[index];if(!row)return;
  receiving={...row,plan:null};
  $('receiveProductName').textContent=row.name;
  $('receiveProductInfo').textContent=`${numberText(row.packs)} packs pendientes · ${numberText(row.packQuantity)} ${row.weighable?'kg':'unidades'} por pack`;
  $('receiveAllocations').innerHTML=row.entries.map((entry,index)=>`<label>Packs para ${label(entry.local)} <small>(${numberText(remaining(entry.item))} pendientes)</small><input type="number" data-receive-index="${index}" min="0" max="${remaining(entry.item)}" step="1" value="${remaining(entry.item)}" required inputmode="numeric"></label>`).join('');
  $('confirmReceiveButton').disabled=false;updateStockPreview();$('receiveDialog').showModal();
}
function updateStockPreview() {
  if(!receiving)return;
  const totals={Central:0,Sucursal:0,Cafeteria:0};
  document.querySelectorAll('[data-receive-index]').forEach(input=>{const entry=receiving.entries[Number(input.dataset.receiveIndex)];totals[entry.local]+=Number(input.value||0)*receiving.packQuantity;});
  $('stockPreview').textContent=LOCALS.filter(local=>totals[local]>0).map(local=>`${label(local)}: +${numberText(totals[local])} ${receiving.weighable?'kg':'unidades'}`).join(' · ') || 'Poné 0 para dejar un local pendiente. Se suma únicamente lo recibido.';
}
async function confirmReceived() {
  if(!receiving||confirmingReceipt)return;
  try {
    if(!receiving.plan) {
      const plan=Array.from(document.querySelectorAll('[data-receive-index]')).map(input=>{
        const entry=receiving.entries[Number(input.dataset.receiveIndex)],packs=Number(input.value||0);
        if(!Number.isSafeInteger(packs)||packs<0||packs>remaining(entry.item))throw Error('Revisá los packs: deben ser enteros, entre 0 y lo pendiente.');
        return {...entry,packs,before:Number(entry.item.receivedPacks||0),operationId:`purchase_${entry.order.id}_${entry.item.id}_${Number(entry.item.receivedPacks||0)}`};
      }).filter(entry=>entry.packs>0);
      if(!plan.length)throw Error('Ingresá al menos un pack recibido. Los demás pueden quedar en 0.');
      receiving.plan=plan;
    }
    confirmingReceipt=true;$('confirmReceiveButton').disabled=true;
    document.querySelectorAll('[data-receive-index]').forEach(input=>{input.disabled=true;});
    for(const entry of receiving.plan) {
      const latest=findEntry(entry.order.id,entry.item.id);
      if(!latest||latest.item.cancelledAt)throw Error('El pedido fue quitado. Cerrá y revisá la lista.');
      if(latest.item.receipts?.[entry.operationId])continue;
      if(Number(latest.item.receivedPacks||0)!==entry.before)throw Error('Otra computadora recibió este pedido. Cerrá y revisá las cantidades pendientes.');
      const product=listProducts().find(p=>p.id===entry.item.productId);
      if(!product)throw Error('El producto ya no está en el catálogo. Revisá el pedido.');
      const units=Number((entry.packs*Number(entry.item.packQuantity||1)).toFixed(3));
      window.DB.adjustProductStock(product.id,units,entry.local,{id:entry.operationId,reason:'Compra para '+label(entry.local)});
      await window.DB.flushWrites();
      window.DB.updatePurchaseOrder(entry.order.id,current=>{
        if(!current)return;
        const found=current.items.find(item=>item.id===entry.item.id);
        if(!found||found.cancelledAt)return;
        if(found.receipts?.[entry.operationId])return current;
        if(Number(found.receivedPacks||0)!==entry.before)return;
        const date=new Date().toISOString(),receivedPacks=entry.before+entry.packs;
        const items=current.items.map(item=>item.id!==entry.item.id?item:{...item,local:entry.local,
          receivedLocal:entry.local,receivedPacks,receivedUnits:Number((receivedPacks*Number(item.packQuantity||1)).toFixed(3)),
          receivedAt:receivedPacks>=Number(item.orderedPacks)?date:null,unavailableAt:null,
          receipts:{...(item.receipts||{}),[entry.operationId]:{packs:entry.packs,local:entry.local,date}}});
        const complete=items.every(item=>remaining(item)===0);
        return {...current,items,status:complete?'completed':'active',completedAt:complete?date:null};
      });
      await window.DB.flushWrites();
    }
    $('receiveDialog').close();receiving=null;render();
  } catch(error) {alert(error.message+' Si el guardado falló, reintentá sin cambiar las cantidades.');}
  finally {confirmingReceipt=false;$('confirmReceiveButton').disabled=false;}
}
async function markUnavailable(index) {
  const row=selectedGroup()?.rows[index];if(!row)return;
  const unavailable=row.entries.every(entry=>entry.item.unavailableAt), date=unavailable?null:new Date().toISOString();
  try {
    for(const entry of row.entries) {
      window.DB.updatePurchaseOrder(entry.order.id,current=>current?{...current,items:current.items.map(item=>item.id===entry.item.id&&remaining(item)>0?{...item,unavailableAt:date}:item)}:undefined);
      await window.DB.flushWrites();
    }
  }catch(error){alert(error.message);}
  render();
}
document.querySelectorAll('[data-shopping-local]').forEach(button=>button.addEventListener('click',()=>{
  selectedLocal=button.dataset.shoppingLocal;history.replaceState(null,'','?local='+selectedLocal);render();
}));
$('supplierChatList').addEventListener('click',event=>{const button=event.target.closest('[data-group-key]');if(!button)return;selectedGroupKey=button.dataset.groupKey;render();if(window.innerWidth<780)$('supplierDetail').scrollIntoView({behavior:'smooth',block:'start'});});
$('supplierDetail').addEventListener('click',event=>{const receive=event.target.closest('[data-receive-row]'),unavailable=event.target.closest('[data-unavailable-row]');if(receive)openReceiveDialog(Number(receive.dataset.receiveRow));if(unavailable)markUnavailable(Number(unavailable.dataset.unavailableRow));});
$('copyPurchaseMessageButton').addEventListener('click',copyPurchaseMessage);
$('receiveAllocations').addEventListener('input',updateStockPreview);
$('cancelReceiveButton').addEventListener('click',()=>{if(confirmingReceipt)return;$('receiveDialog').close();receiving=null;});
$('receiveDialog').addEventListener('cancel',event=>{if(confirmingReceipt)event.preventDefault();else receiving=null;});
$('receiveForm').addEventListener('submit',event=>{event.preventDefault();confirmReceived();});
window.addEventListener('panaderia:store-changed',event=>{if(['purchaseOrdersById','productsById'].includes(event.detail?.name))render();});
render();
