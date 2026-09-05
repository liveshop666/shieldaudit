# Relais iopole pour ShieldAudit

`index.html` est une page 100% statique : tout son code est visible par
n'importe qui via "Afficher le code source". On ne peut donc **jamais** y
mettre une clé API iopole en clair — elle serait immédiatement récupérable
par un tiers. La solution : un petit serveur (ici un Cloudflare Worker
gratuit) qui garde la clé et relaie la demande vers iopole. `index.html`
n'appelle que ce relais, jamais iopole directement.

## Étape 1 — Créer un compte iopole et obtenir une clé API

1. Va sur https://labs.iopole.io/ (bac à sable public et gratuit) ou
   https://www.iopole.com pour créer ton compte développeur / sandbox
   d'assurance qualité (environnement isolé, sans impact sur la production).
2. Récupère ta clé API de sandbox (Bearer token).
3. Si ton compte a un **customer-id** (UUID, lié à l'enrôlement KYC/KYB de
   ShieldAudit), note-le aussi — il est envoyé en en-tête mais listé comme
   optionnel par la doc iopole.

D'après la doc officielle (« Send invoice », `POST /v1/invoice`) :
- Bases : `https://api.ppd.iopole.fr` (assurance qualité / sandbox) et
  `https://api.iopole.com` (production).
- En-têtes : `Authorization: Bearer <clé>` (obligatoire), `customer-id`
  (optionnel), `accept: application/json`.
- Corps `multipart/form-data` avec un champ `file` : **seuls les formats PDF
  ou XML sont acceptés** (UBL, Factur-X, XRechnung, CII nativement — pas de
  JSON brut). `worker.js` génère donc une facture au format **UBL 2.1**
  (XML) à partir des champs du formulaire.
- Réponse `201` : `{ "type": "INVOICE", "id": "..." }` — l'appel est
  **asynchrone**, cet `id`/GUID sert à suivre le statut ensuite (webhook ou
  `GET /v1/status`). Erreurs possibles : `401` (auth), `403` (interdit),
  `413` (fichier > 50 Mo).

⚠️ **Compliance** : le générateur UBL de `worker.js` est minimal — il ne
couvre pas tout ce qu'exige la validation Schematron légale française
(notamment le **SIRET** de ShieldAudit et du client, absents du formulaire
Facture actuel). iopole rejette toute facture invalide et renvoie le détail
de l'erreur via notification de statut. Teste d'abord sur
https://labs.iopole.io/, ajuste le mapping dans `buildUblInvoice()`
(`worker.js`) selon les erreurs retournées, avant tout envoi réel aux
impôts.

## Étape 2 — Déployer le relais sur Cloudflare Workers (gratuit)

1. Crée un compte gratuit sur https://dash.cloudflare.com si tu n'en as pas.
2. Installe Node.js si ce n'est pas déjà fait (https://nodejs.org).
3. Depuis ce dossier `iopole-proxy/`, exécute :
   ```
   npx wrangler login
   npx wrangler deploy
   ```
   (`npx wrangler login` ouvre une page web pour connecter ton compte
   Cloudflare ; `deploy` publie le worker.)
4. Configure les secrets (ils ne seront jamais visibles dans le code) :
   ```
   npx wrangler secret put IOPOLE_API_KEY
   npx wrangler secret put IOPOLE_CUSTOMER_ID
   ```
   puis colle ta clé iopole, puis ton customer-id (si tu en as un — sinon
   passe cette seconde commande, le champ est optionnel), quand c'est
   demandé.
5. À la fin du `deploy`, Cloudflare affiche une URL du type
   `https://shieldaudit-iopole-proxy.<ton-compte>.workers.dev`. Garde-la.

## Étape 3 — Brancher `index.html` sur le relais

Dans `index.html`, cherche la ligne :
```js
const IOPOLE_PROXY_URL = 'https://REMPLACER-PAR-TON-URL-WORKER.workers.dev';
```
et remplace la valeur par l'URL obtenue à l'étape 2. Un nouveau bouton
« 📤 Envoyer à iopole » apparaît alors sur la page Facture ; il envoie les
données du formulaire au relais, qui les transmet à iopole avec la clé API.

## Suivi du statut (asynchrone)

L'émission de facture chez iopole est **asynchrone** : une réponse `201`
contient `{ "type": "INVOICE", "id": "..." }`, pas une confirmation
d'acceptation définitive. Le suivi du statut (via webhook iopole ou polling
de `GET /v1/status`) n'est pas encore implémenté ici — pour l'instant, le
bouton « Envoyer à iopole » confirme seulement que la requête a été reçue
par iopole, pas que la facture est validée et transmise aux impôts. À
ajouter une fois la doc de l'endpoint de statut consultée dans ton espace
développeur.

## Sécurité

- La clé API et le customer-id ne sont **jamais** commités dans ce dépôt :
  ils vivent uniquement dans les secrets Cloudflare (`wrangler secret put`).
- `ALLOWED_ORIGIN` dans `wrangler.toml` peut être restreint à l'URL exacte où
  `index.html` est hébergé, pour empêcher d'autres sites d'utiliser ton
  relais.
