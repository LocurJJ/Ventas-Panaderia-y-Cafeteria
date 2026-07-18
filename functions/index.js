const crypto = require("node:crypto");
const express = require("express");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { authorizeInvoice } = require("./arca");
const { createInvoicePdf } = require("./invoice-pdf");

initializeApp();

const ARCA_CERT_HOMO = defineSecret("ARCA_CERT_HOMO");
const ARCA_KEY_HOMO = defineSecret("ARCA_KEY_HOMO");
const app = express();
const allowedOrigins = new Set([
  "https://locurjj.github.io",
  "https://cafeteriaypanaderia.web.app",
  "https://cafeteriaypanaderia.firebaseapp.com",
]);

app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-ARCA-Mode");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  return next();
});

function recordKey(saleId) {
  return crypto.createHash("sha256").update(String(saleId)).digest("hex");
}

function publicBaseUrl() {
  const project = process.env.GCLOUD_PROJECT || "cafeteriaypanaderia";
  return `https://southamerica-east1-${project}.cloudfunctions.net/arcaApi`;
}

function publicResult(record) {
  return {
    mode: "homologacion",
    status: "test_issued",
    invoiceNumber: record.invoiceNumber,
    pointOfSale: record.pointOfSale,
    cae: record.cae,
    caeExpiration: record.caeExpiration,
    issuedAt: record.issuedAt,
    vatRate: record.vatRate,
    pdfUrl: `${publicBaseUrl()}/invoices/${encodeURIComponent(record.saleId)}/pdf?token=${record.publicToken}`,
  };
}

function validatePayload(body) {
  const total = Number(body?.item?.finalPrice);
  const vatRate = Number(body?.item?.vatRate);
  if (!body?.saleId || String(body.saleId).length > 200) throw new Error("La venta no tiene un identificador valido.");
  if (!Number.isFinite(total) || total <= 0) throw new Error("El total de la venta no es valido.");
  if (total >= 10000000) throw new Error("Para este importe ARCA exige identificar al comprador; no se puede facturar como consumidor final anonimo.");
  if (![10.5, 21].includes(vatRate)) throw new Error("La alicuota debe ser 10,5% o 21%.");
  return { total, vatRate };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "homologacion", fiscalValidity: false });
});

app.post("/invoices", async (req, res) => {
  if (req.get("X-ARCA-Mode") !== "homologacion") return res.status(400).json({ message: "Falta confirmar el modo de homologacion." });
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ message: "Origen no autorizado." });
  let validated;
  try {
    validated = validatePayload(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const saleId = String(req.body.saleId);
  const ref = getDatabase().ref(`arcaTestInvoices/${recordKey(saleId)}`);
  const snapshot = await ref.get();
  if (snapshot.exists() && snapshot.val()?.status === "test_issued") return res.json(publicResult(snapshot.val()));

  const lockRef = getDatabase().ref("arcaTestLocks/point3FacturaB");
  const lockId = crypto.randomUUID();
  const lock = await lockRef.transaction((current) => {
    if (current && Number(current.expiresAt || 0) > Date.now()) return;
    return { lockId, expiresAt: Date.now() + 90000 };
  });
  if (!lock.committed || lock.snapshot.val()?.lockId !== lockId) return res.status(409).json({ message: "ARCA esta procesando otra factura. Intenta nuevamente en unos segundos." });

  try {
    const invoice = await authorizeInvoice({
      certificatePem: ARCA_CERT_HOMO.value(),
      privateKeyPem: ARCA_KEY_HOMO.value(),
      total: validated.total,
      vatRate: validated.vatRate,
    });
    const record = {
      ...invoice,
      saleId,
      status: "test_issued",
      mode: "homologacion",
      fiscalValidity: false,
      description: "Producto de panaderia",
      paymentCode: String(req.body?.payment?.code || "EFECTIVO"),
      paymentText: String(req.body?.payment?.code || "EFECTIVO") === "EFECTIVO" ? "Contado" : "Otros medios de pago electronico",
      issuedAt: new Date().toISOString(),
      publicToken: crypto.randomBytes(24).toString("hex"),
    };
    await ref.set(record);
    return res.status(201).json(publicResult(record));
  } catch (error) {
    console.error("ARCA invoice error", error);
    return res.status(502).json({ message: error.message || "No se pudo emitir el comprobante de prueba." });
  } finally {
    const currentLock = await lockRef.get();
    if (currentLock.val()?.lockId === lockId) await lockRef.remove();
  }
});

app.get("/invoices/:saleId/pdf", async (req, res) => {
  const snapshot = await getDatabase().ref(`arcaTestInvoices/${recordKey(req.params.saleId)}`).get();
  if (!snapshot.exists()) return res.status(404).send("Comprobante no encontrado.");
  const invoice = snapshot.val();
  const suppliedToken = Buffer.from(String(req.query.token || ""));
  const expectedToken = Buffer.from(String(invoice.publicToken || ""));
  if (suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
    return res.status(403).send("Enlace no autorizado.");
  }
  const pdf = await createInvoicePdf(invoice);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `inline; filename="Factura-B-${invoice.invoiceNumber}-HOMOLOGACION.pdf"`);
  res.set("Cache-Control", "private, max-age=300");
  return res.send(pdf);
});

exports.arcaApi = onRequest({
  region: "southamerica-east1",
  memory: "512MiB",
  timeoutSeconds: 60,
  secrets: [ARCA_CERT_HOMO, ARCA_KEY_HOMO],
}, app);
