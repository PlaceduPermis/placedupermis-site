#!/usr/bin/env python3
"""
placedupermis.fr — pipeline de consolidation.
Fusionne les millésimes (2018 XLS, 2023 wayback CSV, 2025 CSV officiel)
+ géocodage BAN en un fichier schools.json (une fiche par agrément RAFAEL).

Clé primaire : raf_numero (n° d'agrément préfectoral, registre RAFAEL).
Sortie : data/schools.json + data/stats_globales.json
"""
import csv, io, json, re, unicodedata, sys
try:
    import ftfy
except ImportError:
    ftfy = None
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"

# ---------------------------------------------------------------- helpers
def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)

def clean(s):
    """répare le mojibake (double-encodage UTF-8) des noms/adresses"""
    if not s: return s
    return ftfy.fix_text(s) if ftfy else s

def num(v):
    """float ou None (gère NC, -1, vide, NaN, virgule décimale, %)"""
    if v is None: return None
    v = str(v).strip().replace("%", "").replace(",", ".")
    if v in ("", "NC", "-1", "-1.0", "NULL", "nan", "NaN"): return None
    try:
        f = float(v)
    except ValueError:
        return None
    return None if f < 0 else f

def intn(v):
    f = num(v)
    return int(f) if f is not None else None

def rate(v):
    """taux normalisé 0-1 (les fichiers récents sont déjà en 0-1, le XLS 2018 en %)"""
    f = num(v)
    if f is None: return None
    return round(f / 100.0, 4) if f > 1.0 else round(f, 4)

def flag(v):
    return str(v).strip().upper() in ("1", "1.0", "TRUE", "O", "X", "OUI")

# ---------------------------------------------------------------- 2025 (officiel, période exams 01/01/2025-31/12/2025)
def load_2025():
    raw = (RAW / "pdp_auto-ecoles-2025.csv").read_bytes().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(raw), delimiter=";"))
    print(f"[2025] {len(rows)} écoles")
    return rows

# ---------------------------------------------------------------- 2023 (wayback 27/06/2023 ≈ exams 2022)
def load_2023():
    raw = (RAW / "pdp_auto-ecoles-2023-wayback.csv").read_bytes().decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(raw), delimiter=";"))
    print(f"[2023] {len(rows)} écoles")
    return rows

# ---------------------------------------------------------------- 2018 (XLS DSR)
def load_2018():
    import pandas as pd
    df = pd.read_excel(RAW / "2018-tr-eeac-diffusion.xls", header=None, skiprows=2,
                       names=["dept", "name", "raf", "adresse", "cp", "ville",
                              "A1_nb", "A1_tr", "A2_nb", "A2_tr", "B_nb", "B_tr",
                              "B1_nb", "B1_tr", "BE_nb", "BE_tr", "C_nb", "C_tr",
                              "CE_nb", "CE_tr", "D_nb", "D_tr"])
    df = df[df["raf"].notna()]
    print(f"[2018] {len(df)} écoles")
    return df

# ---------------------------------------------------------------- géocodage BAN (optionnel si le fichier est là)
def load_geo():
    f = RAW / "pdp_auto-ecoles-2025-geocoded.csv"
    if not f.exists():
        print("[geo] fichier géocodé absent — coordonnées omises pour l'instant")
        return {}
    raw = f.read_bytes().decode("utf-8")
    geo = {}
    for r in csv.DictReader(io.StringIO(raw), delimiter=";"):
        def coord(v):
            try: return float(str(v).replace(",", "."))
            except (ValueError, TypeError): return None
        lat, lon = coord(r.get("latitude")), coord(r.get("longitude"))
        if lat is None or lon is None: continue
        geo[r["raf_numero"]] = {
            "lat": round(lat, 6), "lon": round(lon, 6),
            "score": round(num(r.get("result_score")) or 0, 3),
            "precision": r.get("result_type") or None,
            "citycode": r.get("result_citycode") or None,
            "city_ban": r.get("result_city") or None,
        }
    print(f"[geo] {len(geo)} écoles géocodées")
    return geo

# ---------------------------------------------------------------- fusion
def main():
    r25, r23, df18, geo = load_2025(), load_2023(), load_2018(), load_geo()
    schools = {}

    # base = 2025 (millésime le plus récent → écoles actives)
    for r in r25:
        raf = r["raf_numero"].strip()
        cats = [c for c in ["A","A1","A2","B","BE","C","C1","CE","C1E","D","D1","DE","D1E"] if flag(r.get(f"{c}_flag"))]
        s = {
            "id": raf,
            "name": clean(r["aue_raisonsociale"].strip()),
            "status": "active",
            "address": {
                "line1": clean(r["aue_adresse"].strip()),
                "postcode": r["aue_codepostal"].strip().zfill(5),
                "city": r["aue_commune"].strip(),
                "dept": r["dpt_id"].strip().zfill(2) if len(r["dpt_id"].strip()) < 3 else r["dpt_id"].strip(),
            },
            "contact": {"website": r["aue_siteinternet"].strip() or None},
            "flags": {
                "label_qualite": flag(r["aue_labelqualite_flag"]),
                "permis_1euro": flag(r["aue_permis1euro_flag"]),
                "asso": flag(r["aue_ecoleasso_flag"]),
                "aac": flag(r["aue_aac_flag"]),
                "cs": flag(r["aue_cs_flag"]),
                "en_ligne": flag(r["aue_enligne_flag"]),
            },
            "categories": cats,
            "stats": defaultdict(dict),
            "first_seen": 2025, "last_seen": 2025,
            "claim": {"claimed": False, "premium": False, "overrides": {}},
        }
        # stats 2025 (période exams 2025)
        b = {"n": intn(r["B_nombre_1pra"]), "tx": rate(r["B_taux_1pra"]),
             "tx_aac": rate(r["B_taux_1pra_aac"]), "tx_cs": rate(r["B_taux_1pra_cs"]),
             "tx_xpra": rate(r["B_taux_xpra"])}
        a = {"n": intn(r["A_nombre_1pra"]), "tx": rate(r["A_taux_1pra"]), "tx_xpra": rate(r["A_taux_xpra"])}
        cd = {"n": intn(r["CD_nombre_1pra"]), "tx": rate(r["CD_taux_1pra"]), "tx_xpra": rate(r["CD_taux_xpra"])}
        for fam, d in (("B", b), ("A", a), ("CD", cd)):
            d = {k: v for k, v in d.items() if v is not None}
            if d: s["stats"][fam]["2025"] = d
        schools[raf] = s

    # 2023 (≈ exams 2022) — NB : dans ce millésime, 0 = donnée absente
    # (seules les ~2 900 labellisées avaient un taux publié à l'époque)
    def rate23(v):
        f = rate(v)
        return None if not f else f
    for r in r23:
        raf = r["raf_numero"].strip()
        b = {"tx": rate23(r["B_taux_1pra"]), "tx_aac": rate23(r["B_taux_1pra_aac"]),
             "tx_cs": rate23(r["B_taux_1pra_cs"]), "tx_xpra": rate23(r["B_taux_xpra"])}
        a = {"tx": rate23(r["A_taux_1pra"]), "tx_xpra": rate23(r["A_taux_xpra"])}
        cd = {"tx": rate23(r["CD_taux_1pra"]), "tx_xpra": rate23(r["CD_taux_xpra"])}
        if raf in schools:
            s = schools[raf]; s["first_seen"] = 2022
        else:  # école présente en 2023 mais plus en 2025 → fermée / agrément non renouvelé
            s = {
                "id": raf, "name": clean(r["aue_raisonsociale"].strip()), "status": "closed",
                "address": {"line1": r["aue_adresse"].strip(),
                            "postcode": r["aue_codepostal"].strip().zfill(5),
                            "city": r["aue_commune"].strip(),
                            "dept": r["dpt_id"].strip().zfill(2) if len(r["dpt_id"].strip()) < 3 else r["dpt_id"].strip()},
                "contact": {"website": None},
                "flags": {"label_qualite": flag(r["aue_labelqualite_flag"]),
                          "permis_1euro": False, "asso": flag(r["aue_ecoleasso_flag"]),
                          "aac": flag(r["aue_aac_flag"]), "cs": flag(r["aue_cs_flag"]),
                          "en_ligne": flag(r["aue_enligne_flag"])},
                "categories": [c for c in ["A","A1","A2","B","BE","C","C1","CE","C1E","D","D1","DE","D1E"] if flag(r.get(f"{c}_flag"))],
                "stats": defaultdict(dict), "first_seen": 2022, "last_seen": 2022,
                "claim": {"claimed": False, "premium": False, "overrides": {}},
            }
            schools[raf] = s
        for fam, d in (("B", b), ("A", a), ("CD", cd)):
            d = {k: v for k, v in d.items() if v is not None}
            if d: s["stats"][fam]["2022"] = d

    # 2018
    n18_matched = 0
    for _, r in df18.iterrows():
        raf = str(r["raf"]).strip()
        pairs = [("A1", "A1"), ("A2", "A2"), ("B", "B"), ("BE", "BE"), ("C", "CD"), ("CE", "CD"), ("D", "CD")]
        if raf in schools:
            s = schools[raf]; s["first_seen"] = 2018; n18_matched += 1
        else:
            s = {
                "id": raf, "name": clean(str(r["name"]).strip()), "status": "closed",
                "address": {"line1": str(r["adresse"]).strip(),
                            "postcode": str(r["cp"]).strip().split(".")[0].zfill(5),
                            "city": str(r["ville"]).strip(),
                            "dept": str(r["dept"]).strip().lstrip("0").zfill(2)},
                "contact": {"website": None},
                "flags": {}, "categories": [],
                "stats": defaultdict(dict), "first_seen": 2018, "last_seen": 2018,
                "claim": {"claimed": False, "premium": False, "overrides": {}},
            }
            schools[raf] = s
        # B seul en détail ; A1/A2 agrégés côté site en "A" ; C/CE/D → "CD"
        fam_acc = defaultdict(lambda: {"n": 0, "wsum": 0.0})
        for col, fam in pairs:
            n_, t_ = intn(r[f"{col}_nb"]), rate(r[f"{col}_tr"])
            if n_ and t_ is not None:
                fam_acc[fam]["n"] += n_
                fam_acc[fam]["wsum"] += n_ * t_
        for fam, acc in fam_acc.items():
            if acc["n"]:
                s["stats"][fam]["2018"] = {"n": acc["n"], "tx": round(acc["wsum"] / acc["n"], 4)}
    print(f"[2018] {n18_matched} agréments retrouvés en 2025/2023")

    # géo + slug + citycode
    slugcount = defaultdict(int)
    for s in schools.values():
        g = geo.get(s["id"])
        if g:
            s["address"].update({"lat": g["lat"], "lon": g["lon"], "geo_score": g["score"],
                                 "geo_precision": g["precision"], "citycode": g["citycode"]})
        base = f'{slugify(s["name"])}-{slugify(s["address"]["city"])}'
        slugcount[base] += 1
        s["_slugbase"] = base
    seen = defaultdict(int)
    for s in schools.values():
        base = s.pop("_slugbase")
        if slugcount[base] > 1:  # homonymes multi-locaux → suffixe agrément complet (unique)
            s["slug"] = f'{base}-{s["id"].lower()}'
        else:
            s["slug"] = base
        seen[s["slug"]] += 1
    dup = [k for k, v in seen.items() if v > 1]
    assert not dup, f"slugs en collision: {dup[:5]}"

    for s in schools.values():
        s["stats"] = {k: dict(v) for k, v in s["stats"].items()}

    out = sorted(schools.values(), key=lambda s: s["id"])
    (OUT / "schools.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")

    # stats globales par département (moyennes pondérées B 2025)
    dstats = defaultdict(lambda: {"n_schools": 0, "b_n": 0, "b_wsum": 0.0})
    for s in out:
        if s["status"] != "active": continue
        d = s["address"]["dept"]
        dstats[d]["n_schools"] += 1
        b25 = s["stats"].get("B", {}).get("2025", {})
        if b25.get("n") and b25.get("tx") is not None:
            dstats[d]["b_n"] += b25["n"]; dstats[d]["b_wsum"] += b25["n"] * b25["tx"]
    dd = {d: {"n_schools": v["n_schools"], "b_candidats": v["b_n"],
              "b_taux_moyen": round(v["b_wsum"] / v["b_n"], 4) if v["b_n"] else None}
          for d, v in sorted(dstats.items())}
    (OUT / "stats_globales.json").write_text(json.dumps(dd, ensure_ascii=False, indent=1), encoding="utf-8")

    actives = sum(1 for s in out if s["status"] == "active")
    closed = len(out) - actives
    h3 = sum(1 for s in out if len([y for f in s["stats"].values() for y in f]) >= 3)
    print(f"TOTAL {len(out)} fiches | actives {actives} | fermées {closed} | fiches avec ≥3 points d'historique {h3}")

if __name__ == "__main__":
    main()
