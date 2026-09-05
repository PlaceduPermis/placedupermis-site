#!/usr/bin/env python3
"""
placedupermis.fr — générateur de CARTE DE SCORE à la demande.

Produit, pour une auto-école qui décroche une distinction méritée
(top 20 % national OU podium départemental), trois formats :
  - PNG 1200x630 (partage réseaux sociaux, email, signature)
  - PDF A6 (autocollant vitrine / porte)
  - snippet HTML de widget web (badge + backlink nofollow vers la page de vérification)

Usage :  python3 carte_score.py E1206912540
         python3 carte_score.py --all-distinctions      (génère toutes les écoles éligibles)

La distinction repose sur le TAUX OFFICIEL (RAFAEL) ; la carte affiche
aussi l'indice PlaceDuPermis. Aucune contrepartie commerciale n'influe.
"""
import sys, json, bisect, re, unicodedata, subprocess
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "cartes" / "out"
MILL = "2026"; YKEY = "2025"; N_MIN = 20
SITE = "https://placedupermis.fr"

DEPT_NAMES = json.loads((ROOT / "cartes" / "depts.json").read_text()) if (ROOT / "cartes" / "depts.json").exists() else {}

def slugify(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-"))

def tcity(c):
    return re.sub(r"\b([a-zà-ÿ])", lambda m: m.group(1).upper(), str(c).lower())

def pct(x, d=1):
    return (f"{x*100:.{d}f}".replace(".", ",").rstrip("0").rstrip(",")) + " %" if x is not None else "n.c."

# ------------------------------------------------------------------ chargement + calculs
def load():
    schools = json.load(open(DATA / "schools.json"))
    agg = json.load(open(DATA / "aggregates.json"))
    return schools, agg

def build_context(schools, agg):
    PCTS = agg["percentiles"]; npcts = len(PCTS)
    act = [x for x in schools if x["status"] == "active" and not x["flags"].get("en_ligne")]
    def btx(x): return x["stats"].get("B", {}).get(YKEY, {})
    def classable(x):
        bb = btx(x); return bb.get("tx") is not None and (bb.get("n") or 0) >= N_MIN
    dept = defaultdict(list)
    for x in act:
        if classable(x): dept[x["address"]["dept"]].append(x)
    for d in dept: dept[d].sort(key=lambda x: -btx(x)["tx"])
    dept_rank = {}
    for d, lst in dept.items():
        for i, x in enumerate(lst): dept_rank[x["id"]] = (i + 1, len(lst))
    return PCTS, npcts, btx, classable, dept_rank

def pdp_index(x, PCTS, npcts, btx):
    bb = btx(x); tx, n = bb.get("tx"), bb.get("n")
    if tx is None or (n or 0) < N_MIN: return None
    c_reussite = round(bisect.bisect_left(PCTS, tx) / npcts * 100)
    c_robust = round(min(1.0, n / 150) * 100)
    stB = x["stats"].get("B", {})
    pts_ = [stB[y]["tx"] for y in ("2018", "2022", "2025") if stB.get(y, {}).get("tx") is not None]
    if len(pts_) >= 2:
        m = sum(pts_) / len(pts_); std = (sum((v - m) ** 2 for v in pts_) / len(pts_)) ** 0.5
        c_regul = round(max(0.0, 1 - std / 0.12) * 100)
    else:
        c_regul = 55
    return round(0.60 * c_reussite + 0.25 * c_robust + 0.15 * c_regul)

def distinction(x, PCTS, npcts, btx, dept_rank):
    """renvoie (label, sous-titre) ou None si pas de distinction méritée"""
    tx = btx(x).get("tx")
    if tx is None: return None
    topnat = round((1 - bisect.bisect_left(PCTS, tx) / npcts) * 100)
    dr = dept_rank.get(x["id"])
    dept = x["address"]["dept"]; dname = DEPT_NAMES.get(dept, dept)
    if dr and dr[0] == 1:
        return (f"N°1 en {dname}", f"Meilleur taux de réussite du département · Permis B {MILL}")
    if dr and dr[0] <= 3:
        return (f"Podium en {dname}", f"{dr[0]}ᵉ sur {dr[1]} auto-écoles · Permis B {MILL}")
    if topnat <= 10:
        return (f"Top {max(1, topnat)} % national", f"Parmi les meilleures auto-écoles de France · Permis B {MILL}")
    if topnat <= 20:
        return ("Top 20 % national", f"Dans le premier cinquième des auto-écoles de France · Permis B {MILL}")
    return None

# ------------------------------------------------------------------ template HTML de la carte
def card_html(x, idx, dist, topnat, dr, verif_id, size="png"):
    a = x["address"]; city = tcity(a["city"]); dname = DEPT_NAMES.get(a["dept"], a["dept"])
    tx = x["stats"]["B"][YKEY]["tx"]; n = x["stats"]["B"][YKEY].get("n")
    ring_dash = idx / 100 * 339.3
    rank_txt = f"{dr[0]}ᵉ sur {dr[1]} en {dname}" if dr else ""
    dims = "width:1200px;height:630px" if size == "png" else "width:105mm;height:148mm"  # A6 portrait pour sticker
    portrait = size == "pdf"
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@page{{size:{'105mm 148mm' if portrait else 'auto'};margin:0}}
*{{margin:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
body{{font-family:-apple-system,'Segoe UI',Roboto,system-ui,sans-serif}}
.card{{{dims};background:linear-gradient(150deg,#16305c 0%,#0f2347 100%);color:#fff;position:relative;overflow:hidden;padding:{'52px 56px' if not portrait else '40px 36px'};display:flex;flex-direction:column}}
.brand{{font-weight:900;font-size:{'26px' if not portrait else '22px'};letter-spacing:-.02em}}
.brand em{{font-style:normal;background:#c6f432;color:#16305c;border-radius:6px;padding:1px 7px;margin-left:2px}}
.dist{{display:inline-flex;align-items:center;gap:10px;background:#c6f432;color:#16305c;font-weight:800;border-radius:999px;padding:{'12px 22px' if not portrait else '9px 16px'};font-size:{'26px' if not portrait else '18px'};margin-top:{'26px' if not portrait else '18px'};align-self:flex-start;letter-spacing:-.01em}}
.dsub{{color:#b9c8ef;font-size:{'19px' if not portrait else '14px'};margin-top:14px;max-width:640px}}
.name{{font-weight:850;font-size:{'44px' if not portrait else '30px'};letter-spacing:-.03em;margin-top:{'30px' if not portrait else '20px'};line-height:1.1}}
.loc{{color:#9fb0cf;font-size:{'20px' if not portrait else '15px'};margin-top:8px}}
.row{{display:flex;gap:{'46px' if not portrait else '22px'};margin-top:auto;align-items:flex-end}}
.metric b{{display:block;font-size:{'58px' if not portrait else '40px'};letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}}
.metric.idx b{{color:#c6f432}}
.metric span{{color:#9fb0cf;font-size:{'16px' if not portrait else '12px'};margin-top:8px;display:block}}
.ring{{position:relative;width:{'132px' if not portrait else '96px'};height:{'132px' if not portrait else '96px'};margin-left:auto}}
.foot{{display:flex;justify-content:space-between;align-items:center;margin-top:{'34px' if not portrait else '22px'};padding-top:{'22px' if not portrait else '16px'};border-top:1px solid rgba(255,255,255,.15);font-size:{'15px' if not portrait else '11px'};color:#9fb0cf}}
.verif{{font-variant-numeric:tabular-nums}}
</style></head><body>
<div class="card">
<div class="brand">place du<em>permis</em></div>
<div class="dist">🏅 {dist[0]}</div>
<div class="dsub">{dist[1]}</div>
<div class="name">{city_esc(x['name'])}</div>
<div class="loc">{city} · {dname} · agrément {x['id']}</div>
<div class="row">
<div class="metric"><b>{pct(tx)}</b><span>réussite officielle permis B<br>{n} candidats · millésime {MILL}</span></div>
<div class="metric idx"><b>{idx}</b><span>indice PlaceDuPermis<br>/ 100</span></div>
<div class="ring"><svg viewBox="0 0 120 120" width="100%" height="100%"><circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="11"/><circle cx="60" cy="60" r="54" fill="none" stroke="#c6f432" stroke-width="11" stroke-linecap="round" stroke-dasharray="{ring_dash:.0f} 339.3" transform="rotate(-90 60 60)"/></svg></div>
</div>
<div class="foot"><span>Données officielles Sécurité routière (registre RAFAEL)</span><span class="verif">Vérifier : placedupermis.fr/d/{verif_id}</span></div>
</div></body></html>"""

def city_esc(s):
    s = tcity(s) if str(s).isupper() and len(str(s)) > 4 else s
    return str(s).replace("&", "&amp;").replace("<", "&lt;")

# ------------------------------------------------------------------ rendu PNG + PDF (Playwright)
def render(html, out_png, out_pdf, portrait):
    tmp = OUT / "_tmp.html"; tmp.write_text(html, encoding="utf-8")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        if out_png:
            pg = b.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=2)
            pg.goto(f"file://{tmp}"); pg.wait_for_timeout(300)
            pg.locator(".card").screenshot(path=str(out_png))
            pg.close()
        if out_pdf:
            pg = b.new_page(); pg.goto(f"file://{tmp}"); pg.wait_for_timeout(300)
            pg.pdf(path=str(out_pdf), width="105mm", height="148mm", print_background=True)
            pg.close()
        b.close()
    tmp.unlink(missing_ok=True)

# ------------------------------------------------------------------ widget web (embed nofollow)
def embed_snippet(x, verif_id):
    slug = x["slug"]
    return f'''<!-- Badge PlaceDuPermis — à coller sur le site de l'auto-école -->
<a href="{SITE}/d/{verif_id}" rel="nofollow" target="_blank"
   style="display:inline-block;text-decoration:none">
  <img src="{SITE}/cartes/{slug}.png" alt="Distinction PlaceDuPermis {MILL}"
       width="300" style="border-radius:12px;max-width:100%">
</a>'''

# ------------------------------------------------------------------ main
def one(agr, schools, ctx, write_files=True):
    PCTS, npcts, btx, classable, dept_rank = ctx
    x = next((s for s in schools if s["id"] == agr), None)
    if not x: print(f"agrément {agr} introuvable"); return None
    if not classable(x): print(f"{agr} : non classable (taux n.c. ou < {N_MIN} candidats)"); return None
    dist = distinction(x, PCTS, npcts, btx, dept_rank)
    if not dist: print(f"{agr} ({x['name']}) : pas de distinction méritée"); return None
    idx = pdp_index(x, PCTS, npcts, btx)
    topnat = round((1 - bisect.bisect_left(PCTS, btx(x)["tx"]) / npcts) * 100)
    dr = dept_rank.get(x["id"])
    verif_id = f"PDP-{MILL}-{x['id']}"
    if write_files:
        OUT.mkdir(parents=True, exist_ok=True)
        slug = x["slug"]
        render(card_html(x, idx, dist, topnat, dr, verif_id, "png"),
               OUT / f"{slug}.png", None, False)
        render(card_html(x, idx, dist, topnat, dr, verif_id, "pdf"),
               None, OUT / f"{slug}.pdf", True)
        (OUT / f"{slug}.embed.html").write_text(embed_snippet(x, verif_id), encoding="utf-8")
        print(f"OK {x['name']} → {slug}.png / .pdf / .embed.html · distinction: {dist[0]} · indice {idx}")
    return {"school": x, "dist": dist, "idx": idx, "topnat": topnat, "dr": dr, "verif_id": verif_id}

def main():
    schools, agg = load()
    ctx = build_context(schools, agg)
    args = sys.argv[1:]
    if not args:
        print(__doc__); return
    if args[0] == "--all-distinctions":
        PCTS, npcts, btx, classable, dept_rank = ctx
        eligible = [s for s in schools if classable(s) and distinction(s, PCTS, npcts, btx, dept_rank)]
        print(f"{len(eligible)} écoles éligibles à une distinction")
        return
    for agr in args:
        one(agr, schools, ctx)

if __name__ == "__main__":
    main()
