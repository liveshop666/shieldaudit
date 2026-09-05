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
 * D'après la doc officielle iopole (docs.iopole.com/docs/iopole-api) :
 * - l'endpoint d'émission de facture (emitInvoice) attend un corps
 *   multipart/form-data avec un champ "file" (le document facture) et un
 *   champ "type" indiquant son format (iopole accepte JSON, PDF, UBL, CII,
 *   Factur-X, ZUGFeRD...) ; on envoie ici directement les données
 *   structurées de la facture en JSON.
 * - deux en-têtes sont requis : "Authorization: Bearer <clé>" et
 *   "customer-id: <uuid>" (l'identifiant obtenu lors de l'enrôlement
 *   KYC/KYB de ShieldAudit chez iopole, distinct de la clé API).
 * - l'appel est asynchrone : une réponse réussie renvoie un "guid" à
 *   conserver pour suivre le statut de la facture ensuite.
 * L'URL exacte de l'endpoint (IOPOLE_API_URL) est à confirmer dans ton
 * espace développeur iopole (sandbox : api.ppd.iopole.fr) et à ajuster
 * ci-dessous si elle diffère de la valeur par défaut.
 */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405, env);
    }

    if (!env.IOPOLE_API_KEY || !env.IOPOLE_CUSTOMER_ID) {
      return json({ error: 'IOPOLE_API_KEY ou IOPOLE_CUSTOMER_ID non configuré côté serveur.' }, 500, env);
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

    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(invoice)], { type: 'application/json' }), `${invoice.numero}.json`);
    form.append('type', 'application/json');

    const iopoleUrl = env.IOPOLE_API_URL || 'https://api.ppd.iopole.fr/v1/invoice';
    let iopoleResponse;
    try {
      iopoleResponse = await fetch(iopoleUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.IOPOLE_API_KEY}`,
          'customer-id': env.IOPOLE_CUSTOMER_ID,
        },
        body: form,
      });
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
