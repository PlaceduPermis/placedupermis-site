#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploiement VERROUILLE de placedupermis.fr
# Securite : deploie toujours sur le site placedupermis (par son ID), jamais
# ailleurs, meme si le dossier est lie par erreur a un autre projet Netlify.
# Usage : ./deploy.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SITE_ID="1826ad9e-a7fb-4360-b5c6-f4634a41e560"   # placedupermis - NE PAS MODIFIER
SITE_NAME="placedupermis"

cd "$(dirname "$0")"

echo "[1/4] Garde-fou : verification du site cible (${SITE_NAME})..."
FOUND="$(netlify api getSite --data "{\"site_id\":\"${SITE_ID}\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))" 2>/dev/null || true)"

if [ "${FOUND}" != "${SITE_NAME}" ]; then
  echo "ARRET. Le site ${SITE_ID} ne porte pas le nom ${SITE_NAME} (trouve: ${FOUND})."
  echo "Rien n'a ete deploye. Verifie ta connexion Netlify (netlify login)."
  exit 1
fi
echo "OK - cible confirmee : ${FOUND}"

echo "[2/4] Generation du site..."
python3 site/generate.py

echo "[3/4] Apercu (deploy draft) avant la prod..."
netlify deploy --dir=site/dist --site "${SITE_ID}" | tee /tmp/pdp_draft.log
DRAFT_URL="$(grep -o 'https://[a-z0-9-]*--placedupermis.netlify.app' /tmp/pdp_draft.log | head -1 || true)"
echo ""
echo "-------------------------------------------------------------"
if [ -n "${DRAFT_URL}" ]; then
  echo "Apercu pret : ${DRAFT_URL}"
else
  echo "Apercu pret : voir l'URL ci-dessus"
fi
echo "Verifie l'apercu, puis confirme la mise en PRODUCTION."
read -r -p "Deployer en production sur placedupermis.fr ? [oui/non] " OK
if [ "${OK}" != "oui" ]; then
  echo "Annule. Rien n'est passe en production."
  exit 0
fi

echo "[4/4] Deploiement en PRODUCTION sur ${SITE_NAME}..."
netlify deploy --dir=site/dist --prod --site "${SITE_ID}"
echo "OK - termine. Verifie https://placedupermis.fr"
