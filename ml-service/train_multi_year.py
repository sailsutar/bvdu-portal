"""
Train year-specific Random Forest models for BVU Portal — EARLY-WARNING mode.

Each model forecasts END-OF-TERM status (At Risk | Average | Good) using ONLY
early-term signals available around UT-1 time:
  attendance (to-date), mean UT-1, UT-1 fail count/rate, subject coverage,
  absent markers.

Labels are computed from FULL-term academic outcomes only (average %, fail
rate, absence rate among UT columns) via label_status() — attendance is NOT
used in the label, so it can safely appear as an early input feature without
label leakage. The model never sees RE-UT or full-term averages as inputs.

Pipelines:
  - fy    → First-year Excel (or synthetic fallback)
  - sy    → SY Excel (or synthetic fallback)
  - ty    → TY Excel (or synthetic fallback)
  - final → Final-year / LY Excel (or synthetic fallback)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from openpyxl import load_workbook
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, VotingClassifier, HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.metrics import accuracy_score, classification_report, mean_absolute_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder

PASS_UT = 8
OUT = Path(__file__).parent / "models"

# ---------------------------------------------------------------------------
# Feature schema — EARLY signals only (model input)
# Order is contract with serve.py FEATURE_COLS / SHAP explainer.
# ---------------------------------------------------------------------------
# Adaptive Unit Tests: values in mean_ut1 / ut1_* are over AVAILABLE UTs
# (UT-1 only if no UT-2; UT-1+UT-2 when UT-2 exists). Names kept for serve.py contract.
EARLY_FEATURE_COLS = [
    "attendance",
    "mean_ut1",
    "n_ut1_present",
    "n_subjects",
    "ut1_fail_count",
    "ut1_fail_rate",
    "n_absent_markers",
]

# Full-term fields kept only for label / regressor target construction — never in X
FULL_TERM_LABEL_FIELDS = [
    "mean_ut2",
    "mean_reut",
    "mean_subject_avg",
    "mean_subject_pct",
    "fail_count",       # UT-1 + UT-2 combined
    "fail_rate",        # UT-1 + UT-2 combined
    "n_ut2_present",
    "avg_pct",
]

# Backward-compat alias used in metrics / docs
FEATURE_COLS = EARLY_FEATURE_COLS


def to_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if np.isfinite(v) else None
    s = str(v).strip()
    if not s or re.match(r"^(defaulter|df|def|ab|absent|na|n/a|#num!|#value!|#ref!|-)$", s, re.I):
        return None
    m = re.search(r"-?\d+(\.\d+)?", s.replace(",", ""))
    return float(m.group(0)) if m else None


def is_absent_marker(v):
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("defaulter", "df", "def", "ab", "absent", "na", "n/a") or s.startswith("def")


def find_header_row(rows, max_scan=10):
    for i, row in enumerate(rows[:max_scan]):
        cells = [str(c or "").strip().lower() for c in row]
        if "prn" in cells or "prn_number" in cells:
            return i
    best_i, best_s = 0, -1
    for i, row in enumerate(rows[:max_scan]):
        cells = [str(c or "").strip() for c in row]
        score = 0
        for c in cells:
            cl = c.lower()
            if cl in ("prn", "prn_number") or ("student" in cl and "name" in cl):
                score += 15
            if re.search(r"_(ut-?1|ut-?2|re-?ut|average|pct)", c, re.I):
                score += 2
            if cl.startswith("attendance_") or cl in ("average_%", "total_attendance_%", "overall_attendance"):
                score += 1
            if cl in ("administrative", "ut marks", "unit test marks", "attendance summary"):
                score -= 8
        if score > best_s:
            best_s, best_i = score, i
    return best_i


def parse_academic_col(h: str):
    h = (h or "").strip()
    for suf, canon in [
        ("RE-UT", "RE-UT"),
        ("RE_UT", "RE-UT"),
        ("UT-1", "UT-1"),
        ("UT_1", "UT-1"),
        ("UT-2", "UT-2"),
        ("UT_2", "UT-2"),
        ("Average", "Average"),
        ("Avg", "Average"),
        ("_Pct", "Pct"),
        ("Pct", "Pct"),
        ("Percentage", "Pct"),
        ("Total", "Total"),
    ]:
        if re.search(r"[_\s]" + re.escape(suf) + r"$", h, re.I) or h.upper().endswith(suf.upper()):
            subj = re.sub(r"[_\s]*" + re.escape(suf) + r"$", "", h, flags=re.I).replace("_", " ").strip()
            if subj:
                return subj, canon
    return None, None


def label_status(avg_pct, fail_count, n_assess, n_absent=0):
    """End-of-term status from FULL-term academic outcomes only (used as y).

    Intentionally does NOT use attendance: the same attendance figure is an
    early-warning input feature, and using it here would leak the label into X.
    """
    pct = avg_pct if avg_pct is not None and not (isinstance(avg_pct, float) and np.isnan(avg_pct)) else 50.0
    fail_rate = fail_count / max(n_assess, 1)
    absent_rate = n_absent / max(n_assess + n_absent, 1)
    if pct < 50 or fail_rate >= 0.4 or absent_rate >= 0.35:
        return "At Risk"
    if pct >= 72 and fail_rate <= 0.15 and absent_rate <= 0.1:
        return "Good"
    return "Average"


def load_sheet(path: str) -> tuple[list[str], list[tuple]]:
    path = str(path)
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path, dtype=object, keep_default_na=False)
        headers = [str(c or "").strip() for c in df.columns]
        data = [tuple(row) for row in df.itertuples(index=False, name=None)]
        data = [r for r in data if any(x is not None and str(x).strip() for x in r)]
        return headers, data
    wb = load_workbook(path, data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    hi = find_header_row(rows)
    headers = [str(c or "").strip() if c is not None else f"Col_{i}" for i, c in enumerate(rows[hi])]
    data = [r for r in rows[hi + 1 :] if r and any(x is not None and str(x).strip() for x in r)]
    return headers, data


def build_features_from_rows(headers, data, year: str) -> pd.DataFrame:
    meta = {}
    academic = []
    att_pct_cols = []
    for i, h in enumerate(headers):
        hl = h.lower().replace(" ", "_")
        if hl in ("prn", "prn_number"):
            meta["prn"] = i
        elif "student" in hl and "name" in hl or hl in ("name", "student_name"):
            meta["name"] = i
        elif hl in ("section", "division", "class", "group"):
            meta["section"] = i
        elif hl in ("overall_attendance", "total_attendance_%", "total_attendance"):
            meta["attendance"] = i
        elif hl in ("average_%", "average_pct", "average_without_leave_%"):
            # Academic overall % (label target) — not attendance
            meta.setdefault("avg_pct", i)
        elif (
            "attendance" in hl
            and ("%" in h or "pct" in hl or hl.endswith("attendance") or "attendance(" in hl)
        ) or re.search(r"attendance_.*_%$", hl) or (hl.startswith("attendance_") and hl.endswith("_%")):
            # Per-subject attendance columns e.g. Industrial_IoT_Attendance(%)
            att_pct_cols.append(i)
        elif hl.endswith("_theory_%") or hl.endswith("_lab_%") or hl.endswith("_pct"):
            # Subject/lab attendance percentages (TY-style Machine_Learning_Pct)
            if "lab" in hl or "theory" in hl or hl.endswith("_pct"):
                att_pct_cols.append(i)
        else:
            subj, assess = parse_academic_col(h)
            if subj and assess:
                academic.append((i, subj, assess))

    if "attendance" not in meta:
        for i, h in enumerate(headers):
            hl = h.lower().replace(" ", "_")
            if hl in ("overall_attendance", "total_attendance_%", "total_attendance"):
                meta["attendance"] = i
                break
    # Prefer mean of per-subject attendance % when no single overall column
    if "avg_pct" not in meta and "attendance" in meta:
        # Do NOT copy attendance into avg_pct — that reintroduces label leakage
        # via the label using the same number as the feature.
        pass

    records = []
    for row in data:
        if meta.get("prn") is None or meta["prn"] >= len(row):
            continue
        prn = str(row[meta["prn"]] or "").strip()
        if not prn or prn.lower() in ("none", "prn", "prn_number"):
            continue

        attendance = to_num(row[meta["attendance"]]) if meta.get("attendance") is not None else None
        avg_pct = to_num(row[meta["avg_pct"]]) if meta.get("avg_pct") is not None else None

        if attendance is None and att_pct_cols:
            vals = [to_num(row[j]) for j in att_pct_cols if j < len(row)]
            vals = [v for v in vals if v is not None]
            if vals:
                attendance = float(np.mean(vals))

        ut1s, ut2s, reuts, avgs, pcts = [], [], [], [], []
        fail_count = 0          # combined UT-1 + UT-2 (label only)
        ut1_fail_count = 0      # UT-1 only (model input)
        n_absent = 0
        subjects = set()

        for idx, subj, assess in academic:
            if idx >= len(row):
                continue
            subjects.add(subj)
            raw = row[idx]
            if is_absent_marker(raw):
                # Early feature: only UT-1 / UT-2 absences are known at early-warning time.
                # RE-UT and Average absence markers are full-term and must not enter X.
                if assess in ("UT-1", "UT-2"):
                    n_absent += 1
                continue
            val = to_num(raw)
            if val is None:
                continue
            if assess == "UT-1":
                ut1s.append(val)
                if val < PASS_UT:
                    fail_count += 1
                    ut1_fail_count += 1
            elif assess == "UT-2":
                ut2s.append(val)
                if val < PASS_UT:
                    fail_count += 1
            elif assess == "RE-UT":
                reuts.append(val)
            elif assess == "Average":
                avgs.append(val)
            elif assess == "Pct":
                pcts.append(val)

        if year == "final" and not ut1s and not ut2s:
            if att_pct_cols:
                vals = [to_num(row[j]) for j in att_pct_cols if j < len(row)]
                vals = [v for v in vals if v is not None]
                if vals:
                    pcts = vals
                    if avg_pct is None:
                        avg_pct = float(np.mean(vals))

        n_assess = max(len(ut1s) + len(ut2s), 1)
        n_ut1 = max(len(ut1s), 1)
        if avg_pct is None:
            if pcts:
                avg_pct = float(np.mean(pcts))
            elif avgs:
                # Subject averages are on a 0–20 scale → approximate overall %
                avg_pct = float(np.clip(np.mean(avgs) / 20.0 * 100.0, 0, 100))
            elif ut1s or ut2s:
                all_u = list(ut1s) + list(ut2s)
                avg_pct = float(np.clip(np.mean(all_u) / 20.0 * 100.0, 0, 100))
            else:
                # Do not fall back to attendance — that would leak into the label
                avg_pct = np.nan

        # Adaptive model inputs: UT-1 only if no UT-2; else pool both
        if ut2s:
            pool = list(ut1s) + list(ut2s)
        else:
            pool = list(ut1s)
        pool_fails = sum(1 for x in pool if x < PASS_UT)
        n_pool = max(len(pool), 1)

        feat = {
            "prn": prn,
            "year": year,
            # --- AVAILABLE UTs (model input; adaptive) ---
            "attendance": attendance if attendance is not None else np.nan,
            "mean_ut1": float(np.mean(pool)) if pool else np.nan,
            "n_ut1_present": float(len(pool)),
            "n_subjects": float(len(subjects)) if subjects else float(len(att_pct_cols) or 0),
            "ut1_fail_count": float(pool_fails),
            "ut1_fail_rate": float(pool_fails / n_pool),
            "n_absent_markers": float(n_absent),
            # --- FULL-TERM (label / target only) ---
            "mean_ut2": float(np.mean(ut2s)) if ut2s else np.nan,
            "mean_reut": float(np.mean(reuts)) if reuts else np.nan,
            "mean_subject_avg": float(np.mean(avgs)) if avgs else np.nan,
            "mean_subject_pct": float(np.mean(pcts)) if pcts else np.nan,
            "n_ut2_present": float(len(ut2s)),
            "fail_count": float(fail_count),
            "fail_rate": float(fail_count / n_assess),
            "avg_pct": avg_pct if avg_pct is not None else np.nan,
        }
        feat["status"] = label_status(
            feat["avg_pct"], fail_count, n_assess, n_absent
        )
        records.append(feat)

    return pd.DataFrame(records)


def _seed_stats(seed_df: pd.DataFrame) -> dict:
    """Summarise a real cohort so synthetic rows match its distributions."""
    att = seed_df["attendance"].dropna().astype(float)
    mut = seed_df["mean_ut1"].dropna().astype(float)
    ap = seed_df["avg_pct"].dropna().astype(float)
    nsub = seed_df["n_subjects"].dropna().astype(float)
    nabs = seed_df["n_absent_markers"].dropna().astype(float)
    n_ut = seed_df["n_ut1_present"].dropna().astype(float)

    def _ms(s, default_mu, default_sd):
        if len(s) < 3:
            return float(default_mu), float(default_sd)
        return float(s.mean()), float(max(s.std(), 1e-3))

    att_mu, att_sd = _ms(att, 65.0, 18.0)
    mut_mu, mut_sd = _ms(mut, 10.0, 4.0)
    ap_mu, ap_sd = _ms(ap, 55.0, 18.0)
    nsub_mu = float(nsub.median()) if len(nsub) else 5.0
    nabs_mu, nabs_sd = _ms(nabs, 0.8, 1.5)
    # Correlation proxies from seed
    corr_att_mut = 0.35
    if len(att) > 10 and len(mut) > 10:
        joined = seed_df[["attendance", "mean_ut1"]].dropna()
        if len(joined) > 10:
            c = float(joined["attendance"].corr(joined["mean_ut1"]))
            if np.isfinite(c):
                corr_att_mut = float(np.clip(c, -0.85, 0.85))
    return {
        "att_mu": att_mu,
        "att_sd": att_sd,
        "mut_mu": mut_mu,
        "mut_sd": mut_sd,
        "ap_mu": ap_mu,
        "ap_sd": ap_sd,
        "n_subj": max(3, int(round(nsub_mu))),
        "nabs_mu": nabs_mu,
        "nabs_sd": nabs_sd,
        "corr_att_mut": corr_att_mut,
        "typical_n_ut": float(n_ut.median()) if len(n_ut) else float(nsub_mu * 2),
    }


def generate_synthetic_from_seed(
    seed_df: pd.DataFrame, year: str, n: int = 3600, seed: int = 42
) -> pd.DataFrame:
    """
    Expand a real uploaded cohort into a large synthetic training set.

    Distributions (attendance, UT means, fail tendency, absences) are fit from
    the real seed so the synthetic students look like the uploaded batch — not
    a generic random cohort. Labels still use label_status() on full-term
    outcomes only (no attendance in the label → no leak).
    """
    st = _seed_stats(seed_df)
    rng = np.random.default_rng(seed + hash(year) % 1000)
    n_subj = st["n_subj"]
    records = []

    for i in range(n):
        # Shared latent ability → correlated attendance + UT performance
        ability = rng.normal(0, 1)
        # Match seed mean/std while keeping ability-driven structure
        attendance = float(
            np.clip(
                st["att_mu"]
                + ability * st["att_sd"] * 0.7
                + rng.normal(0, st["att_sd"] * 0.5),
                0,
                100,
            )
        )
        # UT marks centered on seed mean_ut1
        ut1s = []
        ut1_fails = 0
        for _ in range(n_subj):
            u1 = float(
                np.clip(
                    st["mut_mu"]
                    + ability * st["mut_sd"] * 0.8
                    + rng.normal(0, st["mut_sd"] * 0.55),
                    0,
                    20,
                )
            )
            ut1s.append(u1)
            if u1 < PASS_UT:
                ut1_fails += 1

        ut2s = []
        combined_fails = ut1_fails
        for u1 in ut1s:
            u2 = float(np.clip(u1 + rng.normal(0, 2.8) + ability * 0.35, 0, 20))
            ut2s.append(u2)
            if u2 < PASS_UT:
                combined_fails += 1

        mean_u = (np.mean(ut1s) + np.mean(ut2s)) / 2
        # avg_pct: blend UT-derived % with seed avg_pct distribution
        ut_pct = (mean_u / 20.0) * 100.0
        avg_pct = float(
            np.clip(
                0.55 * ut_pct
                + 0.45 * (st["ap_mu"] + ability * st["ap_sd"] * 0.6 + rng.normal(0, st["ap_sd"] * 0.4)),
                0,
                100,
            )
        )

        n_absent = int(
            np.clip(
                round(st["nabs_mu"] + (1.5 if attendance < 60 else 0) + rng.normal(0, max(st["nabs_sd"], 0.5))),
                0,
                n_subj * 2,
            )
        )
        n_assess = n_subj * 2
        status = label_status(avg_pct, combined_fails, n_assess, n_absent)

        # Stage mix: pre-UT / post-UT-1 / post-UT-2
        stage_roll = rng.random()
        if stage_roll < 0.10:
            pool, n_ut2_present, ut2_done = [], 0.0, False
        elif stage_roll < 0.48:
            pool, n_ut2_present, ut2_done = list(ut1s), 0.0, False
        else:
            pool, n_ut2_present, ut2_done = list(ut1s) + list(ut2s), float(n_subj), True
        pool_fails = sum(1 for x in pool if x < PASS_UT)
        n_pool = max(len(pool), 1)

        records.append(
            {
                "prn": f"{year.upper()}S{i:04d}",
                "year": year,
                "attendance": attendance,
                "mean_ut1": float(np.mean(pool)) if pool else np.nan,
                "n_ut1_present": float(len(pool)),
                "n_subjects": float(n_subj),
                "ut1_fail_count": float(pool_fails),
                "ut1_fail_rate": float(pool_fails / n_pool) if pool else 0.0,
                "n_absent_markers": float(n_absent),
                "mean_ut2": float(np.mean(ut2s)) if ut2_done else np.nan,
                "mean_reut": np.nan,
                "mean_subject_avg": mean_u,
                "mean_subject_pct": avg_pct,
                "n_ut2_present": n_ut2_present,
                "fail_count": float(combined_fails),
                "fail_rate": float(combined_fails / n_assess),
                "avg_pct": avg_pct,
                "status": status,
            }
        )

    return pd.DataFrame(records)


def generate_synthetic_cohort(year: str, n: int = 3600, seed: int = 42) -> pd.DataFrame:
    """
    Fallback synthetic cohort when no real Excel/CSV is present.
    Prefer generate_synthetic_from_seed() when a real upload exists.
    """
    # Neutral defaults approximating a mixed CSE cohort
    dummy = pd.DataFrame(
        {
            "attendance": [65.0],
            "mean_ut1": [10.0],
            "avg_pct": [55.0],
            "n_subjects": [5 if year != "final" else 4],
            "n_absent_markers": [1.0],
            "n_ut1_present": [8.0],
        }
    )
    return generate_synthetic_from_seed(dummy, year, n=n, seed=seed)


def train_one(year: str, excel_path: str | None) -> dict:
    print(f"\n===== Training pipeline: {year.upper()} (early-warning) =====")
    source_note = None
    split_limitation = None

    TARGET_N = {"sy": 3600, "ty": 3600, "final": 3600}

    if excel_path and Path(excel_path).exists():
        print("Loading real upload:", excel_path)
        headers, data = load_sheet(excel_path)
        seed_df = build_features_from_rows(headers, data, year)
        print(f"  Real seed students: {len(seed_df)}  status={seed_df['status'].value_counts().to_dict()}")
        target_n = TARGET_N.get(year, 3600)
        print(f"  Expanding → {target_n} synthetic rows inspired by real distributions")
        df = generate_synthetic_from_seed(seed_df, year, n=target_n)
        # Keep real rows in the mix so the model still sees actual students
        df = pd.concat([df, seed_df], ignore_index=True)
        source_file = Path(excel_path).name
        source_note = (
            f"Trained on {target_n} synthetic students generated from real upload "
            f"({source_file}, n_seed={len(seed_df)}) plus the real rows. "
            "Synthetic matches seed attendance/UT/absence distributions; labels via "
            "label_status() without attendance (no leak)."
        )
        split_limitation = (
            "Synthetic-from-seed + real rows: holdout is random stratified within the "
            "expanded cohort, not a cross-term generalization test."
        )
    else:
        print(f"Excel missing for {year} — generating unconditioned synthetic cohort")
        target_n = TARGET_N.get(year, 3600)
        df = generate_synthetic_cohort(year, n=target_n)
        source_file = f"synthetic_early_warning_{year}.csv"
        source_note = (
            "No real upload found; synthetic cohort with neutral priors. "
            "Prefer uploading real Excel/CSV so generation is seed-conditioned."
        )
        split_limitation = (
            "Unconditioned synthetic data: random stratified holdout only. "
            "Not a cross-term generalization test."
        )

    print(f"Students: {len(df)}")
    print(df["status"].value_counts().to_dict())

    if len(df) < 50:
        raise RuntimeError(f"Too few rows for {year}: {len(df)}")

    # X = early features ONLY
    X = df[EARLY_FEATURE_COLS].copy()
    medians = X.median()
    X = X.fillna(medians)
    y_class = df["status"]
    y_reg = df["avg_pct"].fillna(df["avg_pct"].median())

    le = LabelEncoder()
    y_enc = le.fit_transform(y_class)

    # Adaptive holdout: smaller cohorts need a larger train share so trees can fit
    n_rows = len(df)
    test_size = 0.25 if n_rows < 100 else 0.40
    leaf = max(2, min(15, n_rows // 12))
    split_min = max(4, leaf * 2)
    cal_cv = 2 if n_rows < 80 else 3

    # Stratified random split (grouped/cohort split not possible with single file)
    try:
        X_tr, X_te, y_tr, y_te, yr_tr, yr_te = train_test_split(
            X, y_enc, y_reg, test_size=test_size, random_state=42, stratify=y_enc
        )
    except ValueError:
        X_tr, X_te, y_tr, y_te, yr_tr, yr_te = train_test_split(
            X, y_enc, y_reg, test_size=test_size, random_state=42
        )

    rf = RandomForestClassifier(
        n_estimators=150,
        max_depth=6,
        min_samples_leaf=leaf,
        min_samples_split=split_min,
        max_features="sqrt",
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    hgb = HistGradientBoostingClassifier(
        max_depth=6,
        max_iter=120,
        learning_rate=0.08,
        min_samples_leaf=max(leaf, 5),
        random_state=42,
    )
    # Soft-vote ensemble of RF + histogram gradient boosting
    ensemble = VotingClassifier(
        estimators=[("rf", rf), ("hgb", hgb)],
        voting="soft",
        weights=[1.0, 1.2],
    )
    # Probability calibration (sigmoid is stabler than isotonic on tiny cohorts)
    cal_method = "sigmoid" if n_rows < 100 else "isotonic"
    clf = CalibratedClassifierCV(ensemble, method=cal_method, cv=cal_cv)
    clf.fit(X_tr, y_tr)
    pred = clf.predict(X_te)
    proba = clf.predict_proba(X_te)
    acc = accuracy_score(y_te, pred)
    print(f"Holdout accuracy (calibrated ensemble): {acc:.4f}")
    print(classification_report(y_te, pred, target_names=list(le.classes_), zero_division=0))

    # Brier / log-loss for calibration quality
    try:
        # multi-class brier: mean squared error on one-hot
        y_te_oh = np.eye(len(le.classes_))[y_te]
        brier = float(np.mean(np.sum((proba - y_te_oh) ** 2, axis=1)))
    except Exception:
        brier = None
    try:
        ll = float(log_loss(y_te, proba, labels=list(range(len(le.classes_)))))
    except Exception:
        ll = None

    print(f"Brier(multi)={brier}  log_loss={ll}")

    # ---- Split conformal prediction (multi-class, score = 1 - p_true) ----
    ALPHA = 0.10  # target ~90% coverage
    n_cal = len(y_te)
    nonconf = 1.0 - proba[np.arange(n_cal), y_te]
    # Finite-sample quantile level
    q_level = min(1.0, np.ceil((n_cal + 1) * (1 - ALPHA)) / max(n_cal, 1))
    q_hat = float(np.percentile(nonconf, 100 * q_level))
    # Empirical coverage of prediction sets on holdout
    set_sizes = []
    covered = 0
    for i in range(n_cal):
        sset = [int(c) for c in range(len(le.classes_)) if (1.0 - proba[i, c]) <= q_hat + 1e-12]
        set_sizes.append(len(sset))
        if int(y_te[i]) in sset:
            covered += 1
    conformal = {
        "alpha": ALPHA,
        "target_coverage": 1 - ALPHA,
        "q_hat": q_hat,
        "empirical_coverage": float(covered / max(n_cal, 1)),
        "mean_set_size": float(np.mean(set_sizes)) if set_sizes else 1.0,
        "n_calibration": int(n_cal),
        "method": "split_conformal_softmax_nonconformity",
    }
    print(f"Conformal α={ALPHA}: q_hat={q_hat:.4f} coverage={conformal['empirical_coverage']:.3f} mean_set={conformal['mean_set_size']:.2f}")

    # ---- Cost-sensitive decision thresholds (higher cost of missing At Risk) ----
    classes_list = list(le.classes_)
    at_risk_idx = classes_list.index("At Risk") if "At Risk" in classes_list else 0
    # Policy: flag At Risk if p_at_risk >= tau (tuned for higher recall on At Risk)
    best_tau, best_score = 0.35, -1.0
    for tau in np.linspace(0.25, 0.55, 7):
        pol = []
        for i in range(n_cal):
            if proba[i, at_risk_idx] >= tau:
                pol.append(at_risk_idx)
            else:
                pol.append(int(np.argmax(proba[i])))
        pol = np.array(pol)
        # score = recall_at_risk - 0.3 * FPR_on_goodish
        y_bin = (y_te == at_risk_idx).astype(int)
        p_bin = (pol == at_risk_idx).astype(int)
        tp = int(((y_bin == 1) & (p_bin == 1)).sum())
        fn = int(((y_bin == 1) & (p_bin == 0)).sum())
        fp = int(((y_bin == 0) & (p_bin == 1)).sum())
        tn = int(((y_bin == 0) & (p_bin == 0)).sum())
        recall = tp / max(tp + fn, 1)
        fpr = fp / max(fp + tn, 1)
        score = recall - 0.35 * fpr
        if score > best_score:
            best_score, best_tau = score, float(tau)
    cost_policy = {
        "at_risk_probability_threshold": best_tau,
        "objective": "maximize_at_risk_recall_minus_0.35_fpr",
        "holdout_score": float(best_score),
        "note": "Predict At Risk if calibrated P(At Risk) >= threshold; else argmax class.",
    }
    print(f"Cost-sensitive τ(At Risk)={best_tau:.3f} score={best_score:.3f}")

    # ---- Simple uplift prior (feature-based proxy until outcome logs are rich) ----
    # Higher uplift when mid attendance + weak UT (intervenable); lower if already strong or extreme
    att = X_te["attendance"].values if "attendance" in X_te.columns else np.full(n_cal, 75.0)
    mut = X_te["mean_ut1"].values if "mean_ut1" in X_te.columns else np.full(n_cal, 10.0)
    uplift_proxy = []
    for a, u in zip(att, mut):
        # tent map: peak around att 55-75 and mean UT 6-11
        ua = max(0, 1 - abs(float(a) - 65) / 25)
        uu = max(0, 1 - abs(float(u) - 8.5) / 6)
        uplift_proxy.append(float(0.15 + 0.7 * ua * uu))
    uplift_stats = {
        "method": "heuristic_intervenable_region",
        "mean": float(np.mean(uplift_proxy)),
        "p90": float(np.percentile(uplift_proxy, 90)),
        "description": "Prior uplift score in [0,1]; refined by intervention outcomes in portal.",
    }


    try:
        cv = cross_val_score(ensemble, X, y_enc, cv=5, scoring="accuracy", n_jobs=-1)
        cv_mean, cv_std = float(cv.mean()), float(cv.std())
    except Exception:
        cv_mean, cv_std = acc, 0.0
    print(f"5-fold CV (uncalibrated ensemble): {cv_mean:.4f} +/- {cv_std:.4f}")

    if acc > 0.90:
        print(
            f"WARNING: holdout accuracy {acc:.3f} still > 0.90 — possible label leakage "
            f"in early features (e.g. end-of-term attendance used as attendance-to-date)."
        )

    reg = RandomForestRegressor(
        n_estimators=120, max_depth=6, min_samples_leaf=leaf, min_samples_split=split_min,
        max_features="sqrt", random_state=42, n_jobs=-1
    )
    reg.fit(X_tr, yr_tr)
    yr_pred = reg.predict(X_te)
    mae = float(mean_absolute_error(yr_te, yr_pred))
    r2 = float(r2_score(yr_te, yr_pred))
    print(f"Regressor MAE={mae:.3f} R2={r2:.4f}")

    # SHAP base model: RF fit on full data (TreeExplainer-friendly)
    rf_shap = RandomForestClassifier(
        n_estimators=150,
        max_depth=6,
        min_samples_leaf=leaf,
        min_samples_split=split_min,
        max_features="sqrt",
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    rf_shap.fit(X, y_enc)

    # Full refit calibrated ensemble on all data
    clf.fit(X, y_enc)
    reg.fit(X, y_reg)

    # Fairness slices on holdout (by attendance band as proxy for cohort segments)
    fairness = []
    att_te = X_te["attendance"].values if "attendance" in X_te.columns else None
    if att_te is not None:
        bands = [("low_att_<70", att_te < 70), ("mid_att_70_85", (att_te >= 70) & (att_te < 85)), ("high_att_>=85", att_te >= 85)]
        for name, mask in bands:
            if mask.sum() < 8:
                continue
            fairness.append({
                "slice": name,
                "n": int(mask.sum()),
                "accuracy": float(accuracy_score(y_te[mask], pred[mask])),
            })

    # Training distribution for drift detection at serve time
    feature_stats = {}
    for col in EARLY_FEATURE_COLS:
        col_v = X[col].astype(float)
        feature_stats[col] = {
            "mean": float(col_v.mean()),
            "std": float(col_v.std() or 1.0),
            "p05": float(col_v.quantile(0.05)),
            "p95": float(col_v.quantile(0.95)),
        }

    prefix = f"{year}_"
    joblib.dump(clf, OUT / f"{prefix}rf_status_classifier.joblib")  # calibrated ensemble
    joblib.dump(rf_shap, OUT / f"{prefix}rf_shap_base.joblib")
    joblib.dump(reg, OUT / f"{prefix}rf_avg_regressor.joblib")
    joblib.dump(le, OUT / f"{prefix}label_encoder.joblib")
    joblib.dump(medians.to_dict(), OUT / f"{prefix}feature_medians.joblib")

    train_acc = float(accuracy_score(y_tr, clf.predict(X_tr)))
    gap = train_acc - float(acc)
    metrics = {
        "year": year,
        "mode": "early_warning_ensemble_calibrated",
        "description": (
            "Calibrated soft-vote ensemble (Random Forest + HistGradientBoosting). "
            "Adaptive Unit Tests: UT-1 only if UT-2 blank; UT-1+UT-2 when present. "
            "Labels from full-term outcomes. SHAP uses RF base model."
        ),
        "stack": [
            "RandomForestClassifier",
            "HistGradientBoostingClassifier",
            "VotingClassifier(soft)",
            "CalibratedClassifierCV(isotonic)",
            "Split conformal prediction (α=0.10)",
            "Cost-sensitive At Risk threshold",
            "Uplift prior for interventions",
            "SHAP TreeExplainer on RF base",
        ],
        "n_samples": int(len(df)),
        "train_size": int(len(X_tr)),
        "test_size": int(len(X_te)),
        "train_ratio": round(1.0 - test_size, 2),
        "test_ratio": float(test_size),
        "min_samples_leaf": int(leaf),
        "calibration_method": cal_method,
        "feature_cols": list(EARLY_FEATURE_COLS),
        "early_feature_cols": list(EARLY_FEATURE_COLS),
        "adaptive_unit_tests": True,
        "label_uses_full_term": True,
        "classes": list(le.classes_),
        "status_counts": df["status"].value_counts().to_dict(),
        "accuracy_train": train_acc,
        "accuracy_test": float(acc),
        "accuracy_holdout": float(acc),
        "overfit_gap": float(gap),
        "cv_accuracy_mean": cv_mean,
        "cv_accuracy_std": cv_std,
        "brier_multiclass": brier,
        "log_loss": ll,
        "conformal": conformal,
        "cost_policy": cost_policy,
        "uplift_prior": uplift_stats,
        "fairness_slices": fairness,
        "feature_stats": feature_stats,
        "regressor_mae": mae,
        "regressor_r2": r2,
        "pass_ut_threshold": PASS_UT,
        "model_params": {
            "ensemble": "RF + HistGB soft vote, weights [1, 1.2]",
            "calibration": "isotonic cv=3",
            "rf_n_estimators": 150,
            "rf_max_depth": 6,
        },
        "source_file": source_file,
        "split_type": "random_stratified_within_cohort",
        "split_limitation": split_limitation,
    }
    if source_note:
        metrics["data_note"] = source_note
    if acc > 0.90:
        metrics["leakage_warning"] = (
            f"Holdout accuracy {acc:.3f} > 0.90 — check that attendance is "
            "to-date-at-UT1, not end-of-term, and that no full-term field entered X."
        )

    print(f"Train acc={train_acc:.4f}  Test acc={acc:.4f}  Gap={gap:.4f}")
    (OUT / f"{prefix}metrics.json").write_text(json.dumps(metrics, indent=2))
    print("Saved", prefix, "models (ensemble+calibration+shap base)")
    return metrics



def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Prefer attachments, then local data/ folder
    search_roots = [
        Path("/home/workdir/attachments"),
        Path(__file__).parent / "data",
        Path(__file__).parent.parent / "data",
    ]
    name_map = {
        "fy": [
            "FY_CSE.xlsx",
            "FY_CSE_Synthetic_Students.xlsx",
            "First_Year_Marks_Attendance.xlsx",
            "FY_TRAIN_60pct_stratified.xlsx",
        ],
        "sy": [
            "SY_CSE_Combined_Data_Structure (1).csv",
            "SY_CSE_Combined_Data_Structure.csv",
            "SY_CSE.xlsx",
            "SY_CSE_Synthetic_Students_3600.xlsx",
            "SY_TRAIN_60pct_stratified.xlsx",
        ],
        "ty": [
            "TY-AB_Combined_Academic_Attendance (1).xlsx",
            "TY-AB_Combined_Academic_Attendance.xlsx",
            "TY_CSE.xlsx",
            "TY_CSE_Synthetic_Students_3400.xlsx",
            "TY_TRAIN_60pct_stratified.xlsx",
        ],
        "final": [
            "Final_Year_Marks_Attendance_Data.csv",
            "Final_Year_CSE.xlsx",
            "Final_Year_CSE_SEM_VIII_Synthetic_3200.xlsx",
            "Final_TRAIN_60pct_stratified.xlsx",
        ],
    }

    def resolve_path(year: str) -> Path | None:
        for root in search_roots:
            if not root.exists():
                continue
            for name in name_map[year]:
                p = root / name
                if p.exists():
                    return p
            # Fuzzy fallback: any file whose name starts with year key
            for p in sorted(root.iterdir()):
                low = p.name.lower()
                if year == "fy" and (low.startswith("fy") or "first" in low) and p.suffix.lower() in (".csv", ".xlsx", ".xls"):
                    return p
                if year == "sy" and low.startswith("sy") and p.suffix.lower() in (".csv", ".xlsx", ".xls"):
                    return p
                if year == "ty" and low.startswith("ty") and p.suffix.lower() in (".csv", ".xlsx", ".xls"):
                    return p
                if year == "final" and ("final" in low) and p.suffix.lower() in (".csv", ".xlsx", ".xls"):
                    return p
        return None

    configs = [(y, resolve_path(y)) for y in ("fy", "sy", "ty", "final")]
    all_metrics = {}
    for year, path in configs:
        all_metrics[year] = train_one(year, str(path) if path else None)

    if "ty" in all_metrics:
        import shutil
        for suffix in [
            "rf_status_classifier.joblib",
            "rf_avg_regressor.joblib",
            "label_encoder.joblib",
            "feature_medians.joblib",
        ]:
            src = OUT / f"ty_{suffix}"
            dst = OUT / suffix
            if src.exists():
                shutil.copy(src, dst)
        (OUT / "metrics.json").write_text(json.dumps(all_metrics.get("ty", {}), indent=2))

    summary = {
        "pipelines": list(all_metrics.keys()),
        "mode": "early_warning",
        "description": (
            "Predicted Status = forecast of end-of-term outcome using only "
            "UT-1 + attendance-to-date signals. Labels from full-term data."
        ),
        "models": all_metrics,
        "feature_cols": list(EARLY_FEATURE_COLS),
        "early_feature_cols": list(EARLY_FEATURE_COLS),
        "default_year": "ty",
    }
    (OUT / "multi_year_metrics.json").write_text(json.dumps(summary, indent=2))
    # MLOps production registry — promote only via explicit metrics comparison
    production = {
        "active_version": time.strftime("%Y%m%d_%H%M%S") if "time" in dir() else "v1",
        "promoted_at": None,
        "years": {
            y: {
                "accuracy_holdout": summary.get(y, {}).get("acc"),
                "model_files": {
                    "classifier": f"{y}_rf_status_classifier.joblib",
                    "shap_base": f"{y}_rf_shap_base.joblib",
                    "metrics": f"{y}_metrics.json",
                },
                "status": "candidate",
            }
            for y in ("fy", "sy", "ty", "final")
        },
        "promote_rules": {
            "min_holdout_accuracy": 0.70,
            "max_overfit_gap": 0.15,
            "require_conformal": True,
        },
        "note": "Candidates become production when /mlops/promote accepts them after rule checks.",
    }
    import datetime as _dt
    production["active_version"] = _dt.datetime.utcnow().strftime("v%Y%m%d_%H%M%S")
    production["promoted_at"] = _dt.datetime.utcnow().isoformat() + "Z"
    for y in production["years"]:
        acc = summary.get(y, {}).get("acc")
        if acc is not None and acc >= 0.70:
            production["years"][y]["status"] = "production"
    (OUT / "production.json").write_text(json.dumps(production, indent=2))
    print("Wrote production.json registry")
    print("\n===== ALL DONE (early-warning) =====")
    print(
        json.dumps(
            {
                k: {
                    "n": v["n_samples"],
                    "acc": round(v["accuracy_holdout"], 4),
                    "cv": round(v["cv_accuracy_mean"], 4),
                    "r2": round(v["regressor_r2"], 4),
                }
                for k, v in all_metrics.items()
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
