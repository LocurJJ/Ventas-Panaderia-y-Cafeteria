const forge = require("node-forge");
const { XMLParser } = require("fast-xml-parser");

const CUIT = "27148478053";
const POINT_OF_SALE = 3;
const RECEIPT_TYPE = 6;
const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const WSFE_URL = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });

let cachedTicket = null;

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function deepFind(value, wantedKey) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, wantedKey)) return value[wantedKey];
  for (const child of Object.values(value)) {
    const found = deepFind(child, wantedKey);
    if (found !== undefined) return found;
  }
  return undefined;
}

function argentinaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate(date = argentinaDate()) {
  return date.replaceAll("-", "");
}

function isoOffset(offsetHours = 0) {
  return new Date(Date.now() + offsetHours * 3600000).toISOString();
}

function createCms(tra, certificatePem, privateKeyPem) {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const signed = forge.pkcs7.createSignedData();
  signed.content = forge.util.createBuffer(tra, "utf8");
  signed.addCertificate(certificate);
  signed.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  signed.sign({ detached: false });
  const der = forge.asn1.toDer(signed.toAsn1()).getBytes();
  return Buffer.from(der, "binary").toString("base64");
}

async function postSoap(url, action, xml) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: action ? `"${action}"` : '""',
    },
    body: xml,
  });
  const text = await response.text();
  const parsed = parser.parse(text);
  const fault = deepFind(parsed, "faultstring");
  if (fault) throw new Error(String(fault));
  if (!response.ok) throw new Error(`ARCA respondio HTTP ${response.status}: ${text.slice(0, 500)}`);
  return parsed;
}

async function getTicket(certificatePem, privateKeyPem) {
  if (cachedTicket && Date.parse(cachedTicket.expirationTime) - Date.now() > 5 * 60 * 1000) return cachedTicket;
  const uniqueId = Math.floor(Date.now() / 1000);
  const tra = `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${isoOffset(-10 / 60)}</generationTime><expirationTime>${isoOffset(10)}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
  const cms = createCms(tra, certificatePem, privateKeyPem);
  const request = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const response = await postSoap(WSAA_URL, "", request);
  const ticketXml = deepFind(response, "loginCmsReturn");
  if (!ticketXml) throw new Error("ARCA no devolvio el ticket de acceso.");
  const ticket = parser.parse(ticketXml);
  const credentials = deepFind(ticket, "credentials");
  const header = deepFind(ticket, "header");
  if (!credentials?.token || !credentials?.sign) throw new Error("El ticket de ARCA no contiene Token y Sign.");
  cachedTicket = {
    token: String(credentials.token),
    sign: String(credentials.sign),
    expirationTime: String(header.expirationTime),
  };
  return cachedTicket;
}

function authXml(ticket) {
  return `<Auth><Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${CUIT}</Cuit></Auth>`;
}

function wsfeEnvelope(operation, content) {
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation} xmlns="http://ar.gov.afip.dif.FEV1/">${content}</${operation}></soap:Body></soap:Envelope>`;
}

function responseErrors(response) {
  const errors = deepFind(response, "Errors");
  if (!errors) return [];
  const rows = Array.isArray(errors.Err) ? errors.Err : [errors.Err].filter(Boolean);
  return rows.map((row) => `[${row.Code}] ${row.Msg}`);
}

async function lastAuthorized(ticket) {
  const operation = "FECompUltimoAutorizado";
  const xml = wsfeEnvelope(operation, `${authXml(ticket)}<PtoVta>${POINT_OF_SALE}</PtoVta><CbteTipo>${RECEIPT_TYPE}</CbteTipo>`);
  const response = await postSoap(WSFE_URL, `http://ar.gov.afip.dif.FEV1/${operation}`, xml);
  const errors = responseErrors(response);
  if (errors.length) throw new Error(errors.join(" | "));
  const result = deepFind(response, "FECompUltimoAutorizadoResult");
  return Number(result?.CbteNro || 0);
}

function calculateAmounts(total, vatRate) {
  const totalCents = Math.round(Number(total) * 100);
  const netCents = Math.round(totalCents / (1 + Number(vatRate) / 100));
  const vatCents = totalCents - netCents;
  return {
    total: totalCents / 100,
    net: netCents / 100,
    vat: vatCents / 100,
  };
}

function amount(value) {
  return Number(value).toFixed(2);
}

async function authorizeInvoice({ certificatePem, privateKeyPem, total, vatRate }) {
  const ticket = await getTicket(certificatePem, privateKeyPem);
  const lastNumber = await lastAuthorized(ticket);
  const receiptNumber = lastNumber + 1;
  const vatId = Number(vatRate) === 21 ? 5 : 4;
  const amounts = calculateAmounts(total, vatRate);
  const receiptDate = argentinaDate();
  const operation = "FECAESolicitar";
  const detail = `<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${POINT_OF_SALE}</PtoVta><CbteTipo>${RECEIPT_TYPE}</CbteTipo></FeCabReq><FeDetReq><FECAEDetRequest><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>${receiptNumber}</CbteDesde><CbteHasta>${receiptNumber}</CbteHasta><CbteFch>${compactDate(receiptDate)}</CbteFch><ImpTotal>${amount(amounts.total)}</ImpTotal><ImpTotConc>0.00</ImpTotConc><ImpNeto>${amount(amounts.net)}</ImpNeto><ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>${amount(amounts.vat)}</ImpIVA><MonId>PES</MonId><MonCotiz>1.00</MonCotiz><CondicionIVAReceptorId>5</CondicionIVAReceptorId><Iva><AlicIva><Id>${vatId}</Id><BaseImp>${amount(amounts.net)}</BaseImp><Importe>${amount(amounts.vat)}</Importe></AlicIva></Iva></FECAEDetRequest></FeDetReq></FeCAEReq>`;
  const xml = wsfeEnvelope(operation, `${authXml(ticket)}${detail}`);
  const response = await postSoap(WSFE_URL, `http://ar.gov.afip.dif.FEV1/${operation}`, xml);
  const errors = responseErrors(response);
  const header = deepFind(response, "FeCabResp");
  const result = deepFind(response, "FECAEDetResponse");
  const observationsGroup = deepFind(response, "Observaciones");
  const observations = observationsGroup
    ? (Array.isArray(observationsGroup.Obs) ? observationsGroup.Obs : [observationsGroup.Obs]).map((row) => `[${row.Code}] ${row.Msg}`)
    : [];
  if (errors.length || header?.Resultado !== "A" || result?.Resultado !== "A" || !result?.CAE) {
    throw new Error([...errors, ...observations, "ARCA rechazo el comprobante."].filter(Boolean).join(" | "));
  }
  return {
    receiptNumber,
    invoiceNumber: `${String(POINT_OF_SALE).padStart(5, "0")}-${String(receiptNumber).padStart(8, "0")}`,
    pointOfSale: POINT_OF_SALE,
    receiptType: RECEIPT_TYPE,
    receiptDate,
    cae: String(result.CAE),
    caeExpiration: String(result.CAEFchVto),
    amounts,
    vatRate: Number(vatRate),
    observations,
  };
}

async function testConnection({ certificatePem, privateKeyPem }) {
  const ticket = await getTicket(certificatePem, privateKeyPem);
  const lastNumber = await lastAuthorized(ticket);
  return { ok: true, pointOfSale: POINT_OF_SALE, receiptType: RECEIPT_TYPE, lastNumber };
}

module.exports = {
  CUIT,
  POINT_OF_SALE,
  RECEIPT_TYPE,
  authorizeInvoice,
  testConnection,
};
