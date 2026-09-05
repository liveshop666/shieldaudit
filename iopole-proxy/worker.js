/**
 * Relais sécurisé entre la page Facture de ShieldAudit et l'API iopole.
 *
 * La clé API iopole ne doit JAMAIS être placée dans index.html : ce fichier
 * HTML est public, donc toute clé qui s'y trouverait serait visible par
 * n'importe qui (menu "Afficher le code source"). Ce worker tourne côté
 * serveur (Cloudflare) : la clé est stockée comme secret et n'est jamais
 * envoyée au navigateur.
 *
 * Endpoint et format de payload à confirmer avec la documentation officielle
 * iopole (https://api.iopole.com/v1/api, accessible après création d'un
 * compte développeur) : adapter IOPOLE_API_URL et la forme du corps de
 * requête si besoin une fois la doc en main.
 */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405, env);
    }

    if (!env.IOPOLE_API_KEY) {
      return json({ error: 'IOPOLE_API_KEY non configurée côté serveur.' }, 500, env);
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

    const iopoleUrl = env.IOPOLE_API_URL || 'https://api.iopole.com/v1/invoices';
    let iopoleResponse;
    try {
      iopoleResponse = await fetch(iopoleUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.IOPOLE_API_KEY}`,
        },
        body: JSON.stringify(invoice),
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
