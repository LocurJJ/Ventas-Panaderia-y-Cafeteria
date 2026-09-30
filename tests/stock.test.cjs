const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../js/db.js'), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
const product = {id:'p', name:'Pan', stock:45, salePrice:100, cost:50, weighable:true};
function backend(initial = product) {
  const state = {productsById:{p:copy(initial)}};
  let denied = false;
  function ref(store, id) {
    return {
      child(key) { return ref(store,key); },
      on(_event, cb) { cb({val:()=>copy(state[store] || {})}); },
      set(value) { if (id) state[store][id]=copy(value); else state[store]=copy(value); return Promise.resolve(); },
      transaction(fn) { return new Promise((resolve,reject) => setImmediate(() => {
        try {
          if (denied) throw new Error('PERMISSION_DENIED');
          const next = fn(copy(state[store][id] || null));
          if (next !== undefined) state[store][id]=copy(next);
          resolve({committed:next!==undefined,snapshot:{val:()=>copy(state[store][id] || null)}});
        } catch (e) { reject(e); }
      })); }
    };
  }
  return {state, db:{ref: p=>ref(p.split('/')[1])}, deny(){denied=true;}};
}
function client(server) {
  const local = new Map();
  const window = {panaderiaFirebaseDb:server?.db, dispatchEvent(){}};
  const context = {window, localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
    CustomEvent:class {}, console:{error(){},warn(){}}, crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(code,context);
  return window.DB;
}
const stocks = db => copy(db.listProducts().find(p=>p.id==='p').stockByLocal);
test('legacy inventory stays once in Central with pending allocation and preserved reference', () => {
  const db=client(backend());
  assert.deepEqual(stocks(db),{Central:45,Sucursal:0,Cafeteria:0});
  assert.equal(db.listProducts()[0].stock,45);
  assert.equal(db.listProducts()[0].stockAllocationPending,true);
  assert.equal(db.listProducts()[0].legacyStock,45);
});
test('three sales and void affect their own location; repeated operations do not duplicate', async () => {
  const db=client(backend());
  db.setProductStocks('p',{Central:20,Sucursal:15,Cafeteria:10},stocks(db)); await db.flushWrites();
  db.adjustProductStock('p',-2,'Sucursal',{id:'sale_s'});
  db.adjustProductStock('p',-3,'Central',{id:'sale_c'});
  db.adjustProductStock('p',-1,'Cafeteria',{id:'sale_f'}); await db.flushWrites();
  assert.deepEqual(stocks(db),{Central:17,Sucursal:13,Cafeteria:9});
  assert.equal(db.listProducts()[0].stock,39);
  db.adjustProductStock('p',2,'Sucursal',{id:'void_s'});
  db.adjustProductStock('p',2,'Sucursal',{id:'void_s'}); await db.flushWrites();
  assert.equal(db.listProducts()[0].stock,41);
  assert.deepEqual(stocks(db),{Central:17,Sucursal:15,Cafeteria:9});
});
test('simultaneous terminals and a stale price edit preserve all stock movements', async () => {
  const server=backend({...product,stockByLocal:{Central:20,Sucursal:15,Cafeteria:10}});
  const a=client(server),b=client(server),admin=client(server);
  a.adjustProductStock('p',-2,'Sucursal',{id:'a'});
  b.adjustProductStock('p',-3,'Central',{id:'b'});
  admin.saveProduct({...admin.listProducts()[0],salePrice:200,stock:999});
  await Promise.all([a.flushWrites(),b.flushWrites(),admin.flushWrites()]);
  assert.deepEqual(server.state.productsById.p.stockByLocal,{Central:17,Sucursal:13,Cafeteria:10});
  assert.equal(server.state.productsById.p.stock,40);
  assert.equal(server.state.productsById.p.salePrice,200);
});
test('stale inventory count is rejected rather than erasing a concurrent sale', async () => {
  const server=backend(); const a=client(server),b=client(server);
  const before=stocks(a);
  b.adjustProductStock('p',-1,'Central',{id:'sale'}); await b.flushWrites();
  a.setProductStocks('p',{Central:20,Sucursal:15,Cafeteria:10},before);
  await assert.rejects(a.flushWrites(),/cambió/);
  assert.equal(server.state.productsById.p.stock,44);
});
test('weighted sales retain precision and negative shortages, and zeroing Central leaves other stores intact', async () => {
  const db=client(backend({...product,stockByLocal:{Central:2,Sucursal:1,Cafeteria:3}}));
  db.adjustProductStock('p',-1.125,'Sucursal',{id:'weight'}); await db.flushWrites();
  assert.equal(stocks(db).Sucursal,-0.125);
  assert.equal(db.listProducts()[0].stock,4.875);
  db.setProductStock('p',0,'Central',{expected:2}); await db.flushWrites();
  assert.equal(db.listProducts()[0].stock,2.875);
  assert.equal(stocks(db).Cafeteria,3);
});
test('receipts are idempotent and conflicting retry data cannot change their destination', async () => {
  const db=client(backend());
  db.adjustProductStock('p',12,'Cafeteria',{id:'purchase_1'}); await db.flushWrites();
  db.adjustProductStock('p',12,'Cafeteria',{id:'purchase_1'}); await db.flushWrites();
  assert.equal(stocks(db).Cafeteria,12);
  assert.throws(()=>db.adjustProductStock('p',12,'Sucursal',{id:'purchase_1'}),/otra cantidad o local/);
  assert.throws(()=>db.adjustProductStock('p',NaN,'Central'),/válida/);
  assert.throws(()=>db.adjustProductStock('p',1,'Desconocido'),/local/);
});
test('denied stock writes roll back optimistic inventory and report failure', async () => {
  const server=backend(); const db=client(server); server.deny();
  db.adjustProductStock('p',-2,'Central');
  await assert.rejects(db.flushWrites(),/PERMISSION_DENIED/);
  assert.equal(db.listProducts()[0].stock,45);
});
test('new catalog products accept three stocks and later imports preserve existing quantities', async () => {
  const db=client();
  db.saveProduct({...product,stockByLocal:{Central:3,Sucursal:4,Cafeteria:5}});
  assert.equal(db.listProducts().find(p=>p.id==='p').stock,12);
  db.saveProduct({...product,stock:900});
  assert.deepEqual(stocks(db),{Central:3,Sucursal:4,Cafeteria:5});
});
test('concurrent changes to different items of a legacy purchase order preserve both results', async () => {
  const server=backend();
  server.state.purchaseOrdersById={o:{id:'o',items:[{id:'a',orderedPacks:2},{id:'b',orderedPacks:3}]}};
  const a=client(server),b=client(server);
  a.updatePurchaseOrder('o',current=>({...current,items:current.items.map(item=>item.id==='a'?{...item,receivedPacks:1}:item)}));
  b.updatePurchaseOrder('o',current=>({...current,items:current.items.map(item=>item.id==='b'?{...item,unavailableAt:'date'}:item)}));
  await Promise.all([a.flushWrites(),b.flushWrites()]);
  assert.equal(server.state.purchaseOrdersById.o.items[0].receivedPacks,1);
  assert.equal(server.state.purchaseOrdersById.o.items[1].unavailableAt,'date');
});
test('denied purchase-order updates restore the previous request', async () => {
  const server=backend();server.state.purchaseOrdersById={o:{id:'o',items:[{id:'a',orderedPacks:2}]}};
  const db=client(server);server.deny();
  db.updatePurchaseOrder('o',current=>({...current,items:[]}));
  await assert.rejects(db.flushWrites(),/PERMISSION_DENIED/);
  assert.equal(db.listByStore('purchaseOrdersById')[0].items.length,1);
});
