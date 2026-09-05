# placedupermis.fr — Propositions V2 (UX, data, SEO/GEO)

À valider avant recodage du générateur. Deux maquettes jointes : `maquette-ville-lyon.html` et `maquette-fiche-ecole.html` (vraies données Lyon).

---

## 1. Le principe directeur : penser « décision », pas « annuaire »

Celui qui tape « auto-école Lyon » a une décision à 1 500 € à prendre et trois angoisses : *me faire avoir sur le prix, échouer à l'examen, attendre des mois*. Le site doit répondre comme un conseiller, pas comme une liste. Chaque page doit donner un **verdict** (que choisir, pourquoi), pas juste des chiffres. C'est ce qui nous différencie de VroomVroom (annuaire + avis, données molles) et de Codeclic (classement statique sans méthode).

## 2. UX — ce qui change (visible dans les maquettes)

**Page ville** (la money page, 80 % du trafic SEO attendu) :
- Hero sombre avec KPIs du marché local → crédibilité immédiate + citable par les IA.
- **Cartes** au lieu d'un tableau : rang, badges (« Top 31 % national », « ↗ +16,7 pts », « Label »), score coloré, volume, AAC — scannable sur mobile en 5 s.
- **Filtres sticky** (conduite accompagnée, label, moto, en progression) + tri (taux, volume, progression, distance).
- **Comparateur** : cocher 2-3 écoles → tableau côte à côte (unique sur le marché).
- Carte OSM en colonne droite (desktop), masquée sur mobile.
- FAQ locale en bas (schema FAQPage) + bloc « marché lyonnais » avec les stats maison.

**Fiche école** (la longtail, 21 000 pages) :
- H1 orienté question (« que valent vraiment ses résultats ? ») — matche les requêtes « avis [école] ».
- **Bloc verdict** : jauge + 4 phrases qui interprètent (rang ville, percentile national, écart à la moyenne, trajectoire, mise en garde volume). C'est le cœur : de la donnée transformée en jugement honnête.
- **Graphique d'évolution** école vs moyenne départementale (notre exclusivité multi-millésimes).
- Tableau détaillé par catégorie et par année, AAC/2ᵉ présentation, avec les « — » expliqués.
- « Si vous hésitez encore » : 3 alternatives proches mieux notées → maillage interne + honnêteté qui crée la confiance.
- FAQ par école (générée depuis les données : « est-elle bonne ? », « pourquoi 2022 plus bas ? ») — c'est massivement ce que les IA citent.

## 3. Data — les infos différenciantes (calculées, vérifiées)

Déjà calculables avec nos données, personne d'autre ne les publie :

| Info | Valeur | Usage |
|---|---|---|
| **Percentile national** par école (parmi 7 592 classables, n≥20) | p10 = 44,7 %, médiane = 61,1 %, p90 = 75,5 % | badge « Top X % » sur chaque fiche |
| **Trajectoire** 2018 → 2022 → 2025 par école | 4 626 fiches avec ≥3 points | graphique + badge « en progression » |
| **Avantage AAC** | **+12,2 pts** en moyenne (5 936 écoles) | argument éditorial national + par école |
| **Churn du secteur** | 3 975 fermetures depuis 2022, 3 219 créations | pages « écoles fermées », alerte fraîcheur |
| **Tendance nationale** | 58,0 % (2018) → 60,3 % (2025), candidats **−32 %** (1,41 M → 964 k, essor du candidat libre) | page « Statistiques du permis » linkbait |
| Moyennes départementales par millésime | ex. Rhône 50,9 % → 56,3 % | ligne de référence des graphiques |
| Taux 2ᵉ présentation vs 1ʳᵉ | par école | détecte les écoles qui « présentent tôt » |

À ajouter ensuite (sources vérifiées) :
- **Bilans annuels DSR (PDF)** 2018-2024 : stats départementales année par année → densifie les courbes de référence (extraction pdfplumber, une fois).
- **INSEE population 15-29 par commune** : indicateur de tension « écoles pour 1 000 jeunes ».
- **Prix** : aucune source officielle par école. Stratégie : fourchettes départementales éditoriales au début, puis **collecte via les fiches revendiquées** (le self-service devient notre source de prix exclusive — actif de données n°2).
- Champs API testés et vides (trainersNb, délais médians) : rien à en tirer, on n'en dépend pas.

## 4. SEO / GEO — devenir la référence citée

- **Titles orientés requête** : ville = « Meilleure auto-école à {ville} : classement {année} par taux de réussite » ; fiche = « {école} ({ville}) : taux de réussite, avis sur les chiffres, agrément ».
- **FAQPage + DrivingSchool + ItemList + BreadcrumbList** en JSON-LD partout.
- **Pages statistiques** (`/statistiques/permis-{dept}/`, `/statistiques/permis-france/`) : chiffres propres, graphiques, phrases citables — c'est ce que Google met en featured snippet et ce que ChatGPT/Perplexity citent avec lien. Notre méthodo publique (`/a-propos/`) renforce l'autorité (E-E-A-T).
- **GEO (IA)** : données datées et sourcées dans le HTML (tableaux, pas d'images), résumés « en une phrase » par page, `llms.txt`, page open-data qui republie nos agrégats (les IA adorent citer une « source de données »).
- **Arrondissements** Paris/Lyon/Marseille : pages dédiées via le CP (69007 ≠ 69001) — requêtes « auto-école lyon 7 » très qualifiées.
- Indexation par étages (déjà prévu) : départements + villes d'abord, fiches ensuite.

## 5. Monétisation dans l'UX (sans la polluer)

- Encart affiliation **contextuel** : « en attendant de vous décider » (fiche) / « pas encore trouvé ? » (ville) — jamais en premier écran, toujours `rel="sponsored"`.
- Bloc pro « Revendiquer ma fiche » avec **preuve de valeur** (« 9 300 consultations le mois dernier » via Umami par page) → pipeline premium Stripe.
- Le comparateur est aussi un slot premium naturel (« école mise en avant » marquée comme telle).

## 6. Ce que je recode si tu valides

1. Générateur V2 : design des maquettes, cartes, badges percentile/tendance, verdicts générés, FAQ auto, JSON-LD complet.
2. Comparateur (JS vanilla, données inline par ville).
3. Pages statistiques France + 104 départements avec graphiques.
4. Pages arrondissements (75/69/13).
5. Extraction des bilans DSR pour les courbes départementales annuelles.

Dis-moi ce que tu gardes / modifies (couleurs, ton des verdicts, seuil n≥20, place de l'affiliation…) et je lance la refonte.
