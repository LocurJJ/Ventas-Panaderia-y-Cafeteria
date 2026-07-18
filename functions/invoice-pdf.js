const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { CUIT, RECEIPT_TYPE } = require("./arca");

function pesos(value) {
  return `$ ${Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value) {
  const text = String(value || "").replaceAll("-", "");
  if (text.length !== 8) return value || "";
  return `${text.slice(6, 8)}/${text.slice(4, 6)}/${text.slice(0, 4)}`;
}

function qrUrl(invoice) {
  const payload = {
    ver: 1,
    fecha: invoice.receiptDate,
    cuit: Number(CUIT),
    ptoVta: Number(invoice.pointOfSale),
    tipoCmp: RECEIPT_TYPE,
    nroCmp: Number(invoice.receiptNumber),
    importe: Number(invoice.amounts.total),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: 99,
    nroDocRec: 0,
    tipoCodAut: "E",
    codAut: Number(invoice.cae),
  };
  return `https://www.arca.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
}

function line(doc, y) {
  doc.moveTo(40, y).lineTo(555, y).strokeColor("#26354a").lineWidth(0.8).stroke();
}

function field(doc, label, value, x, y, width = 240) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(label, x, y, { width });
  doc.font("Helvetica").fontSize(9).text(value, x, y + 12, { width });
}

async function createInvoicePdf(invoice) {
  const qr = await QRCode.toBuffer(qrUrl(invoice), { width: 170, margin: 1, errorCorrectionLevel: "M" });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Factura B ${invoice.invoiceNumber}` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.save().font("Helvetica-Bold").fontSize(34).fillColor("#dc2626").opacity(0.11).text("HOMOLOGACION", 40, 415, { width: 515, align: "center" }).fontSize(27).text("SIN VALIDEZ FISCAL", 40, 458, { width: 515, align: "center" }).restore().opacity(1);

    doc.rect(40, 40, 515, 150).strokeColor("#111827").lineWidth(1.2).stroke();
    doc.moveTo(300, 40).lineTo(300, 190).stroke();
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("JOSUE Y HERMANAS", 55, 60, { width: 225, align: "center" });
    doc.font("Helvetica").fontSize(9).text("Colastine 1320 - Pontevedra, Buenos Aires", 55, 95, { width: 225, align: "center" });
    doc.font("Helvetica").fontSize(9).text("LO CURTO JUAN DE DIOS", 55, 125, { width: 225, align: "center" });
    doc.font("Helvetica").fontSize(9).text("IVA RESPONSABLE INSCRIPTO", 55, 140, { width: 225, align: "center" });

    doc.rect(282, 40, 36, 42).fillAndStroke("white", "#111827");
    doc.font("Helvetica-Bold").fontSize(27).fillColor("#111827").text("B", 282, 48, { width: 36, align: "center" });
    doc.font("Helvetica-Bold").fontSize(23).text("FACTURA", 330, 57);
    doc.font("Helvetica-Bold").fontSize(13).text(`Nro: ${invoice.invoiceNumber}`, 330, 94);
    doc.font("Helvetica").fontSize(9).text(`FECHA: ${displayDate(invoice.receiptDate)}`, 330, 119);
    doc.text(`CUIT: ${CUIT}`, 330, 139);
    doc.text("Ingresos Brutos: 27148478053", 330, 153);
    doc.text("Inicio de actividades: 01/2020", 330, 167);

    field(doc, "Apellido y nombre / Razon social", "CONSUMIDOR FINAL", 50, 208, 300);
    field(doc, "Condicion frente al IVA", "Consumidor Final", 360, 208, 180);
    field(doc, "Domicilio", "No requerido", 50, 244, 300);
    field(doc, "Condicion de venta", invoice.paymentText || "Contado", 360, 244, 180);
    line(doc, 285);

    doc.font("Helvetica-Bold").fontSize(9).text("DESCRIPCION", 55, 304);
    doc.text("CANT.", 360, 304, { width: 55, align: "right" });
    doc.text("P. UNITARIO", 420, 304, { width: 65, align: "right" });
    doc.text("TOTAL", 490, 304, { width: 55, align: "right" });
    line(doc, 320);
    doc.font("Helvetica").fontSize(10).text(invoice.description || "Producto de panaderia", 55, 340, { width: 285 });
    doc.text("1", 360, 340, { width: 55, align: "right" });
    doc.text(pesos(invoice.amounts.total), 420, 340, { width: 65, align: "right" });
    doc.text(pesos(invoice.amounts.total), 490, 340, { width: 55, align: "right" });
    doc.fontSize(8).text(`IVA ${String(invoice.vatRate).replace(".", ",")}% incluido`, 55, 365);

    line(doc, 520);
    doc.font("Helvetica").fontSize(9).text(`Neto gravado: ${pesos(invoice.amounts.net)}`, 335, 540, { width: 210, align: "right" });
    doc.text(`IVA ${String(invoice.vatRate).replace(".", ",")}%: ${pesos(invoice.amounts.vat)}`, 335, 557, { width: 210, align: "right" });
    doc.font("Helvetica-Bold").fontSize(13).text(`TOTAL: ${pesos(invoice.amounts.total)}`, 335, 580, { width: 210, align: "right" });

    doc.image(qr, 55, 545, { width: 120, height: 120 });
    doc.font("Helvetica-Bold").fontSize(9).text("ARCA", 185, 560);
    doc.font("Helvetica").fontSize(8).text(`CAE: ${invoice.cae}`, 185, 582);
    doc.text(`Vencimiento CAE: ${displayDate(invoice.caeExpiration)}`, 185, 598);
    doc.fillColor("#b91c1c").font("Helvetica-Bold").fontSize(10).text("COMPROBANTE DE HOMOLOGACION - NO FISCAL", 55, 695, { width: 490, align: "center" });
    doc.fillColor("#111827").font("Helvetica").fontSize(7).text("Documento generado por el sistema de Panaderia Josue con datos autorizados en el entorno de pruebas de ARCA.", 55, 714, { width: 490, align: "center" });
    doc.end();
  });
}

module.exports = { createInvoicePdf };
