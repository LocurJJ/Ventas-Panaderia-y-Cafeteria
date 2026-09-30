(function () {
  const LOCALS = ["Central", "Sucursal", "Cafeteria"];
  function label(local) { return local === "Cafeteria" ? "Cafetería" : local; }
  function localOf(order, item = {}) {
    return LOCALS.includes(item.local) ? item.local : LOCALS.includes(order.local) ? order.local : "Central";
  }
  function remaining(item) {
    return item.receivedAt || item.cancelledAt ? 0 : Math.max(0, Number(item.orderedPacks || 0) - Number(item.receivedPacks || 0));
  }
  function entries(orders, local = "General") {
    return orders.flatMap(order => (order.items || []).map(item => ({order, item, local: localOf(order, item)})))
      .filter(entry => remaining(entry.item) > 0 && (local === "General" || entry.local === local));
  }
  function normalized(value) {
    return String(value || "").toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  function aggregate(entries) {
    const grouped = new Map();
    entries.forEach(entry => {
      const item = entry.item;
      const key = JSON.stringify([item.productId || normalized(item.name), Number(item.packQuantity || 1), !!item.weighable]);
      if (!grouped.has(key)) grouped.set(key, {key, name:item.name, packQuantity:Number(item.packQuantity || 1),
        weighable:!!item.weighable, packs:0, byLocal:{Central:0,Sucursal:0,Cafeteria:0}, entries:[]});
      const row = grouped.get(key), packs = remaining(item);
      row.packs += packs;
      row.byLocal[entry.local] += packs;
      row.entries.push(entry);
    });
    return Array.from(grouped.values()).sort((a,b) => a.name.localeCompare(b.name,"es-AR"));
  }
  function weeklySales(sales, products, local, now = Date.now()) {
    const byId = new Map(products.map(p => [p.id,p]));
    const byName = new Map(products.map(p => [normalized(p.name),p]));
    const totals = new Map();
    sales.filter(sale => sale.local === local && !sale.deletedAt &&
      new Date(sale.date).getTime() >= now - 7*24*60*60*1000 && new Date(sale.date).getTime() <= now)
      .forEach(sale => (sale.items || []).forEach(item => {
        const product = byId.get(item.productId) || byName.get(normalized(item.name));
        if (product) totals.set(product.id, (totals.get(product.id) || 0) + Number(item.quantity || 0));
      }));
    return totals;
  }
  window.Purchases = { LOCALS, label, localOf, remaining, entries, aggregate, normalized, weeklySales };
})();
