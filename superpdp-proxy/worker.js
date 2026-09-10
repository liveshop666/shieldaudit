/**
 * Relais sécurisé entre la page Facture de ShieldAudit et l'API SUPER PDP
 * (Plateforme Agréée, émission de facture électronique).
 *
 * Même principe que iopole-proxy/worker.js : la clé API ne doit JAMAIS être
 * placée dans index.html (page publique, code source visible par tous). Ce
 * worker tourne côté serveur (Cloudflare), les identifiants sont stockés
 * comme secrets et ne sont jamais envoyés au navigateur.
 *
 * Authentification (doc officielle SUPER PDP, section "security" du fichier
 * OpenAPI fourni) : flux OAuth2 client_credentials, comme iopole. On échange
 * SUPERPDP_CLIENT_ID + SUPERPDP_CLIENT_SECRET contre un access_token auprès
 * de SUPERPDP_TOKEN_URL, puis ce token sert de Bearer pour l'appel à l'API
 * facture. Le client_id/secret ont été générés depuis le portail SUPER PDP
 * (Bac à sable → Applications), pour l'entreprise de test "Burger Queen" —
 * le token est donc automatiquement lié à cette entreprise, pas besoin d'un
 * en-tête supplémentaire pour l'identifier (cf. /v1.beta/companies/me dans
 * la doc).
 *
 * D'après la doc officielle (chemin POST /v1.beta/invoices) :
 * - le corps peut être directement du XML (CII ou UBL) avec
 *   Content-Type: application/xml, ou un PDF Factur-X, ou un multipart. On
 *   envoie ici du XML UBL 2.1 directement (pas besoin de multipart,
 *   contrairement à iopole).
 * - réponse 200 : objet "invoice" avec un id à conserver pour suivre le
 *   statut ensuite (route /v1.beta/invoice_events).
 * - le champ "processing_rule" (paramètre facultatif) est calculé
 *   automatiquement si non fourni.
 *
 * ATTENTION COMPLIANCE : comme pour iopole, ce générateur UBL est minimal
 * (best-effort) et repris tel quel de iopole-proxy/worker.js. SUPER PDP
 * applique ses propres règles de validation avant transfert — teste d'abord
 * sur le bac à sable, ajuste le mapping ci-dessous selon les erreurs
 * retournées, avant tout envoi réel.
 */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405, env);
    }

    if (!env.SUPERPDP_CLIENT_ID || !env.SUPERPDP_CLIENT_SECRET) {
      return json(
        { error: 'SUPERPDP_CLIENT_ID ou SUPERPDP_CLIENT_SECRET non configuré côté serveur.' },
        500,
        env
      );
    }

    let invoice;
    try {
      invoice = await request.json();
    } catch {
      return json({ error: 'Corps de requête JSON invalide.' }, 400, env);
    }

    if (!invoice.numero || !invoice.client || !invoice.lignes) {
      return json({ error: 'Champs obligatoires manquants (numero, client, lignes).' }, 400, env);
    }

    let accessToken;
    try {
      accessToken = await getAccessToken(env);
    } catch (err) {
      return json({ error: 'Authentification SUPER PDP (OAuth2) échouée.', detail: String(err) }, 502, env);
    }

    const ublXml = buildUblInvoice(invoice);
    const apiBase = env.SUPERPDP_API_URL || 'https://api.superpdp.tech';
    const invoicesUrl = `${apiBase}/v1.beta/invoices?external_id=${encodeURIComponent(invoice.numero)}`;

    let superpdpResponse;
    try {
      superpdpResponse = await fetch(invoicesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/xml',
          accept: 'application/json',
        },
        body: ublXml,
      });
    } catch (err) {
      return json({ error: 'Impossible de joindre SUPER PDP.', detail: String(err) }, 502, env);
    }

    const bodyText = await superpdpResponse.text();
    return new Response(bodyText, {
      status: superpdpResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
  },
};

async function getAccessToken(env) {
  const apiBase = env.SUPERPDP_API_URL || 'https://api.superpdp.tech';
  const tokenUrl = env.SUPERPDP_TOKEN_URL || `${apiBase}/oauth2/token`;
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  // Authentification "confidentielle" (RFC 6749 §2.3.1) : client_id/secret
  // envoyés dans l'en-tête Authorization (Basic), pas dans le corps — c'est
  // la méthode par défaut attendue pour une application de type
  // "Confidentielle" côté SUPER PDP.
  const basicAuth = btoa(`${env.SUPERPDP_CLIENT_ID}:${env.SUPERPDP_CLIENT_SECRET}`);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Réponse sans access_token');
  return data.access_token;
}

function buildUblInvoice(invoice) {
  const ht = Number(invoice.lignes[0]?.prix_ht) || 0;
  const tvaTaux = Number(invoice.lignes[0]?.taux_tva) || 0;
  const tvaMontant = Number(invoice.lignes[0]?.montant_tva) || 0;
  const ttc = Number(invoice.lignes[0]?.prix_ttc) || ht + tvaMontant;
  const money = (n) => n.toFixed(2);

  const lignesXml = invoice.lignes
    .map(
      (l, i) => `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${money(Number(l.prix_ht) || 0)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${esc(l.description || '')}</cbc:Description>
      <cbc:Name>${esc(l.designation || 'Prestation')}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${Number(l.taux_tva) > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${Number(l.taux_tva) || 0}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${money(Number(l.prix_ht) || 0)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoice.numero)}</cbc:ID>
  <cbc:IssueDate>${invoice.date_emission || ''}</cbc:IssueDate>
  <cbc:DueDate>${invoice.date_echeance || ''}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(invoice.reference_devis || invoice.numero)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(invoice.emetteur?.nom || 'ShieldAudit')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:StreetName>${esc(invoice.emetteur?.ville || '')}</cbc:StreetName><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:Contact><cbc:Telephone>${esc(invoice.emetteur?.telephone || '')}</cbc:Telephone></cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(invoice.client?.nom || '')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:StreetName>${esc(invoice.client?.adresse || '')}</cbc:StreetName><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:Contact><cbc:Name>${esc(invoice.client?.contact || '')}</cbc:Name><cbc:Telephone>${esc(invoice.client?.telephone || '')}</cbc:Telephone><cbc:ElectronicMail>${esc(invoice.client?.email || '')}</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${money(tvaMontant)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${money(ht)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${money(tvaMontant)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${tvaTaux > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${tvaTaux}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${money(ht)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${money(ht)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${money(ttc)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${money(ttc)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lignesXml}
</Invoice>`;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}
