const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/purchase-utils.js'),'utf8'),{window});
const P=window.Purchases,plain=x=>JSON.parse(JSON.stringify(x));
test('weekly suggestion inputs use only the chosen location and last seven days, excluding voids and future dates',()=>{
 const now=Date.parse('2026-09-29T12:00:00Z'),products=[{id:'p',name:'Pan'}];
 const sale=(local,quantity,days=0,deletedAt=null)=>({local,date:new Date(now-days*86400000).toISOString(),deletedAt,items:[{productId:'p',quantity}]});
 const sales=[sale('Central',26),sale('Sucursal',19),sale('Cafeteria',12),sale('Central',200,8),sale('Central',100,0,'void'),sale('Central',300,-1)];
 assert.equal(P.weeklySales(sales,products,'Central',now).get('p'),26);
 assert.equal(P.weeklySales(sales,products,'Sucursal',now).get('p'),19);
 assert.equal(P.weeklySales(sales,products,'Cafeteria',now).get('p'),12);
});
test('general aggregates packs while retaining the local allocations',()=>{
 const orders=[{id:'a',local:'Central',items:[{productId:'p',name:'Pan',packQuantity:6,orderedPacks:4}]},{id:'b',local:'Sucursal',items:[{productId:'p',name:'Pan',packQuantity:6,orderedPacks:3}]}];
 const rows=P.aggregate(P.entries(orders));assert.equal(rows.length,1);assert.equal(rows[0].packs,7);
 assert.deepEqual(plain(rows[0].byLocal),{Central:4,Sucursal:3,Cafeteria:0});
 assert.equal(P.aggregate(P.entries(orders,'Sucursal'))[0].packs,3);
});
test('different pack sizes are not silently combined; partial receipts keep the balance pending',()=>{
 const orders=[{local:'Central',items:[{productId:'p',name:'Pan',packQuantity:6,orderedPacks:4,receivedPacks:2},{productId:'p',name:'Pan',packQuantity:12,orderedPacks:1}]}];
 const rows=P.aggregate(P.entries(orders));assert.equal(rows.length,2);assert.equal(rows[0].packs,2);assert.equal(rows[1].packs,1);
});
test('old requests are preserved in Central; cancelled and completed requests are excluded',()=>{
 const orders=[{items:[{id:'legacy',orderedPacks:2},{id:'void',orderedPacks:4,cancelledAt:'date'},{id:'done',orderedPacks:4,receivedAt:'date'}]}];
 assert.equal(P.entries(orders,'Central').length,1);assert.equal(P.entries(orders,'Sucursal').length,0);
 assert.equal(P.entries(orders)[0].item.id,'legacy');
});
