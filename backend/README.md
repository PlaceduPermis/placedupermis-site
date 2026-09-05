# Backend placedupermis.fr

Skeleton du back **espace pro / revendication de fiche**.

- **Auth** : Supabase Auth (magic link email, pas de mot de passe)
- **Base** : Supabase Postgres (schéma [`supabase/schema.sql`](supabase/schema.sql))
- **Paiement** : Stripe (subscriptions, checkout hosted)
- **Emails** : Resend
- **Runtime** : Netlify Functions (Node 20, esbuild), URL `/api/*`
- **Front** : maquettes HTML dans `../maquettes/revendication/` — à brancher au SDK Supabase JS + `fetch('/api/…')`

## Setup (une seule fois)

### 1. Supabase (5 min)

1. `https://supabase.com/dashboard/organizations` → **New organization** : `placedupermis` (Free plan)
2. Dans cette org → **New project** : `placedupermis-prod`, région **Paris (eu-west-3)**, choisis un mot de passe DB (garde-le)
3. Une fois le projet créé (~2 min de provisioning) :
   - Va dans **SQL editor** → colle tout le contenu de `supabase/schema.sql` → **Run**
   - Va dans **Authentication → Providers** → active **Email** (magic link est activé par défaut)
   - Va dans **Authentication → URL Configuration** → **Site URL** = `https://placedupermis.fr` ; **Redirect URLs** ajoute `http://localhost:8888/*` pour dev local
   - Va dans **Project Settings → API** → récupère `URL`, `anon key`, `service_role key`

### 2. Stripe (5 min)

Utilise le compte Stripe existant (celui de Parcoursioux).

1. `https://dashboard.stripe.com/products` → **+ Add product**
   - Name : `placedupermis · fiche enrichie`
   - Description : `Enrichissement d'une fiche auto-école sur placedupermis.fr`
2. Ajouter **4 prix** au produit :
   - `108 € / an` (recurring, yearly) — annuel launch
   - `228 € / an` (recurring, yearly) — annuel normal
   - `12 € / mois` (recurring, monthly) — mensuel launch
   - `25 € / mois` (recurring, monthly) — mensuel normal
3. **Developers → Webhooks → + Add endpoint** :
   - URL : `https://placedupermis.fr/api/stripe-webhook`
   - Events : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
   - Copier le **signing secret** (`whsec_...`)
4. **Developers → API keys** → copier `sk_live_` / `pk_live_` (test : `sk_test_` / `pk_test_`)

### 3. Resend (2 min)

1. `https://resend.com/api-keys` → **+ Create API Key**
2. Ajoute et vérifie le domaine `placedupermis.fr` (dashboard Resend → DNS records → colle les 3 records TXT/CNAME chez ton registrar)
3. Copie la clé API (`re_...`)

### 4. .env local

```bash
cp .env.example .env
# éditer .env avec toutes les vraies clés récupérées ci-dessus
```

### 5. Netlify env vars (prod)

Dans Netlify → **Site settings → Environment variables**, recopier **toutes** les vars du `.env` sauf localhost. Bien mettre les `SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `RESEND_API_KEY` en **secret** (masqué).

### 6. Peupler la base

```bash
cd placedupermis
npm install
npm run import-fiches   # 21k fiches depuis data/schools.json
npm run import-emails   # ~4600 emails officiels depuis auto-ecoles-contacts.xlsx
```

### 7. Dev local

```bash
npm install -g netlify-cli
netlify dev             # sert le site statique + les fonctions sur localhost:8888
```

## Architecture des fichiers

```
placedupermis/
├── netlify.toml                       # config déploiement (bundler, redirects /api/*)
├── package.json                       # deps Node
├── .env.example                       # gabarit variables d'env
├── .env                               # LOCAL uniquement, gitignoré
│
├── netlify/functions/                 # endpoints /api/*
│   ├── create-checkout-session.js    # POST /api/create-checkout-session
│   ├── stripe-webhook.js             # POST /api/stripe-webhook (Stripe → nous)
│   ├── save-draft.js                 # POST /api/save-draft
│   ├── attach-fiche.js               # POST /api/attach-fiche
│   ├── cancel-subscription.js        # POST /api/cancel-subscription
│   └── renewal-reminder.js           # cron @daily : rappel J-30 renouvellement
│
├── backend/
│   ├── supabase/schema.sql           # schéma DB (à jouer dans SQL editor)
│   ├── lib/                          # code partagé (importé par les fonctions)
│   │   ├── supabase.js               # client service-role
│   │   ├── stripe.js                 # client + PRICES map
│   │   ├── email.js                  # wrapper Resend
│   │   └── launch.js                 # helpers early bird
│   └── scripts/
│       ├── import-fiches.js          # one-shot : schools.json → table fiches
│       └── import-emails.js          # one-shot : xlsx contacts → contact_email_official
│
└── site/dist/                         # site statique existant (généré par generate.py)
    └── (les maquettes de revendication passeront ici après intégration front)
```

## Flux principal

```
1. Cold email → LANDING (public, statique)
2. Clic "Revendiquer" → /pro/connexion.html
3. Saisie email → supabase.auth.signInWithOtp({ email }) → magic link envoyé par Supabase
4. Clic sur magic link → redirect vers /pro/mon-espace/?token=...
5. Front récupère la session Supabase, appelle /api/attach-fiche { fiche_id }
6. Front édite le brouillon → /api/save-draft à chaque modif
7. Clic "Publier ma fiche" → /api/create-checkout-session → Stripe Checkout hosted
8. Paiement OK → Stripe redirect vers ?checkout=success ET envoie webhook à /api/stripe-webhook
9. Le webhook :
   - crée la subscription en DB
   - snapshot le brouillon dans publications (is_current=true)
   - incrémente le compteur early bird
   - envoie l'email de confirmation (email #3)
10. Le générateur du site (generate.py) lit publications pour enrichir les fiches publiques
```

## Ce qui reste à faire côté back (v2)

- [ ] Templates emails Resend (les 5 HTML des maquettes → adapter en templates dynamiques)
- [ ] Génération PDF facture (Stripe le fait déjà côté hosted, on stocke juste le lien)
- [ ] Vérification email quand `verification_status = 'pending'` (envoi + endpoint /api/verify-fiche-ownership)
- [ ] Suppression photos Storage quand désabonné > 6 mois
- [ ] Adaptation de `generate.py` pour lire les publications enrichies et injecter dans les fiches
- [ ] Analytics de fiche (vues, clics tel, clics email) pour email #5

## Sécurité — points de vigilance

- `SUPABASE_SERVICE_ROLE_KEY` bypass RLS : jamais dans le front, jamais dans un repo public
- `STRIPE_WEBHOOK_SECRET` : la fonction `stripe-webhook.js` **doit** vérifier la signature (déjà fait)
- Filtre `metadata.project === 'placedupermis'` sur tous les webhooks Stripe (compte partagé avec Parcoursioux)
- RLS activé sur toutes les tables sensibles — un compte ne peut lire/écrire que ses propres lignes
- Storage `fiche-photos` : upload seulement dans son sous-dossier `{user_id}/*`, lecture publique
