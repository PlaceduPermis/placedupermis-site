#!/usr/bin/env python3
"""
placedupermis.fr — récupération des sources officielles.
À lancer sur une machine avec accès internet (Mac d'Ed, GitHub Actions, cron).

1. Télécharge le CSV national des auto-écoles (registre RAFAEL, MàJ mensuelle)
2. Télécharge le CSV handicap
3. Archive un snapshot daté (constitution de l'historique au fil de l'eau)
4. Géocode en masse via la BAN (api-adresse.data.gouv.fr, gratuit, sans clé)

Usage :  python3 fetch_sources.py            # tout
         python3 fetch_sources.py --no-geo   # sans géocodage
Ensuite : python3 build_db.py && python3 ../site/generate.py
"""
import sys, datetime, shutil, urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
SNAP = RAW / "snapshots"

CSV_URL = "https://autoecoles.securite-routiere.gouv.fr/sites/default/files/certified-schools/auto-ecoles.csv"
CSV_HANDI_URL = "https://autoecoles.securite-routiere.gouv.fr/sites/default/files/handicap-schools/auto-ecoles-handicap.csv"
BAN_CSV_URL = "https://api-adresse.data.gouv.fr/search/csv/"
UA = {"User-Agent": "placedupermis.fr data pipeline (contact@placedupermis.fr)"}

def dl(url, dest):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    print(f"↓ {dest.name} ({dest.stat().st_size:,} o)")

def geocode(src, dest):
    """Géocodage BAN en masse (multipart). ~40 s pour 11 000 lignes."""
    import uuid
    boundary = uuid.uuid4().hex
    body = b""
    def part(name, value, filename=None, ctype=None):
        nonlocal body
        body += f"--{boundary}\r\n".encode()
        disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        body += f"Content-Disposition: {disp}\r\n".encode()
        if ctype: body += f"Content-Type: {ctype}\r\n".encode()
        body += b"\r\n" + (value if isinstance(value, bytes) else value.encode()) + b"\r\n"
    part("data", src.read_bytes(), filename=src.name, ctype="text/csv")
    for c in ("aue_adresse", "aue_codepostal", "aue_commune"):
        part("columns", c)
    part("postcode", "aue_codepostal")
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(BAN_CSV_URL, data=body, headers={
        **UA, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    print(f"⌖ géocodé → {dest.name} ({dest.stat().st_size:,} o)")

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    SNAP.mkdir(exist_ok=True)
    today = datetime.date.today().isoformat()

    cur = RAW / "pdp_auto-ecoles-2025.csv"      # nom "courant" attendu par build_db
    dl(CSV_URL, cur)
    dl(CSV_HANDI_URL, RAW / "pdp_auto-ecoles-handicap.csv")
    shutil.copy(cur, SNAP / f"auto-ecoles-{today}.csv")   # historique au fil de l'eau
    print(f"⧉ snapshot archivé : snapshots/auto-ecoles-{today}.csv")

    if "--no-geo" not in sys.argv:
        geocode(cur, RAW / "pdp_auto-ecoles-2025-geocoded.csv")

    print("OK. Ensuite : python3 build_db.py && python3 ../site/generate.py")

if __name__ == "__main__":
    main()
