# placedupermis.fr — comparateur national des auto-écoles

V1 générée le 19/07/2026. Pipeline 100 % scriptable : sources officielles → JSON → site statique Netlify.

## 1. Les sources (vérifiées, réelles)

| Source | Contenu | Clé | Millésime | Licence | MàJ |
|---|---|---|---|---|---|
| [Carte officielle des auto-écoles](https://autoecoles.securite-routiere.gouv.fr/) — CSV `certified-schools/auto-ecoles.csv` | **11 371 écoles actives** : agrément, raison sociale, adresse, dept, flags (label qualité, 1 €/j, asso, AAC, CS, en ligne), taux de réussite B/A/CD 1ʳᵉ présentation + volume candidats + détail AAC/CS/xᵉ présentation (82 colonnes) | `raf_numero` (agrément RAFAEL) | exams 01/01–31/12/2025, extraction RAFAEL 22/01/2026, publication 16/02/2026 | Licence Ouverte 2.0 | **mensuelle** |
| Même URL, snapshot [Wayback 27/06/2023](https://web.archive.org/web/20230627101025/https://autoecoles.securite-routiere.gouv.fr/sites/default/files/certified-schools/auto-ecoles.csv) | 11 978 écoles, taux ≈ exams 2022 (⚠ taux renseignés seulement pour ~2 900 labellisées ; `0` = donnée absente) | idem | ≈ 2022 | idem | figé |
| [Taux de réussite par auto-école 2018](https://www.data.gouv.fr/datasets/taux-de-reussite-auto-ecole-par-auto-ecole-en-2018) (XLS, DSR) | 13 301 écoles, NB + TR par catégorie fine (A1, A2, B, B1, BE, C+C1, CE+C1E, D+D1+DE) | `N° Agrément` (même format) | exams 2018 | Licence Ouverte 2.0 | figé |
| [BAN / api-adresse](https://adresse.data.gouv.fr/) `/search/csv/` | géocodage en masse : lat/lon, score, précision, code INSEE commune | adresse+CP+commune | — | Licence Ouverte | service |
| Dataset data.gouv « [Liste des auto-écoles et taux de réussite](https://www.data.gouv.fr/datasets/liste-des-auto-ecoles-et-taux-de-reussite-au-permis-de-conduire) » | pointe vers le même CSV que la carte officielle | — | — | LO 2.0 | mensuelle |

**Ce qui n'existe pas** (vérifié) : pas de base nationale ouverte des agréments hors ce CSV (les arrêtés préfectoraux sont épars, quelques départements publient sur data.gouv : Loire-Atlantique, Eure-et-Loir…) ; pas de millésimes annuels officiels 2019-2024 par école (le seul historique = 2012 communautaire, 2018 XLS, snapshots Wayback 2023 & 2026). L'API interne de la carte (`/api/driving-school/{id}`) expose aussi tél./détails mais le CSV suffit.

**Conséquence stratégique** : l'historique se construit **au fil de l'eau** — le CSV est mensuel, chaque `fetch_sources.py` archive un snapshot daté dans `data/raw/snapshots/`. Dans un an, le site aura un historique que personne ne pourra reconstituer. C'est l'actif défensif.

## 2. Historique — modèle de données

Fiche = agrément (`raf_numero`). Une école qui déménage/change de gérant change d'agrément → nouvelle fiche (comportement identique au registre officiel).

- `stats.{B|A|CD}.{année}` : `{n, tx, tx_aac, tx_cs, tx_xpra}` — clés absentes si NC (secret statistique : petits effectifs).
- `first_seen` / `last_seen` : bornes de présence au registre.
- `status` : `active` (présente au dernier millésime) / `closed` (disparue → bandeau « probablement fermée », fiche conservée = longtail SEO + preuve d'historique).
- Millésime 2022 : `tx == 0` traité comme absent (seules les labellisées avaient un taux publié).
- 2018 : catégories fines agrégées en familles (C+CE+D → CD) avec moyenne pondérée par candidats.

Chiffres actuels : 21 349 fiches (11 371 actives + 9 978 fermées), 4 626 fiches avec ≥ 3 points d'historique, 1 436 actives avec B complet 2018+2022+2025.

## 3. Matching & géo

- **Jointure** entre millésimes : sur `raf_numero` strict — zéro ambiguïté, c'est la clé du registre. 8 003 communes 2023∩2025, 7 298 de 2018 retrouvées.
- **Homonymes / multi-locaux** : slug = `nom-ville`, suffixé de l'agrément complet en cas de collision (ex. `alpha-auto-ecole-ceyzeriat-e1500100190`).
- **Géocodage** : BAN bulk = 99,6 % de réussite (11 324/11 371 ; 47 échecs, surtout adresses DOM non normalisées — fallback possible : centroïde commune).
- **« Autour de [ville] »** : grille spatiale 0,1° + distance haversine ; fiches → 6 écoles < 25 km ; pages ville → villes voisines < 30 km.

## 4. Schéma de fiche (data/schools.json)

```json
{
  "id": "E1406900130",
  "slug": "saint-jerome-lyon",
  "name": "SAINT JEROME",
  "status": "active",
  "first_seen": 2018, "last_seen": 2025,
  "address": {"line1": "18 RUE SAINT JEROME", "postcode": "69007", "city": "LYON",
               "dept": "69", "lat": 45.75, "lon": 4.83, "geo_score": 0.97,
               "geo_precision": "housenumber", "citycode": "69387"},
  "contact": {"website": null},
  "flags": {"label_qualite": false, "permis_1euro": false, "asso": false,
             "aac": false, "cs": true, "en_ligne": false},
  "categories": ["B"],
  "stats": {"B": {"2018": {"n": 67, "tx": 0.5672},
                   "2022": {"tx": 0.5, "tx_xpra": 0.3913},
                   "2025": {"n": 42, "tx": 0.6667, "tx_aac": 0.75, "tx_xpra": 0.7}}},
  "claim": {"claimed": false, "premium": false, "overrides": {}}
}
```

`claim.overrides` accueillera les champs self-service (téléphone, horaires, tarifs, photos, lien résa) — **jamais** les champs officiels.

## 5. Self-service propriétaire

- Bloc « Revendiquer cette fiche » sur chaque fiche → `/revendiquer/?e={agrément}`.
- V1 : formulaire externe (Tally/Formspark) → Sheet « claims » ; vérification légère : email pro du domaine du site déclaré, ou justificatif d'agrément ; à terme code postal envoyé par courrier (comme Google Business).
- Le pipeline lit la Sheet claims à chaque build et fusionne dans `claim.overrides` → statique, zéro backend. Stripe Payment Links pour le premium (comme les coachs parcoursioux).
- Champs modifiables : contact, horaires, tarifs, photos, description, lien réservation. Verrouillés : agrément, taux, volumes, statut registre.

## 6. Plan V1 & indexation

**26 097 URLs** : 1 accueil + 104 départements + 4 643 villes + 21 349 fiches (+ 3 pages fixes).

- Arbo : `/` → `/departement/{dd}/` → `/ville/{dd}-{ville}/` → `/auto-ecole/{slug}/`.
- Classements : permis B 1ʳᵉ présentation, **seuil ≥ 20 candidats** (défendable, affiché), les autres listées sous le classement.
- Sitemaps découpés (40 k/fichier) + maillage interne fort (fil d'ariane, villes voisines, écoles proches).
- Indexation progressive recommandée : soumettre d'abord sitemap villes+departements, fiches ensuite (GSC), pour ne pas griller le crawl budget d'un domaine DR 0.
- JSON-LD : `DrivingSchool` (fiches), `ItemList` (villes).
- Monétisation en place : encart affiliation code en ligne (`/go/code-en-ligne` à brancher sur ton lien), bloc revendication sur 21 349 fiches.

## Lancer

```bash
cd pipeline
python3 fetch_sources.py        # télécharge + snapshot + géocode BAN (~1 min)
python3 build_db.py             # fusionne les millésimes → data/schools.json
cd ../site && python3 generate.py   # → site/dist/ (~30 s, 26 097 pages, 268 Mo)
# déploiement : netlify deploy --dir=dist --prod
```

Dépendances : Python 3.9+, `pandas`+`xlrd` (uniquement pour le XLS 2018).

## Reste à faire (V1.1)

- [ ] Brancher le lien d'affiliation réel sur `/go/code-en-ligne` (redirection Netlify `_redirects`)
- [ ] Formulaire de revendication (Tally) + pipeline claims
- [ ] Fallback géocodage des 47 échecs DOM (centroïde commune)
- [x] Pages arrondissements Paris/Lyon/Marseille — fait le 07/08/2026 : pages agrégées `/auto-ecoles/paris-75/`, `/lyon-69/`, `/marseille-13/` (tous arrondissements confondus), compteur homepage corrigé, sitemap à jour.
- [ ] Analytics Umami + GSC + déploiement Netlify + snapshot mensuel (cron / GitHub Actions)
- [x] Classement régional — fait le 08/08/2026 : `DEPT_TO_REGION` (mapping officiel géo.api.gouv.fr, 13 régions métropolitaines + 5 DROM + 3 COM sans statut régional regroupées à part), pages `/region/{slug}/` (même modèle que département), index `/regions/`, liens ajoutés au fil d'ariane département, au footer et au sitemap.
- [x] Recherche par distance — fait le 08/08/2026 : la barre de recherche homepage est un vrai formulaire (Entrée ou clic "Rechercher" → `/recherche/?q=...`), page dédiée qui géocode la requête via l'API Adresse (BAN) et trie les villes les plus proches par distance réelle (haversine côté client), avec repli sur la correspondance texte si le géocodage échoue. Page en `noindex` (contenu 100% généré côté client, pas pertinent à indexer).
- [x] Page `/revendiquer/` nettoyée — fait le 08/08/2026 : retiré l'affichage du n° d'agrément et le paragraphe "à venir" ; bouton "Envoyer ma demande" redesigné (pleine largeur, style navy cohérent).
- [ ] **Email de revendication avec CC à l'auto-école** — fait le 08/08/2026 côté code, mais nécessite une action manuelle avant de fonctionner en prod : `netlify/functions/submission-created.js` a été créé (déclenché automatiquement par Netlify à chaque soumission du formulaire `/revendiquer/`, envoie l'email vers l'admin avec l'auto-école en copie via l'API Resend), et `netlify.toml` pointe désormais vers `netlify/functions`. Pour l'activer :
  1. Créer un compte sur [resend.com](https://resend.com) (gratuit jusqu'à un certain volume).
  2. Vérifier un domaine d'envoi dans Resend (ex: `placedupermis.fr` ou un sous-domaine `mail.placedupermis.fr`) — ajoute les enregistrements DNS que Resend demande. Tant que le domaine n'est pas vérifié, Resend ne peut envoyer qu'à l'adresse du compte Resend lui-même, donc pas utilisable pour de vrais envois aux auto-écoles.
  3. Récupérer une clé API Resend.
  4. Dans Netlify → Site settings → Environment variables, ajouter : `RESEND_API_KEY` (la clé), `ADMIN_EMAIL` (l'adresse qui doit recevoir les demandes), `FROM_EMAIL` (l'adresse expéditrice, doit appartenir au domaine vérifié à l'étape 2).
  5. Redéployer — la fonction lira ces variables automatiquement.
  Tant que ces variables ne sont pas définies, le formulaire continue de fonctionner normalement (Netlify Forms enregistre toujours la soumission dans son dashboard), seul l'email automatique avec CC ne partira pas.

### Offre pro /pro/ (en cours, 07-08/08/2026)

- [x] Page `/pro/` refaite : 3 cartes (gratuit / early bird 9€ mois·79€ an / standard 19€ mois·169€ an), FAQ, aucune option payante ne touche au classement organique.
- [x] Design du badge « Indice PlaceDuPermis » (badge web actif/inactif + sticker QR imprimable) finalisé et illustré sur `/pro/` avec un exemple statique (Annecy, puis Haute-Savoie).
- [x] Badge : logique de sélection du meilleur classement — fait le 08/08/2026 : `best_classement_text()` dans `site/generate.py` compare le percentile (rang/total) sur département, région et national pour une école donnée et retourne le plus flatteur. Fonctionne dès maintenant sur données réelles (dept_ranks/region_ranks/nat_ranks) ; l'exemple statique sur `/pro/` reste illustratif (école fictive), mais la fonction est prête pour le vrai pipeline par école ci-dessous.
- [ ] Créer les 2 Stripe Payment Links (early bird 9€/mois, standard 19€/mois) et les coller dans `STRIPE_EARLY_URL` / `STRIPE_LATE_URL` en tête de `site/generate.py` — tant que c'est vide, les boutons retombent sur un mailto.
- [ ] Repasser `EARLY_BIRD_OPEN` à `False` une fois les 100 places de lancement prises (pas de compteur en direct, décision manuelle).
- [ ] Construire le vrai pipeline badge/QR par école : `data/abonnements.json` (agrément → actif/inactif), génération de `/badge/<slug>.svg` pour chaque partenaire à chaque build (en appelant `best_classement_text()`, déjà prêt), dégradation propre (pas de lien cassé) si l'abonnement s'arrête. Pas commencé — seul l'exemple statique existe pour l'instant.
- [ ] Installer la dépendance `qrcode` sur toute machine qui buildera le site (`python3 -m pip install --user --break-system-packages qrcode` sur macOS/Homebrew) — sans elle, le build ne casse pas mais génère un rectangle gris à la place du QR.
- [ ] Construire le vrai bouton « Être rappelé » promis sur `/pro/` (08/08/2026) : formulaire type Netlify Forms (sur le modèle de `/revendiquer/`) déclenché depuis le classement à côté de la ligne d'une école Partenaire, qui route la demande (email ou téléphone du candidat) vers l'école. Dépend du même `data/abonnements.json` que le badge. Pour l'instant c'est une promesse commerciale sur `/pro/`, pas une fonctionnalité construite — à livrer avant le premier abonné payant. **Priorité n°1 côté offre pro tant qu'il n'y a pas d'autre argument de valeur.**
- [ ] (Plus tard, pas maintenant — 08/08/2026) Idée écartée pour l'instant : afficher aux auto-écoles des données sur les fiches concurrentes à 5 km. Techniquement facile (grille spatiale déjà utilisée pour « Autour de [ville] », section 3 de ce document), mais sans trafic réel ça ne montrerait qu'une liste statique de concurrents — anxiogène, pas un argument de vente. À reconsidérer une fois que les statistiques de consultation de fiche (déjà dans l'offre payante) auront du répondant.
