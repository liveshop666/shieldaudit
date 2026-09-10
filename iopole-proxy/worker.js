/**
 * Relais sécurisé entre la page Facture de ShieldAudit et l'API iopole
 * (émission de facture électronique).
 *
 * La clé API iopole ne doit JAMAIS être placée dans index.html : ce fichier
 * HTML est public, donc toute clé qui s'y trouverait serait visible par
 * n'importe qui (menu "Afficher le code source"). Ce worker tourne côté
 * serveur (Cloudflare) : la clé et l'identifiant client sont stockés comme
 * secrets et ne sont jamais envoyés au navigateur.
 *
 * Authentification (doc officielle « Authentification » / OAuth2) : iopole
 * utilise un flux OAuth2 client_credentials. On échange IOPOLE_CLIENT_ID +
 * IOPOLE_CLIENT_SECRET contre un access_token de courte durée (1h) auprès de
 * IOPOLE_TOKEN_URL, puis ce token sert de Bearer pour l'appel à l'API
 * facture. Un token est redemandé à chaque appel (l'usage est trop rare ici
 * pour justifier un cache).
 *
 * D'après la doc officielle iopole (« Send invoice », POST /v1/invoice) :
 * - le corps est un multipart/form-data avec un champ "file" contenant le
 *   document facture — SEULS les formats PDF ou XML sont acceptés
 *   nativement (UBL, Factur-X, XRechnung, CII), pas de JSON brut. On génère
 *   donc ici une facture au format UBL 2.1 (XML) à partir des données du
 *   formulaire.
 * - en-têtes : "Authorization: Bearer <access_token>" et "customer-id"
 *   (l'identifiant unique du compte iopole) sont tous les deux obligatoires
 *   — customer-id le devient pour toutes les requêtes à compter du
 *   1er février 2026 selon l'annonce iopole.
 * - l'appel est asynchrone : une réponse 201 renvoie { type: "INVOICE", id }
 *   à conserver pour suivre le statut ensuite (webhook ou GET /v1/status).
 *
 * ATTENTION COMPLIANCE : ce générateur UBL est minimal (best-effort). iopole
 * applique une validation structurelle ET Schematron (règles légales
 * françaises/EN16931) avant transfert — une facture incomplète (SIRET
 * manquant, mentions légales, etc.) sera rejetée avec une notification de
 * statut détaillant l'erreur. Teste sur https://labs.iopole.io/ (bac à
 * sable public) avant tout envoi réel, et complète le mapping ci-dessous
 * (SIRET émetteur/client notamment, absents du formulaire actuel) selon les
 * retours de validation.
 *
 * Pour vérifier le statut réel d'une facture envoyée (accepté/rejeté), utilise
 * GET /v1/invoice/{invoiceId}/status-history (headers customer-id + Bearer) —
 * une réponse 201 de emitInvoice ne garantit PAS que la facture est valide,
 * seulement qu'elle a été prise en compte pour traitement asynchrone. Un
 * premier test a été rejeté avec status.code "UNACCEPTABLE" /
 * "UNKNOWN_INVOICE_FORMAT" faute de <cbc:CustomizationID>/<cbc:ProfileID>
 * (identifiants de profil PEPPOL BIS Billing 3.0) — ajoutés ci-dessous.
 */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405, env);
    }

    if (!env.IOPOLE_CLIENT_ID || !env.IOPOLE_CLIENT_SECRET || !env.IOPOLE_CUSTOMER_ID) {
      return json(
        { error: 'IOPOLE_CLIENT_ID, IOPOLE_CLIENT_SECRET ou IOPOLE_CUSTOMER_ID non configuré côté serveur.' },
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
      return json({ error: 'Authentification iopole (OAuth2) échouée.', detail: String(err) }, 502, env);
    }

    const ublXml = buildUblInvoice(invoice);
    const form = new FormData();
    form.append('file', new Blob([ublXml], { type: 'application/xml' }), `${invoice.numero}.xml`);
    form.append('type', 'application/xml');

    const iopoleUrl = env.IOPOLE_API_URL || 'https://api.ppd.iopole.fr/v1/invoice';
    const headers = {
      accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'customer-id': env.IOPOLE_CUSTOMER_ID,
    };

    let iopoleResponse;
    try {
      iopoleResponse = await fetch(iopoleUrl, { method: 'POST', headers, body: form });
    } catch (err) {
      return json({ error: 'Impossible de joindre iopole.', detail: String(err) }, 502, env);
    }

    const bodyText = await iopoleResponse.text();
    return new Response(bodyText, {
      status: iopoleResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
  },
};

async function getAccessToken(env) {
  const tokenUrl =
    env.IOPOLE_TOKEN_URL || 'https://auth.ppd.iopole.fr/realms/iopole/protocol/openid-connect/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.IOPOLE_CLIENT_ID,
    client_secret: env.IOPOLE_CLIENT_SECRET,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  <cbc:IssueDate>${invoice.date_emission || new Date().toISOString().slice(0, 10)}</cbc:IssueDate>
  ${invoice.date_echeance ? `<cbc:DueDate>${invoice.date_echeance}</cbc:DueDate>` : ''}
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
