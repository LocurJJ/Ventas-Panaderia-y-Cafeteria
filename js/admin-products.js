const {
  calculateSalePrice,
  listProducts,
  removeById,
  saveProduct,
  suppliers,
} = window.DB;

const WHATSAPP_KEY = "whatsappProducts";

let products = [];
let selectedId = "";
let changedProducts = window.DB.readStore(WHATSAPP_KEY, []);

const $ = (id) => document.getElementById(id);

function normalizedSupplier(value) {
  return String(value || "").toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
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

function money(value) {
  return `$ ${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function fillSuppliers() {
  $("supplierInput").innerHTML = suppliers.map((supplier) => (
    `<option value="${supplier}">${supplier}</option>`
  )).join("");
}

function refreshProducts() {
  products = listProducts();
}

function renderProducts() {
  const search = $("productSearch").value.trim().toLowerCase();
  const filtered = products.filter((product) => {
    const text = `${product.name} ${product.barcode || ""} ${product.supplier || ""}`.toLowerCase();
    return text.includes(search);
  });

  $("productCount").textContent = `${products.length} productos`;
  $("productList").innerHTML = filtered.length === 0
    ? `<p class="muted">No hay productos para mostrar.</p>`
    : filtered.map((product) => `
      <button type="button" class="${product.id === selectedId ? "active" : ""}" data-product-id="${product.id}">
        <strong>${product.name}</strong>
        <small>Venta: ${money(product.salePrice)} | Costo: ${money(product.cost)}</small>
        <small>Stock: ${product.stock || 0} ${product.weighable ? "kg" : "un."} | Pack: ${product.packQuantity || 1} | ${canonicalSupplier(product.supplier)} | ${product.category || "Panaderia"}</small>
        <small>Codigo: ${product.barcode || "Sin codigo"}</small>
      </button>
    `).join("");
}

function renderWhatsapp() {
  $("whatsappMessage").value = changedProducts
    .map((product) => `${product.name}---$${Number(product.salePrice || 0).toLocaleString("es-AR")}`)
    .join("\n");
}

function resetForm() {
  selectedId = "";
  $("productForm").reset();
  $("productId").value = "";
  $("stockInput").value = "0";
  $("packQuantityInput").value = "1";
  $("supplierInput").value = "Otros";
  $("categoryInput").value = "Panaderia";
  $("formTitle").textContent = "Anadir producto";
  $("deleteProductButton").classList.add("hidden");
  renderProducts();
}

function selectProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;

  selectedId = id;
  $("productId").value = product.id;
  $("nameInput").value = product.name;
  $("costInput").value = product.cost || 0;
  $("saleInput").value = product.salePrice || 0;
  $("barcodeInput").value = product.barcode || "";
  $("stockInput").value = product.stock || 0;
  $("packQuantityInput").value = product.packQuantity || 1;
  $("supplierInput").value = canonicalSupplier(product.supplier);
  $("categoryInput").value = product.category || "Panaderia";
  $("weighableInput").checked = !!product.weighable;
  $("formTitle").textContent = "Modificar producto";
  $("deleteProductButton").classList.remove("hidden");
  renderProducts();
}

function readForm() {
  const cost = Number($("costInput").value || 0);
  const salePrice = $("saleInput").value === "" ? calculateSalePrice(cost) : $("saleInput").value;

  return {
    id: $("productId").value,
    name: $("nameInput").value,
    cost,
    salePrice,
    barcode: $("barcodeInput").value,
    stock: $("stockInput").value,
    packQuantity: $("packQuantityInput").value,
    supplier: $("supplierInput").value,
    category: $("categoryInput").value,
    weighable: $("weighableInput").checked,
  };
}

function addToWhatsapp(product) {
  changedProducts = changedProducts.filter((item) => item.id !== product.id);
  changedProducts.push({ id: product.id, name: product.name, salePrice: product.salePrice });
  window.DB.writeStore(WHATSAPP_KEY, changedProducts);
  renderWhatsapp();
}


function exportProductsToJson() {
  refreshProducts();
  if (!products.length) {
    alert("No hay productos para exportar.");
    return;
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    type: "panaderia-josue-products",
    version: 1,
    exportedAt,
    productCount: products.length,
    products: products.map((product) => ({
      id: product.id,
      name: product.name || "",
      cost: Number(product.cost || 0),
      salePrice: Number(product.salePrice || 0),
      barcode: product.barcode || "",
      stock: Math.max(0, Number(product.stock || 0)),
      packQuantity: Math.max(0.001, Number(product.packQuantity || 1)),
      supplier: canonicalSupplier(product.supplier),
      category: product.category || "Panaderia",
      weighable: !!product.weighable,
      updatedAt: product.updatedAt || null,
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = exportedAt.slice(0, 10);
  link.href = url;
  link.download = "productos-panaderia-josue-" + date + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  alert("Se exportaron " + products.length + " productos.");
}

function productFromImport(rawProduct) {
  const cost = Number(rawProduct.cost ?? rawProduct.precioCompra ?? rawProduct.precioCosto ?? 0);
  const importedSalePrice = Number(rawProduct.salePrice ?? rawProduct.precioVenta ?? rawProduct.price ?? 0);
  return {
    id: rawProduct.id || "",
    name: String(rawProduct.name ?? rawProduct.nombre ?? "").trim(),
    cost,
    salePrice: importedSalePrice || calculateSalePrice(cost),
    barcode: String(rawProduct.barcode ?? rawProduct.codigoBarra ?? rawProduct.codigo ?? "").trim(),
    stock: Number(rawProduct.stock ?? 0),
    packQuantity: Number(rawProduct.packQuantity ?? rawProduct.cantidadPorPack ?? 1),
    supplier: canonicalSupplier(rawProduct.supplier ?? rawProduct.proveedor ?? "Otros"),
    category: rawProduct.category ?? rawProduct.categoria ?? "Panaderia",
    weighable: !!(rawProduct.weighable ?? rawProduct.pesable ?? rawProduct.esPesable),
  };
}

function readImportedProducts(text) {
  const parsed = JSON.parse(text);
  const rawProducts = Array.isArray(parsed) ? parsed : parsed.products;
  if (!Array.isArray(rawProducts)) {
    throw new Error("El archivo no tiene una lista de productos.");
  }
  return rawProducts.map(productFromImport).filter((product) => product.name);
}

function findImportId(product) {
  const barcode = String(product.barcode || "").trim();
  const existingById = product.id ? products.find((item) => item.id === product.id) : null;
  const existingByBarcode = barcode ? products.find((item) => String(item.barcode || "").trim() === barcode) : null;
  return existingById?.id || existingByBarcode?.id || product.id || "";
}

async function importProductsFromFile(file) {
  const importedProducts = readImportedProducts(await file.text());
  if (importedProducts.length === 0) {
    throw new Error("No encontre productos para importar.");
  }
  if (!confirm(`Importar ${importedProducts.length} productos? Si ya existe el mismo codigo de barra, se actualiza.`)) {
    return;
  }

  let importedCount = 0;
  importedProducts.forEach((product) => {
    saveProduct({ ...product, id: findImportId(product) });
    importedCount += 1;
  });
  refreshProducts();
  resetForm();
  alert(`Listo. Se importaron ${importedCount} productos.`);
}

function setupEvents() {
  window.addEventListener("panaderia:store-changed", (event) => {
    const storeName = event.detail?.name;
    if (storeName === "productsById") {
      refreshProducts();
      renderProducts();
    }
    if (storeName === WHATSAPP_KEY) {
      changedProducts = window.DB.readStore(WHATSAPP_KEY, []);
      renderWhatsapp();
    }
  });

  window.addEventListener("panaderia:database-error", () => {
    alert("La base de datos no confirmo el guardado. Revisa internet y avisame con una foto si vuelve a pasar.");
  });

  $("productSearch").addEventListener("input", renderProducts);
  $("newProductButton").addEventListener("click", resetForm);
  $("exportProductsButton").addEventListener("click", exportProductsToJson);
  $("importProductsButton").addEventListener("click", () => $("importProductsInput").click());
  $("importProductsInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importProductsFromFile(file);
    } catch (error) {
      alert(error.message || "No se pudo importar el archivo.");
    } finally {
      event.target.value = "";
    }
  });
  $("clearFormButton").addEventListener("click", resetForm);
  $("costInput").addEventListener("input", () => {
    $("saleInput").value = calculateSalePrice($("costInput").value);
  });

  $("productList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-id]");
    if (button) selectProduct(button.dataset.productId);
  });

  $("productForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const product = saveProduct(readForm());
      addToWhatsapp(product);
      refreshProducts();
      selectProduct(product.id);
      alert("Producto guardado.");
    } catch (error) {
      alert(error.message);
    }
  });

  $("deleteProductButton").addEventListener("click", () => {
    if (!selectedId) return;
    const product = products.find((item) => item.id === selectedId);
    if (!confirm(`Seguro que queres borrar ${product?.name || "este producto"}?`)) return;
    removeById("productsById", selectedId);
    changedProducts = changedProducts.filter((item) => item.id !== selectedId);
    window.DB.writeStore(WHATSAPP_KEY, changedProducts);
    refreshProducts();
    resetForm();
    renderWhatsapp();
  });

  $("clearWhatsappButton").addEventListener("click", () => {
    changedProducts = [];
    window.DB.writeStore(WHATSAPP_KEY, changedProducts);
    renderWhatsapp();
  });

  $("copyWhatsappButton").addEventListener("click", async () => {
    if (!$("whatsappMessage").value.trim()) {
      alert("No hay mensaje para copiar.");
      return;
    }
    await navigator.clipboard.writeText($("whatsappMessage").value);
    alert("Mensaje copiado.");
  });
}

fillSuppliers();
refreshProducts();
setupEvents();
resetForm();
renderWhatsapp();
