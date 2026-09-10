# Relais SUPER PDP pour ShieldAudit

Même principe que `iopole-proxy/` : `index.html` est une page 100% statique
et publique — on ne peut donc jamais y mettre une clé API en clair. Ce
Cloudflare Worker garde les secrets et relaie la demande vers l'API SUPER
PDP. C'est un relais **séparé** de celui d'iopole : les deux peuvent
coexister, rien ne casse si l'un des deux ne fonctionne pas.

## Étape 1 — Créer l'application dans le bac à sable SUPER PDP

1. Va sur le portail SUPER PDP, choisis **Développeur·euse** (Bac à sable) —
   aucune vérification d'identité requise.
2. Dans **Bac à sable → Applications**, crée une nouvelle application :
   - Entreprise : une des deux entreprises de test (ex: "Burger Queen")
   - URLs de redirection : laisser vide (on n'utilise pas le flux navigateur)
   - Type d'application : **Confidentielle**
3. Note l'**Identifiant (client_id)** et le **Secret (client_secret)**
   affichés — le secret n'est montré qu'une seule fois.

## Étape 2 — Déployer le relais sur Cloudflare Workers (gratuit)

Depuis ce dossier `superpdp-proxy/`, exécute :
```
npx wrangler login
npx wrangler deploy
```
Puis configure les secrets :
```
npx wrangler secret put SUPERPDP_CLIENT_ID
npx wrangler secret put SUPERPDP_CLIENT_SECRET
```
et colle les valeurs notées à l'étape 1.

À la fin du `deploy`, Cloudflare affiche une URL du type
`https://shieldaudit-superpdp-proxy.<ton-compte>.workers.dev`. Garde-la.

## Étape 3 — Brancher `app/index.html` sur ce relais

Une fois l'URL obtenue, on pourra ajouter un second bouton « Envoyer à SUPER
PDP » sur la page Facture, à côté de celui d'iopole, pointant vers cette
URL — pour comparer les deux en bac à sable avant de choisir.

## Ce que dit la doc officielle (fichier OpenAPI fourni)

- **Authentification** : OAuth2 `client_credentials`, comme iopole. Échange
  `client_id` + `client_secret` contre un `access_token` auprès de
  `https://api.superpdp.tech/oauth2/token`.
- **Envoi de facture** : `POST https://api.superpdp.tech/v1.beta/invoices`,
  corps en XML (UBL ou CII) avec `Content-Type: application/xml`, ou PDF
  Factur-X. Réponse `200` avec un objet facture contenant un `id` à
  conserver pour suivre le statut (route `/v1.beta/invoice_events`).
- L'entreprise associée à la facture est déterminée automatiquement par le
  `client_id` utilisé (celui généré pour "Burger Queen" à l'étape 1) — pas
  besoin d'en-tête supplémentaire pour ce cas simple.

⚠️ **Compliance** : comme pour iopole, le générateur UBL de `worker.js` est
minimal — teste d'abord dans le bac à sable, ajuste selon les erreurs de
validation retournées, avant tout envoi réel.
