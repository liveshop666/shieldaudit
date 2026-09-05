# Relais iopole pour ShieldAudit

`index.html` est une page 100% statique : tout son code est visible par
n'importe qui via "Afficher le code source". On ne peut donc **jamais** y
mettre une clé API iopole en clair — elle serait immédiatement récupérable
par un tiers. La solution : un petit serveur (ici un Cloudflare Worker
gratuit) qui garde la clé et relaie la demande vers iopole. `index.html`
n'appelle que ce relais, jamais iopole directement.

## Étape 1 — Créer un compte iopole et obtenir une clé API + un customer-id

1. Va sur https://www.iopole.com, crée un compte dans l'espace développeurs
   et active un Sandbox (environnement de test gratuit, isolé).
2. Récupère ta clé API de sandbox.
3. Termine l'enrôlement (KYC/KYB) de ShieldAudit sur iopole pour obtenir ton
   **customer-id** (un UUID) — l'API d'émission de facture en a besoin en
   plus de la clé API.
4. Dans la doc (https://docs.iopole.com/docs/iopole-api/reference, page
   « Send invoice » / emitInvoice), vérifie :
   - l'URL exacte de l'endpoint (par défaut ici :
     `https://api.ppd.iopole.fr/v1/invoice` en sandbox) ;
   - que le format attendu est toujours un `multipart/form-data` avec un
     champ `file` + un champ `type` (c'est ce que `worker.js` envoie
     actuellement, avec `type: application/json` et le contenu de la facture
     en JSON dans `file`).
   Adapte `IOPOLE_API_URL` (dans `wrangler.toml`) ou `worker.js` si la doc
   montre autre chose.

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
   puis colle ta clé iopole, puis ton customer-id, quand c'est demandé.
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

L'émission de facture chez iopole est **asynchrone** : une réponse réussie
contient un `guid`, pas une confirmation immédiate d'acceptation. Le suivi
du statut (via l'API ou un webhook iopole) n'est pas encore implémenté ici —
pour l'instant, le bouton « Envoyer à iopole » confirme seulement que la
requête a été acceptée par iopole (guid reçu), pas que la facture est
validée/transmise aux impôts. À ajouter une fois la doc de suivi de statut
consultée dans ton espace développeur.

## Sécurité

- La clé API et le customer-id ne sont **jamais** commités dans ce dépôt :
  ils vivent uniquement dans les secrets Cloudflare (`wrangler secret put`).
- `ALLOWED_ORIGIN` dans `wrangler.toml` peut être restreint à l'URL exacte où
  `index.html` est hébergé, pour empêcher d'autres sites d'utiliser ton
  relais.
