# placedupermis.fr : mise en ligne, domaine, email, mesure

Guide pas à pas. Durée totale estimée : 45 minutes, dont 30 d'attente DNS.

## 1. Netlify : un site séparé, étanche d'omyeu et parcoursioux

Un « site » Netlify par projet, même team : c'est la ségrégation qu'il faut (déploiements, domaines, formulaires et logs isolés). Ne jamais ajouter placedupermis.fr comme domain alias d'un site existant.

```bash
cd placedupermis
netlify login                      # si besoin
netlify init                       # répondre : Create & configure a new site
                                   # nom suggéré : placedupermis (team habituelle)
python3 site/generate.py           # build local
netlify deploy --dir=site/dist --prod
```

Le `netlify.toml` du projet fixe déjà publish=site/dist et les en-têtes. Vérifie dans l'interface Netlify que le site est bien un site NEUF (Site configuration > Site details) avant de brancher le domaine.

Avant le premier deploy : remplace les deux URLs placeholder dans `site/dist/_redirects` par tes deeplinks (ils sont régénérés par generate.py : modifie plutôt la section _redirects dans site/generate.py pour que ce soit permanent).

## 2. Domaine OVH → Netlify (sans casser le futur email)

Règle d'or : on GARDE la zone DNS chez OVH (on ne délègue pas les serveurs de noms à Netlify), sinon l'email OVH devient pénible à câbler. On pointe seulement le web vers Netlify.

1. Netlify > ton site > Domain management > Add a domain > `placedupermis.fr` (+ il proposera `www`).
2. OVH Manager > Noms de domaine > placedupermis.fr > Zone DNS :
   - Enregistrement `A` : domaine nu (champ vide) → `75.2.60.5` (l'IP du load balancer Netlify, affichée aussi dans l'écran Domain management).
   - Enregistrement `CNAME` : `www` → `<ton-site>.netlify.app.` (le nom exact affiché par Netlify, point final inclus).
   - Supprime les A/AAAA/CNAME par défaut d'OVH qui entrent en conflit (redirection vitrine OVH). NE TOUCHE PAS aux enregistrements MX ni SPF/TXT.
3. Attendre la propagation (5 à 60 min), puis Netlify provisionne le certificat HTTPS tout seul (Let's Encrypt). Active « Force HTTPS ».

## 3. Email edouard@placedupermis.fr, lisible dans Gmail

Ton domaine OVH inclut gratuitement le MX Plan (offre 5 Go incluse avec le .fr).

1. OVH Manager > Web Cloud > Emails > placedupermis.fr > Créer une adresse : `edouard@placedupermis.fr` (mot de passe fort, note-le). Crée aussi `contact@placedupermis.fr` (celle affichée sur le site), en boîte ou en simple redirection vers edouard@.
2. Vérifie dans la zone DNS que les MX OVH sont là (mx0.mail.ovh.net etc. : présents par défaut si tu n'as pas délégué les DNS, c'est pour ça qu'on les garde chez OVH).
3. Réception dans Gmail : Gmail > Paramètres > Voir tous les paramètres > Comptes et importation > « Consulter d'autres comptes de messagerie » > Ajouter :
   - Adresse : edouard@placedupermis.fr
   - Serveur POP : `ssl0.ovh.net`, port `995`, SSL coché
   - Identifiant : l'adresse complète ; mot de passe : celui de l'étape 1
   - Coche « Conserver une copie sur le serveur » si tu veux garder un backup côté OVH.
4. Envoi depuis Gmail : même écran > « Envoyer des e-mails en tant que » > Ajouter :
   - SMTP : `ssl0.ovh.net`, port `465`, SSL, même identifiants
   - Coche « Traiter comme un alias ».
5. Délivrabilité : dans la zone DNS OVH, vérifie le TXT SPF (`v=spf1 include:mx.ovh.com ~all`, présent par défaut). Ça suffit pour un email de contact ; DKIM se configure dans l'espace Emails OVH si tu veux le max.

Note : Gmail relève le POP toutes les ~30-60 min. Pour du temps réel, l'alternative est une simple redirection OVH edouard@ → tongmail@gmail.com + envoi « en tant que » via SMTP OVH (combo le plus simple, zéro délai).

## 4. Mesure : Umami (déjà câblé) + Search Console

Umami (cohérent avec ta stack et la promesse « sans cookie », pas de bandeau de consentement requis) :
1. cloud.umami.is > Add website > placedupermis.fr → copie le website ID.
2. Dans `site/generate.py`, en tête : `UMAMI_ID = "ton-id"`. Regénère, redéploie. Le script est injecté sur les 26 000 pages.
GA4 : possible en plus, mais il déclenche l'obligation de bandeau cookies ; je le déconseille au lancement, Umami suffit pour piloter.

Google Search Console :
1. search.google.com/search-console > Ajouter une propriété > type « Domaine » > placedupermis.fr.
2. Google donne un TXT `google-site-verification=...` → l'ajouter dans la zone DNS OVH (TXT, domaine nu). Vérifier.
3. Soumettre les sitemaps SELON LE CALENDRIER ci-dessous (pas tous le jour 1).
4. Bing Webmaster Tools ensuite (import direct depuis GSC en 2 clics) : Bing alimente ChatGPT search, utile pour le GEO.

## 5. Stratégie d'indexation : tout publier, soumettre par étages

Le site est publié en entier dès le jour 1 (pas de pages cachées : le maillage interne et l'expérience utilisateur en ont besoin). C'est la SOUMISSION à Google qui est progressive, via les 4 sitemaps générés :

| Étape | Quand | Sitemap | Volume |
|---|---|---|---|
| 1 | Jour 1 | `sitemap-core.xml` (accueil, hubs, 104 départements, éditorial) | 117 URLs |
| 2 | Jour 1 aussi | `sitemap-villes.xml` : les pages villes sont le cœur SEO, contenu riche (classement, résumé, FAQ, tableau) | 4 643 |
| 3 | Quand ~50 % des villes sont indexées (3 à 6 semaines, surveiller GSC > Pages) | `sitemap-ecoles.xml` (fiches actives) | 11 371 |
| 4 | 1 à 2 mois après l'étape 3 | `sitemap-ecoles-fermees.xml` (longtail marque) | 9 978 |

Pourquoi ce rythme : domaine à autorité nulle = budget de crawl minuscule au début. Si on soumet 26 000 URLs jour 1, Google échantillonne au hasard et met des mois à trouver les pages qui comptent. En le guidant villes d'abord, les pages à plus forte valeur (requêtes « auto école + ville ») concentrent le crawl, se positionnent, créent des signaux, et le reste suit naturellement par le maillage interne (chaque ville lie ses fiches).

Le contenu est-il assez riche ? Oui pour les villes et les fiches avec taux : classement + données uniques multi-millésimes + résumé en prose + FAQ + tableau sémantique, c'est au-dessus du standard des concurrents. Les seuls candidats « thin content » sont les fiches sans aucun taux publié (petites écoles 100 % n.c.) : elles restent utiles (agrément, adresse, écoles proches) et le bloc « à comparer » les densifie ; si GSC signale du « Détecté, actuellement non indexé » massif sur elles dans 3 mois, on les passera en noindex ciblé, décision fondée sur les données, pas par avance.

Accélérateurs recommandés dès la mise en ligne : lien depuis parcoursioux.fr et omyeu.fr en footer (« nos autres services ») : ce sont tes premiers backlinks propres ; la page /statistiques/ à pousser sur les forums et subreddits permis (linkbait naturel) ; l'inscription du site sur data.gouv.fr comme réutilisation des jeux de données (backlink .gouv, crédibilité GEO).

## 6. Checklist récapitulative

- [ ] `netlify init` (site NEUF) + deploy prod
- [ ] Deeplinks affiliation dans _redirects (via generate.py)
- [ ] OVH : A @ → 75.2.60.5, CNAME www → site.netlify.app, MX intacts
- [ ] HTTPS forcé sur Netlify
- [ ] OVH : créer edouard@ et contact@, brancher dans Gmail (POP+SMTP ou redirection+SMTP)
- [ ] Compléter l'éditeur dans /mentions/ (nom, statut, SIREN)
- [ ] UMAMI_ID dans generate.py, régénérer, redéployer
- [ ] GSC : propriété Domaine + TXT OVH, soumettre sitemap-core + sitemap-villes
- [ ] Bing Webmaster (import GSC)
- [ ] Backlinks footer depuis parcoursioux et omyeu
- [ ] S+4 à S+6 : soumettre sitemap-ecoles.xml selon l'indexation des villes
