# Relais iopole pour ShieldAudit

`index.html` est une page 100% statique : tout son code est visible par
n'importe qui via "Afficher le code source". On ne peut donc **jamais** y
mettre une clé API iopole en clair — elle serait immédiatement récupérable
par un tiers. La solution : un petit serveur (ici un Cloudflare Worker
gratuit) qui garde la clé et relaie la demande vers iopole. `index.html`
n'appelle que ce relais, jamais iopole directement.

## Étape 1 — Créer un compte iopole et obtenir une clé API

1. Va sur https://www.iopole.com et crée un compte dans l'espace
   développeurs.
2. Récupère une clé API (mode test/sandbox pour commencer).
3. Note l'URL exacte de l'endpoint d'envoi de facture dans leur documentation
   (https://api.iopole.com/v1/api) — elle peut différer de la valeur par
   défaut mise dans `worker.js` (`https://api.iopole.com/v1/invoices`), tout
   comme le format exact du corps JSON attendu. Adapte `worker.js` en
   conséquence si besoin.

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
4. Configure la clé secrète (elle ne sera jamais visible dans le code) :
   ```
   npx wrangler secret put IOPOLE_API_KEY
   ```
   puis colle ta clé iopole quand c'est demandé.
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

## Sécurité

- La clé API n'est **jamais** commitée dans ce dépôt : elle vit uniquement
  dans les secrets Cloudflare (`wrangler secret put`).
- `ALLOWED_ORIGIN` dans `wrangler.toml` peut être restreint à l'URL exacte où
  `index.html` est hébergé, pour empêcher d'autres sites d'utiliser ton
  relais.
