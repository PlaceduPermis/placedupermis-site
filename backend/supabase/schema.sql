-- placedupermis.fr — schéma Supabase (v1)
-- À exécuter dans le SQL editor de ton projet Supabase (organisation "placedupermis")
-- Idempotent : peut être re-exécuté sans casser la base (IF NOT EXISTS partout).

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- =============================================================================
-- TABLES
-- =============================================================================

-- Compte utilisateur : lié 1:1 à auth.users (Supabase Auth).
-- Un compte peut gérer plusieurs fiches (voir account_fiches).
create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  billing_company_name text,     -- raison sociale pour factures
  billing_siret text,
  billing_email text,            -- email de facturation (peut différer de l'email de connexion)
  stripe_customer_id text unique,-- Stripe Customer, créé au 1er checkout
  created_at timestamptz not null default now()
);

-- Fiches d'auto-écoles = miroir de schools.json (source RAFAEL).
-- Rafraîchie mensuellement par le pipeline (build_db.py). NE PAS modifier via UI.
create table if not exists public.fiches (
  id text primary key,           -- ex: "E1808500090" (agrément préfectoral)
  slug text not null unique,     -- ex: "sam-formations-challans"
  name text not null,
  status text not null,          -- 'active' | 'closed'
  address_line1 text,
  postcode text,
  city text,
  dept text,
  lat double precision,
  lon double precision,
  contact_email_official text,   -- l'email public collecté (celui qu'on a scrapé/OSM/etc.)
  contact_website text,
  categories text[],
  flags jsonb,                   -- {label_qualite, permis_1euro, aac, cs, ...}
  stats jsonb,                   -- {B: {2025: {n, tx, ...}, 2018: {...}}}
  updated_at timestamptz not null default now()
);
create index if not exists idx_fiches_dept on public.fiches(dept);
create index if not exists idx_fiches_status on public.fiches(status);

-- Rattachement M:N account ↔ fiche (un gérant peut avoir plusieurs auto-écoles).
create table if not exists public.account_fiches (
  account_id uuid not null references public.accounts(id) on delete cascade,
  fiche_id text not null references public.fiches(id) on delete cascade,
  attached_at timestamptz not null default now(),
  verification_status text not null default 'auto',
    -- 'auto' : email compte == email officiel de la fiche, aucun check supplémentaire
    -- 'pending' : email diffère, mail de confirmation envoyé à l'email officiel
    -- 'confirmed' : quelqu'un a cliqué le lien de confirmation
    -- 'disputed' : signalement du vrai gérant → suspension + remboursement
  primary key (account_id, fiche_id)
);

-- Brouillon = contenu enrichi tant que non publié.
-- Un seul brouillon par fiche (une fiche = un abonnement).
create table if not exists public.drafts (
  fiche_id text primary key references public.fiches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_email text,
  contact_phone text,
  contact_whatsapp text,
  contact_website text,
  description text,
  quote_text text,               -- « mot du gérant »
  manager_name text,
  manager_role text,
  photos jsonb default '[]'::jsonb,   -- tableau d'URLs Supabase Storage
  prices jsonb default '[]'::jsonb,   -- [{name, desc, price_eur}, ...]
  hours jsonb default '{}'::jsonb,    -- {mon: "9h-12h · 14h-19h", tue: ..., sun: null}
  hours_note text,
  specialties text[],            -- ['permis_b', 'bea', 'moto_a2', ...]
  offer_title text,
  offer_subtitle text,
  offer_tag text,
  offer_emoji text,
  offer_ends_at date,
  updated_at timestamptz not null default now()
);

-- Abonnements Stripe.
-- Une ligne par (fiche + période active). L'historique reste (pas de delete).
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  fiche_id text not null references public.fiches(id) on delete restrict,
  stripe_subscription_id text unique,
  stripe_price_id text not null, -- price_annuel_launch / price_mensuel_launch / etc.
  plan text not null,            -- 'annuel' | 'mensuel'
  is_launch_price boolean not null default false,
  status text not null,          -- 'active' | 'past_due' | 'canceled' | 'unpaid'
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz
);
create index if not exists idx_subs_account on public.subscriptions(account_id);
create index if not exists idx_subs_fiche on public.subscriptions(fiche_id);
create index if not exists idx_subs_status on public.subscriptions(status) where status in ('active','past_due');

-- Publication = snapshot du brouillon au moment du paiement, servant à générer la fiche publique.
create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  fiche_id text not null references public.fiches(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  content jsonb not null,        -- snapshot complet de drafts au moment de la publication
  published_at timestamptz not null default now(),
  is_current boolean not null default true
);
create unique index if not exists idx_publications_current on public.publications(fiche_id) where is_current;

-- Factures Stripe (miroir local pour affichage rapide dans l'espace).
create table if not exists public.invoices (
  id text primary key,           -- stripe invoice id (in_...)
  account_id uuid not null references public.accounts(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_paid_eur numeric(10,2) not null,
  currency text not null default 'eur',
  status text not null,          -- 'paid' | 'open' | 'void' | 'uncollectible'
  invoice_pdf text,              -- URL PDF Stripe
  hosted_invoice_url text,
  invoice_date timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_account on public.invoices(account_id);

-- Journal des modifications : diff avant/après pour l'email de confirmation modif.
create table if not exists public.changes_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  fiche_id text references public.fiches(id) on delete cascade,
  field text not null,           -- 'contact_phone' | 'photos' | 'prices' | ...
  before_value jsonb,
  after_value jsonb,
  changed_at timestamptz not null default now()
);
create index if not exists idx_changes_fiche_time on public.changes_log(fiche_id, changed_at desc);

-- Demandes de devis reçues via le formulaire des fiches Premium.
-- Écrites par la fonction serverless send-lead (service role), jamais par le client.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  fiche_id text not null references public.fiches(id) on delete cascade,
  visitor_name text not null,
  visitor_email text not null,
  visitor_phone text,
  message text,
  sent_to text not null,         -- email du gérant destinataire au moment de l'envoi
  delivered boolean not null default false,
  created_at timestamptz not null default now(),
  ip_hash text                   -- hash tronqué pour anti-abus, jamais l'IP en clair
);
create index if not exists idx_leads_fiche_time on public.leads(fiche_id, created_at desc);

-- Compteur places early bird (une seule ligne)
create table if not exists public.launch_counter (
  id boolean primary key default true check (id),  -- singleton
  seats_taken integer not null default 0,
  seats_max integer not null default 50,
  ends_at date not null default '2026-12-31'
);
insert into public.launch_counter (id) values (true) on conflict do nothing;

-- Incrément atomique : retourne le nouveau seats_taken si OK, -1 si complet ou expiré.
create or replace function public.increment_launch_counter() returns integer
language plpgsql security definer set search_path = public as $$
declare
  new_val integer;
begin
  update public.launch_counter
    set seats_taken = seats_taken + 1
    where id = true
      and seats_taken < seats_max
      and current_date <= ends_at
    returning seats_taken into new_val;
  if new_val is null then return -1; end if;
  return new_val;
end $$;

-- Renvoie les subs annuelles qui expirent dans ~30 jours et n'ont pas encore
-- reçu de rappel. Le rappel est identifié par un flag dans metadata (à implémenter).
create or replace function public.subs_needing_renewal_reminder()
returns table (id uuid, account_id uuid, fiche_id text, current_period_end timestamptz)
language sql security definer set search_path = public as $$
  select id, account_id, fiche_id, current_period_end
  from public.subscriptions
  where plan = 'annuel'
    and status = 'active'
    and cancel_at_period_end = false
    and current_period_end between now() + interval '29 days' and now() + interval '31 days'
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.accounts enable row level security;
alter table public.account_fiches enable row level security;
alter table public.drafts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.publications enable row level security;
alter table public.invoices enable row level security;
alter table public.changes_log enable row level security;
-- fiches : lecture publique (comparateur ouvert) — pas de RLS
-- launch_counter : lecture publique (affichage sur landing)

drop policy if exists "own account" on public.accounts;
create policy "own account" on public.accounts
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own fiches attachment" on public.account_fiches;
create policy "own fiches attachment" on public.account_fiches
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

drop policy if exists "own subs" on public.subscriptions;
create policy "own subs" on public.subscriptions
  for select using (auth.uid() = account_id);

drop policy if exists "own publications" on public.publications;
create policy "own publications" on public.publications
  for select using (
    exists (select 1 from public.account_fiches af
            where af.fiche_id = publications.fiche_id and af.account_id = auth.uid())
  );

drop policy if exists "own invoices" on public.invoices;
create policy "own invoices" on public.invoices
  for select using (auth.uid() = account_id);

drop policy if exists "own changes" on public.changes_log;
create policy "own changes" on public.changes_log
  for select using (auth.uid() = account_id);

-- =============================================================================
-- FONCTIONS UTILITAIRES
-- =============================================================================

-- Créer une ligne "accounts" automatiquement à la 1re connexion Supabase Auth.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger : maintenir drafts.updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists tg_drafts_touch on public.drafts;
create trigger tg_drafts_touch before update on public.drafts
  for each row execute procedure public.touch_updated_at();

drop trigger if exists tg_subs_touch on public.subscriptions;
create trigger tg_subs_touch before update on public.subscriptions
  for each row execute procedure public.touch_updated_at();

-- =============================================================================
-- STORAGE (photos uploadées par les gérants)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('fiche-photos', 'fiche-photos', true)
on conflict (id) do nothing;

drop policy if exists "own upload" on storage.objects;
create policy "own upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fiche-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own delete" on storage.objects;
create policy "own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fiche-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "public read" on storage.objects;
create policy "public read" on storage.objects
  for select to public
  using (bucket_id = 'fiche-photos');
