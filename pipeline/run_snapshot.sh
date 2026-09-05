#!/usr/bin/env bash
# Snapshot mensuel placedupermis.fr — archive datée du CSV officiel RAFAEL.
# Lancé par launchd (com.placedupermis.snapshot). Ne régénère PAS le site.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")"
LOG="../data/raw/snapshots/_snapshot.log"
mkdir -p ../data/raw/snapshots
echo "=== $(date '+%Y-%m-%d %H:%M:%S') : snapshot ===" >> "$LOG"
if python3 fetch_sources.py --no-geo >> "$LOG" 2>&1; then
  echo "OK $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
else
  echo "ECHEC $(date '+%Y-%m-%d %H:%M:%S') (voir lignes ci-dessus)" >> "$LOG"
fi
