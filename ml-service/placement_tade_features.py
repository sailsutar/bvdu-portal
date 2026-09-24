"""
Trajectory-Aware Domain Engine (TADE) — feature engineering.

Year-locked CGPA, internship trajectory, skill vector, conformal-ready rows.
"""
from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd

DOMAINS = [
    "Fullstack",
    "Cyber Security",
    "Data Analyst",
    "Data Scientist",
    "Cloud Developer",
    "QA Tester",
    "AI Developer",
]

YEAR_ORDER = {"FY": 0, "SY": 1, "TY": 2, "LY": 3, "SECOND YEAR": 1, "THIRD YEAR": 2, "FINAL YEAR": 3}

FEATURE_COLS = [
    "year_idx",
    "ssc_pct",
    "hsc_dip_pct",
    "entrance_score",
    "is_diploma",
    "is_jee",
    "is_cet",
    "is_lateral",
    "cgpa_fy",
    "cgpa_sy",
    "cgpa_ty",
    "cgpa_ly",
    "cgpa_latest",
    "cgpa_mean_avail",
    "cgpa_trend",  # latest - first available
    "skill_c",
    "skill_cpp",
    "skill_java",
    "skill_dsa",
    "skill_dbms",
    "skill_networks",
    "skill_python",
    "skill_ai",
    "skill_ml",
    "skill_dl",
    "skill_mean",
    "skill_stem_ai",  # mean AI/ML/DL/Python
    "skill_stem_core",  # C/CPP/Java/DSA
    "n_internships",
    "n_tech_internships",
    "n_nontech_internships",
    "intern_months_total",
    "intern_traj_upgrade",  # nontech→tech or general→AI across slots
    "intern_ai_ml_hits",
    "intern_data_hits",
    "intern_fullstack_hits",
    "intern_cloud_hits",
    "intern_qa_hits",
    "intern_cyber_hits",
    "has_any_internship",
    "missing_entrance",
    "missing_skills_frac",
]

DOMAIN_ROLE_PATTERNS = {
    "AI Developer": re.compile(r"\b(ai|ml|machine learning|deep learning|nlp|computer vision|applied scientist|research intern)\b", re.I),
    "Data Scientist": re.compile(r"\b(data science|data scientist|ml|machine learning|analytics|research)\b", re.I),
    "Data Analyst": re.compile(r"\b(data analyst|sql|bi|business intelligence|analytics)\b", re.I),
    "Fullstack": re.compile(r"\b(full\s*stack|frontend|backend|react|mern|software engineer|developer)\b", re.I),
    "Cloud Developer": re.compile(r"\b(cloud|devops|sre|aws|azure|kubernetes)\b", re.I),
    "QA Tester": re.compile(r"\b(qa|quality|test|sdet)\b", re.I),
    "Cyber Security": re.compile(r"\b(security|cyber|appsec|soc)\b", re.I),
}


def normalize_year(raw: Any) -> str | None:
    s = str(raw or "").strip().upper()
    if not s:
        return None
    if re.search(r"\b(FY|FE|FIRST)\b", s) or s in ("FY", "FE"):
        return "FY"
    if re.search(r"\b(SY|SE|SECOND)\b", s) or "SECOND" in s:
        return "SY"
    if re.search(r"\b(TY|TE|THIRD)\b", s) or "THIRD" in s:
        return "TY"
    if re.search(r"\b(LY|BE|FINAL|LAST)\b", s) or "FINAL" in s:
        return "LY"
    return None


def _f(v, default=np.nan):
    if v is None or v == "" or v == "-":
        return default
    try:
        x = float(v)
        if not np.isfinite(x):
            return default
        return x
    except (TypeError, ValueError):
        return default


def _year_lock_cgpa(year: str | None, fy, sy, ty, ly):
    """Only expose CGPA earned up to current year."""
    y = year or "LY"
    out = {"cgpa_fy": np.nan, "cgpa_sy": np.nan, "cgpa_ty": np.nan, "cgpa_ly": np.nan}
    order = YEAR_ORDER.get(y, 3)
    if order >= 0:
        out["cgpa_fy"] = _f(fy)
    if order >= 1:
        out["cgpa_sy"] = _f(sy)
    if order >= 2:
        out["cgpa_ty"] = _f(ty)
    if order >= 3:
        out["cgpa_ly"] = _f(ly)
    avail = [out[k] for k in ("cgpa_fy", "cgpa_sy", "cgpa_ty", "cgpa_ly") if np.isfinite(out[k])]
    latest = avail[-1] if avail else np.nan
    first = avail[0] if avail else np.nan
    mean = float(np.mean(avail)) if avail else np.nan
    trend = (latest - first) if len(avail) >= 2 else 0.0
    return out, latest, mean, trend


def _internship_feats(row: dict) -> dict:
    n = int(_f(row.get("No. of Internships") or row.get("n_internships") or 0, 0) or 0)
    tech = 0
    nontech = 0
    months = 0.0
    roles = []
    types = []
    for i in range(1, 4):
        role = str(row.get(f"Internship {i} - Role") or row.get(f"intern{i}_role") or "").strip()
        typ = str(row.get(f"Internship {i} - Type") or row.get(f"intern{i}_type") or "").strip()
        dur = _f(row.get(f"Internship {i} - Duration (Months)") or row.get(f"intern{i}_months"), 0)
        if role and role != "-":
            roles.append(role)
            types.append(typ)
            if dur and dur > 0:
                months += dur
            if re.search(r"non[\s-]*tech", typ, re.I):
                nontech += 1
            elif typ and typ != "-":
                tech += 1
            elif role:
                tech += 1  # assume technical if role present without type

    # trajectory upgrade: later slots more technical / AI-heavy than earlier
    upgrade = 0.0
    if len(types) >= 2:
        def score_slot(t, r):
            s = 0
            if re.search(r"non[\s-]*tech", t or "", re.I):
                s = 0
            elif t:
                s = 1
            if DOMAIN_ROLE_PATTERNS["AI Developer"].search(r or ""):
                s += 2
            if DOMAIN_ROLE_PATTERNS["Data Scientist"].search(r or ""):
                s += 1
            return s
        scores = [score_slot(types[i] if i < len(types) else "", roles[i]) for i in range(len(roles))]
        if scores[-1] > scores[0]:
            upgrade = 1.0
        elif scores[-1] > scores[0] - 0.1:
            upgrade = 0.5

    hits = {f"intern_{k}": 0.0 for k in ("ai_ml_hits", "data_hits", "fullstack_hits", "cloud_hits", "qa_hits", "cyber_hits")}
    blob = " ".join(roles)
    if DOMAIN_ROLE_PATTERNS["AI Developer"].search(blob) or DOMAIN_ROLE_PATTERNS["Data Scientist"].search(blob):
        hits["intern_ai_ml_hits"] = 1.0
    if DOMAIN_ROLE_PATTERNS["Data Analyst"].search(blob) or re.search(r"\b(sql|bi|analyst)\b", blob, re.I):
        hits["intern_data_hits"] = 1.0
    if DOMAIN_ROLE_PATTERNS["Fullstack"].search(blob):
        hits["intern_fullstack_hits"] = 1.0
    if DOMAIN_ROLE_PATTERNS["Cloud Developer"].search(blob):
        hits["intern_cloud_hits"] = 1.0
    if DOMAIN_ROLE_PATTERNS["QA Tester"].search(blob):
        hits["intern_qa_hits"] = 1.0
    if DOMAIN_ROLE_PATTERNS["Cyber Security"].search(blob):
        hits["intern_cyber_hits"] = 1.0

    return {
        "n_internships": float(max(n, len(roles))),
        "n_tech_internships": float(tech),
        "n_nontech_internships": float(nontech),
        "intern_months_total": float(months),
        "intern_traj_upgrade": float(upgrade),
        "has_any_internship": 1.0 if (n > 0 or roles) else 0.0,
        **hits,
    }


def row_to_features(row: dict, year_override: str | None = None) -> dict[str, float]:
    """Build FEATURE_COLS dict from a training Excel row or API body dict."""
    year = normalize_year(year_override or row.get("Current Year") or row.get("year") or row.get("yearLevel"))
    year_idx = float(YEAR_ORDER.get(year or "LY", 3))

    ssc = _f(row.get("SSC %") or row.get("ssc_pct") or row.get("tenthPercent"))
    hsc = _f(row.get("10+2 / Diploma %") or row.get("hsc_dip_pct") or row.get("twelfthPercent") or row.get("diplomaPercent"))
    entrance = _f(row.get("Entrance Score") or row.get("entrance_score") or row.get("cetPercent") or row.get("jeePercent"))
    stream = str(row.get("10+2 / Diploma") or row.get("stream") or "").upper()
    exam = str(row.get("Entrance Exam") or row.get("entrance_exam") or "").upper()

    fy = row.get("FY CGPA") or row.get("cgpa_fy") or row.get("fyCgpa")
    sy = row.get("SY CGPA") or row.get("cgpa_sy") or row.get("syCgpa")
    ty = row.get("TY CGPA") or row.get("cgpa_ty") or row.get("tyCgpa")
    ly = row.get("LY CGPA") or row.get("cgpa_ly") or row.get("lyCgpa") or row.get("cgpa")

    locked, latest, mean_cgpa, trend = _year_lock_cgpa(year, fy, sy, ty, ly)

    skills = {
        "skill_c": _f(row.get("C") or row.get("skill_c") or row.get("skillC")),
        "skill_cpp": _f(row.get("C++") or row.get("skill_cpp") or row.get("skillCpp")),
        "skill_java": _f(row.get("OOM (Java)") or row.get("skill_java") or row.get("skillJava") or row.get("skillOop")),
        "skill_dsa": _f(row.get("NLDS / Data Structures") or row.get("skill_dsa") or row.get("skillDsa")),
        "skill_dbms": _f(row.get("DBMS") or row.get("skill_dbms") or row.get("skillDbms")),
        "skill_networks": _f(row.get("Computer Networks") or row.get("skill_networks") or row.get("skillCn")),
        "skill_python": _f(row.get("Python") or row.get("skill_python") or row.get("skillPython")),
        "skill_ai": _f(row.get("AI") or row.get("skill_ai") or row.get("skillAi")),
        "skill_ml": _f(row.get("ML") or row.get("skill_ml") or row.get("skillMl")),
        "skill_dl": _f(row.get("DL") or row.get("skill_dl") or row.get("skillDl")),
    }
    skill_vals = [v for v in skills.values() if np.isfinite(v)]
    missing_skills_frac = 1.0 - (len(skill_vals) / max(len(skills), 1))
    skill_mean = float(np.mean(skill_vals)) if skill_vals else np.nan
    ai_stack = [skills[k] for k in ("skill_python", "skill_ai", "skill_ml", "skill_dl") if np.isfinite(skills[k])]
    core_stack = [skills[k] for k in ("skill_c", "skill_cpp", "skill_java", "skill_dsa") if np.isfinite(skills[k])]

    inter = _internship_feats(row)

    feat = {
        "year_idx": year_idx,
        "ssc_pct": ssc,
        "hsc_dip_pct": hsc,
        "entrance_score": entrance,
        "is_diploma": 1.0 if "DIPLOMA" in stream else 0.0,
        "is_jee": 1.0 if "JEE" in exam else 0.0,
        "is_cet": 1.0 if "CET" in exam else 0.0,
        "is_lateral": 1.0 if "LATERAL" in exam or "DIPLOMA LATERAL" in exam else 0.0,
        **locked,
        "cgpa_latest": latest,
        "cgpa_mean_avail": mean_cgpa,
        "cgpa_trend": float(trend) if np.isfinite(trend) else 0.0,
        **skills,
        "skill_mean": skill_mean,
        "skill_stem_ai": float(np.mean(ai_stack)) if ai_stack else np.nan,
        "skill_stem_core": float(np.mean(core_stack)) if core_stack else np.nan,
        **inter,
        "missing_entrance": 1.0 if not np.isfinite(entrance) else 0.0,
        "missing_skills_frac": float(missing_skills_frac),
    }
    # ensure all keys
    for c in FEATURE_COLS:
        feat.setdefault(c, np.nan)
    return {c: feat[c] for c in FEATURE_COLS}


def dataframe_from_excel(path: str) -> tuple[pd.DataFrame, pd.Series]:
    df = pd.read_excel(path, sheet_name="Training_Data")
    rows = []
    labels = []
    for _, r in df.iterrows():
        d = r.to_dict()
        labels.append(str(d.get("Target Domain") or "").strip())
        rows.append(row_to_features(d))
    X = pd.DataFrame(rows, columns=FEATURE_COLS)
    y = pd.Series(labels, name="Target Domain")
    return X, y


def readiness_proxy_from_features(feat: dict) -> float:
    """0–100 readiness when no historical place labels — used as secondary target."""
    score = 40.0
    cg = feat.get("cgpa_latest")
    if cg is not None and np.isfinite(cg):
        score += max(-15, min(25, (cg - 7.0) * 12))
    if feat.get("has_any_internship"):
        score += 12
    score += min(15, (feat.get("n_tech_internships") or 0) * 5)
    score += min(8, (feat.get("intern_months_total") or 0) * 0.8)
    sm = feat.get("skill_mean")
    if sm is not None and np.isfinite(sm):
        score += max(-10, min(15, (sm - 60) * 0.35))
    if feat.get("intern_traj_upgrade"):
        score += 6
    return float(max(5, min(98, score)))
