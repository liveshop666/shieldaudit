---
name: shieldaudit
description: Contexte complet, état actuel et leçons apprises pour travailler sur ShieldAudit (site shieldaudit.pro, rapport terrain, App Terrain). À lire AVANT toute modification de ce dépôt — design, textes, app, rapport, mentions légales, fusion, captures d'écran — et pour reprendre le travail là où la session précédente s'est arrêtée sans rien perdre.
---

# ShieldAudit — reprise de session et méthode

## Le client et le métier
- Rudy Fremont, ShieldAudit, Caen. Conseil en sécurité retail : on **simule un voleur** pour
  trouver les failles d'un magasin. Ce n'est PAS une société de gardiennage
  (ne jamais écrire « agents de sécurité » / « personnel de sécurité »).
- Téléphone 06 59 96 08 77 · shieldaudit@tutamail.com · SIRET 751 655 390 00035.
- Prix : **« Sur devis »** sur le site (ne pas afficher de prix fixe).
- Il écrit en français, souvent dicté à la voix (fautes, « euh ») : comprendre l'intention,
  répondre en français simple et court, sans jargon technique.

## Le dépôt (liveshop666/shieldaudit, GitHub Pages, domaine shieldaudit.pro)
| Fichier | Rôle | Lien en ligne |
| --- | --- | --- |
| `index.html` | Site vitrine (FAQ accordéon, compteurs animés, Schema.org/OG, favicon) | https://shieldaudit.pro/ |
| `mentions-legales.html` | Mentions légales (articles 1 à 4 seulement) | https://shieldaudit.pro/mentions-legales.html |
| `rapport_terrain_shieldaudit.html` | Rapport d'audit terrain : failles, gravité, photos, signatures, PDF (`genPDF()`), sauvegarde auto localStorage `sa_rapp3`, bouton `refreshApp()`, champ « Durée sans intervention » (`f.dur`) | https://shieldaudit.pro/rapport_terrain_shieldaudit.html |
| `app/index.html` | App Terrain : tableau de bord, Suivi clients (localStorage `sa_state`, export CSV, commission 10 % + ligne total), Devis, Contrat + signatures, Facture (boutons iopole / SUPER PDP), DCS, sauvegarde export/import, impression | https://shieldaudit.pro/app/ |
| `iopole-proxy/`, `superpdp-proxy/` | Workers Cloudflare pour la facturation électronique | — |

Quand il demande « les 3 liens » : site, rapport terrain, app (tableau ci-dessus).

## État au 10/10/2026 (tout est fusionné sur `main`)
- PR #65 : refonte design « Wise » des 4 pages (voir design system ci-dessous).
- PR #66 : **partie RGPD supprimée** à sa demande (articles 5 à 8 : confidentialité,
  cookies, droits, CNIL). Il a été prévenu qu'une politique de confidentialité reste en
  principe obligatoire ; ne pas la remettre sans qu'il le demande. Restauration possible
  depuis le commit 3a38a32 (`mentions-legales.html`).
- PR #64 : suppression du paragraphe « démarque inconnue ».
- Rien en cours sur ShieldAudit.
- Stockly (autre dépôt, `liveshop666/stockly`, compétence `stockly-app`) : une demande de
  code OTP à 6 chiffres a été **annulée** par lui (« ne fais rien je me suis trompé »).
  Ne pas la reprendre sans nouvelle demande. Ne jamais confondre les deux projets :
  « Mes inventaires », Supabase, SIRET à l'inscription = Stockly, pas ShieldAudit.

## Design system actuel (« Wise »)
Jetons centralisés dans `:root` de chaque page, avec alias historiques
(`--noir`, `--vert`, `--blanc`, `--gris`, `--border`…) que le HTML/JS utilise encore :
ne pas supprimer les alias.
- Couleurs : Forest `#163300` · Lime `#9fe870` · Spruce `#054d28` · Mist `#e2f6d5` ·
  Signal Blue `#0b4c72` · Alarm Red `#cb272f` · Obsidian `#0e0f0c` · Charcoal `#454745` ·
  Slate `#6a6c6a` · Pebble `#868685` · Fog `#e8ebe6` · Paper `#fff`. theme-color `#163300`.
- Typo : Inter (400 à 900), titres 900 avec interlettrage négatif.
- Formes : pilules 9999px (boutons, tags, onglets), champs 10px, cartes 16px, grandes
  cartes 28px, ombre « ring » `rgba(14,15,12,.12) 0 0 0 1px`.
- Rythme des sections du site : blanc → menthe → vert forêt. CTA principal = pilule lime
  texte forest.
- Gravité des failles : critique = rouge plein texte blanc · élevée = forest texte lime ·
  moyenne = mist texte forest (même code dans le PDF généré, avec
  `print-color-adjust:exact`).
- Statuts clients : prospect fog · RDV contour forest · devis envoyé mist · signé lime ·
  terminé forest/lime · perdu barré.
- Encarts « astuce/attention » : fond `#e6f0f6`, bordure `#b9d3e3`, texte `#0b4c72`.
- Rapport : la barre du haut doit rester à ~52px (`.tabs` est collant à `top:52px`).

## Leçons apprises (ne pas répéter ces erreurs)
1. **Faire exactement ce qui est demandé, rien de plus.** « Change le design » = aucun
   texte, aucune fonction modifiée, pas de traduction, pas de nouvelle section. Il s'est
   énervé quand des changements partiels ou non demandés ont été faits.
2. **Avant chaque modification, repartir de `main`** : les PR sont fusionnées en squash,
   donc l'ancienne branche est périmée. Un rebase a failli effacer des fonctions (bouton
   Rafraîchir, champ durée).
   `git fetch origin main && git checkout -B claude/iopole-api-integration-gdjj9a origin/main`
   puis commit, puis `git push --force-with-lease -u origin <branche>`.
3. **Il veut que ce soit fusionné** (« fusionne », « je valide ») : PR brouillon → passer
   en prêt (`draft:false`) → fusion squash. Quand il demande une modification du site sans
   préciser, la mise en ligne est implicite ; en cas de doute réel, demander.
4. **Vérifier visuellement avant de livrer** : `python3 -m http.server <port>` + Playwright
   (`chromium.launch({executablePath:'/opt/pw-browsers/chromium'})`), captures bureau
   1280px ET mobile 390px, page entière découpée en morceaux pour la relecture. Pour le
   rapport, remplir des failles de test (critique/élevée/moyenne) et ouvrir le PDF ; pour
   l'app, injecter des clients de test dans `sa_state` via `addInitScript`. Lui envoyer
   2 à 4 captures, pas plus.
5. `pkill -f "http.server …"` renvoie le code 144 et **interrompt toute la chaîne `&&`** :
   l'exécuter dans une commande séparée.
6. L'erreur de certificat Google Fonts dans le bac à sable est sans importance.
   shieldaudit.pro n'est pas joignable depuis le bac à sable : ne pas prétendre avoir
   vérifié le site en ligne.
7. Couleurs écrites en dur dans les styles inline et les gabarits JS (PDF, impression,
   badges `cssText`) : après un changement de palette, faire un `grep` des anciens hex et
   des polices, et vérifier chaque fond sombre (texte devenu invisible : ex. « Audit » en
   forest sur fond forest dans le DCS).
8. Mentions légales / RGPD : prévenir une fois du risque légal, puis respecter son choix.
   Demander précisément quoi supprimer (partie, page entière, lien) avant de supprimer.
9. Artifacts (démos) : scripts uniquement depuis cdnjs/jsdelivr/unpkg, CSS/JS en ligne,
   pas d'import map en data-URI. Il veut voir le résultat directement dans le panneau :
   publier en Artifact plutôt qu'envoyer un fichier .docx.
10. Économie de jetons : ne pas relire des fichiers entiers inutilement (`grep -n` ciblé,
    `sed -n` sur des plages), pas de longs récapitulatifs, réponses courtes.

## Méthode type pour une demande
1. Repartir de `main` (leçon 2).
2. Repérer avec `grep -n` les lignes concernées, modifier au plus juste.
3. Vérifier (captures bureau + mobile, aucune `pageerror` dans la console).
4. Commit avec l'attribution demandée par la session, push, PR, fusion.
5. Répondre en français : ce qui a changé, le lien, et le délai de mise en ligne
   (1 à 2 minutes, conseiller d'actualiser la page).
