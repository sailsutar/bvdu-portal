"""
FastAPI ML service — multi-year Random Forest pipelines (early-warning mode).

Years: sy | ty | final
POST /predict  body includes optional "year" (default ty)
POST /explain  SHAP-based feature contributions for the predicted class

Predicted Status = forecast of END-OF-TERM outcome from available Unit Tests + attendance.

Adaptive Unit Test logic (matches portal rules):
  - If UT-2 is blank / not conducted → use UT-1 only
  - If UT-2 marks exist → use UT-1 and UT-2 together
RE-UT and final averages are not model inputs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODELS = Path(__file__).parent / "models"

# Must match EARLY_FEATURE_COLS in train_multi_year.py (order matters for SHAP).
# mean_ut1 / ut1_* hold values over AVAILABLE unit tests (UT-1 only, or UT-1+UT-2).
FEATURE_COLS = [
    "attendance",
    "mean_ut1",
    "n_ut1_present",
    "n_subjects",
    "ut1_fail_count",
    "ut1_fail_rate",
    "n_absent_markers",
]
PASS_UT = 8
VALID_YEARS = ("fy", "sy", "ty", "final")

app = FastAPI(title="BVU Portal ML Service (Early-Warning)", version="3.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# year -> {clf, reg, le, medians, metrics, explainer}
PIPELINES: dict[str, dict] = {}
SUMMARY: dict = {}


def _load_year(year: str) -> dict:
    prefix = f"{year}_"

    def load(name, alt=None):
        p = MODELS / f"{prefix}{name}"
        if not p.exists() and alt:
            p = MODELS / alt
        if not p.exists() and year == "ty":
            p = MODELS / name  # legacy
        if not p.exists():
            return None
        return joblib.load(p)

    metrics_path = MODELS / f"{prefix}metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    clf = load("rf_status_classifier.joblib")
    # SHAP base only; TreeExplainer is built lazily on first /explain
    shap_model = load("rf_shap_base.joblib") or clf
    return {
        "clf": clf,
        "shap_model": shap_model,
        "reg": load("rf_avg_regressor.joblib"),
        "le": load("label_encoder.joblib"),
        "medians": load("feature_medians.joblib") or {},
        "metrics": metrics,
        "explainer": None,
    }


@app.on_event("startup")
def startup():
    global SUMMARY
    for y in VALID_YEARS:
        try:
            PIPELINES[y] = _load_year(y)
            print(f"[ml] loaded pipeline (SHAP lazy): {y}")
        except Exception as e:
            print(f"[ml] failed to load {y}: {e}")
    summary_path = MODELS / "multi_year_metrics.json"
    if summary_path.exists():
        SUMMARY = json.loads(summary_path.read_text())



def get_explainer(year: str):
    """Lazy SHAP TreeExplainer (expensive); only used by /explain."""
    pipe = PIPELINES.get(year)
    if not pipe:
        return None
    if pipe.get("explainer") is not None:
        return pipe["explainer"]
    model = pipe.get("shap_model") or pipe.get("clf")
    if model is None:
        return None
    try:
        pipe["explainer"] = shap.TreeExplainer(model)
        print(f"[ml] SHAP explainer ready for {year}")
    except Exception as e:
        print(f"[ml] SHAP explainer failed for {year}: {e}")
        return None
    return pipe["explainer"]


def resolve_year(year: Optional[str], section: Optional[str] = None) -> str:
    """Map portal year labels to pipeline keys: sy | ty | final.

    LY / Last Year / final → final pipeline
    FY / First Year → sy pipeline (no dedicated FY weights yet; closest early-year model)
    """
    y = (year or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "")
    if y in VALID_YEARS:
        return y
    # Last year / final year
    if y in (
        "final", "finalyear", "lastyear", "ly", "be", "sem8", "semviii", "viii", "l"
    ):
        return "final"
    # First year → dedicated FY pipeline
    if y in ("fy", "fe", "firstyear", "first", "sem1", "sem2", "f"):
        return "fy"
    if y in ("sy", "secondyear", "sem3", "sem4"):
        return "sy"
    if y in ("ty", "thirdyear", "sem5", "sem6"):
        return "ty"

    s = (section or "").strip().upper()
    if "LAST" in s or "FINAL" in s or s.startswith("LY") or "SEM VIII" in s or "SEM-VIII" in s or "SEM 8" in s:
        return "final"
    if s.startswith("FY") or s.startswith("FE") or "FIRST" in s:
        return "fy"
    if s.startswith("SY") or "SY-" in s or "SECOND" in s:
        return "sy"
    if s.startswith("TY") or "TY-" in s or "THIRD" in s:
        return "ty"
    return "ty"


class AssessmentMap(BaseModel):
    marks: dict[str, dict[str, Optional[float]]] = Field(default_factory=dict)
    attendance: Optional[float] = None
    average_percentage: Optional[float] = None  # ignored for prediction (full-term)
    prn: Optional[str] = None
    name: Optional[str] = None
    year: Optional[str] = None
    section: Optional[str] = None
    n_absent_markers: Optional[float] = None


def marks_to_features(body: AssessmentMap) -> dict[str, float]:
    """
    Adaptive early-warning features for every term stage:
      - pre-UT (no marks yet)  → attendance + absences; UT stats empty
      - after UT-1 (no UT-2)   → attendance + UT-1
      - after UT-2             → attendance + UT-1 + UT-2 pool
    Column names stay mean_ut1 / ut1_* for pipeline compatibility; values are
    mean over *available* unit tests only (UT-1 / UT-2 / UT-3). Blank UTs ignored.
    """
    ut1s: list[float] = []
    ut2s: list[float] = []
    ut3s: list[float] = []
    n_subjects = 0
    for ass in (body.marks or {}).values():
        if not isinstance(ass, dict):
            continue
        n_subjects += 1
        for k, v in ass.items():
            if v is None:
                continue
            ku = str(k).upper().replace(" ", "_").replace("-", "_")
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if not np.isfinite(fv):
                continue
            if ku in ("UT_1", "UT1") or str(k) == "UT-1":
                ut1s.append(fv)
            elif ku in ("UT_2", "UT2") or str(k) == "UT-2":
                ut2s.append(fv)
            elif ku in ("UT_3", "UT3") or str(k) == "UT-3":
                ut3s.append(fv)

    pool = ut1s + ut2s + ut3s
    parts = []
    if ut1s:
        parts.append("UT-1")
    if ut2s:
        parts.append("UT-2")
    if ut3s:
        parts.append("UT-3")
    basis = "+".join(parts) if parts else "pre-UT"

    fail_count = sum(1 for x in pool if x < PASS_UT)
    n_pool = max(len(pool), 1)
    mean_ut = float(np.mean(pool)) if pool else None
    if mean_ut is None and body.average_percentage is not None:
        try:
            ap = float(body.average_percentage)
            if 0 <= ap <= 100:
                mean_ut = ap / 5.0
                if not pool:
                    basis = "avg_pct_proxy"
        except (TypeError, ValueError):
            pass

    feat = {
        "attendance": body.attendance,
        "mean_ut1": mean_ut,
        "n_ut1_present": float(len(pool)) if pool else (5.0 if mean_ut is not None and basis == "avg_pct_proxy" else float(len(pool))),
        "n_subjects": float(n_subjects if n_subjects else len(body.marks or {}) or (5 if mean_ut is not None else 0)),
        "ut1_fail_count": float(fail_count),
        "ut1_fail_rate": float(fail_count / n_pool) if pool else 0.0,
        "n_absent_markers": float(body.n_absent_markers or 0),
        "ut_basis": basis,
        "n_ut1_raw": float(len(ut1s)),
        "n_ut2_raw": float(len(ut2s)),
        "n_ut3_raw": float(len(ut3s)),
    }
    return feat


def vectorize(feat: dict, medians: dict) -> pd.DataFrame:
    row = {}
    for col in FEATURE_COLS:
        v = feat.get(col)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            v = medians.get(col, 0.0)
        row[col] = float(v)
    return pd.DataFrame([row], columns=FEATURE_COLS)



def _fnum(v, default=None):
    try:
        if v is None:
            return default
        x = float(v)
        if np.isnan(x):
            return default
        return x
    except (TypeError, ValueError):
        return default


def profile_strength(feat: dict) -> float:
    """Scalar academic strength from early features only (−10 … +10)."""
    att = _fnum(feat.get("attendance"), 50.0)
    mut = _fnum(feat.get("mean_ut1"), None)
    fails = _fnum(feat.get("ut1_fail_count"), 0.0) or 0.0
    fr = _fnum(feat.get("ut1_fail_rate"), 0.0) or 0.0
    n_ut = _fnum(feat.get("n_ut1_present"), 0.0) or 0.0
    n_abs = _fnum(feat.get("n_absent_markers"), 0.0) or 0.0
    score = 0.0

    if att >= 90:
        score += 3.0
    elif att >= 80:
        score += 2.0
    elif att >= 75:
        score += 1.0
    elif att < 50:
        score -= 4.0
    elif att < 65:
        score -= 3.0
    elif att < 75:
        score -= 1.5

    if mut is not None:
        if mut >= 15:
            score += 3.0
        elif mut >= 12:
            score += 2.0
        elif mut >= 10:
            score += 1.0
        elif mut < 5:
            score -= 4.0
        elif mut < 8:
            score -= 3.0
        elif mut < 10:
            score -= 1.0
    else:
        score -= 0.5

    if fails <= 0:
        score += 1.0
    else:
        score -= min(fails, 4.0)

    if fr >= 0.4:
        score -= 2.5
    elif fr >= 0.25:
        score -= 1.5
    elif fr >= 0.15:
        score -= 0.5

    if n_abs > 0:
        score -= min(n_abs, 3.0)
    if n_ut >= 5:
        score += 1.0
    elif n_ut >= 3:
        score += 0.5
    elif n_ut < 1 and mut is None:
        score -= 0.5

    return float(score)


def refine_predicted_status(
    feat: dict,
    model_status: str,
    proba_map: dict[str, float],
) -> tuple:
    """
    Post-process RF argmax so clear profiles are not stuck on Average, and
    weak profiles are not over-called as Good. Uses early features only.
    Returns (status, reason, confidence).
    """
    status = str(model_status or "Average")
    p_good = float(proba_map.get("Good", 0.0))
    p_avg = float(proba_map.get("Average", 0.0))
    p_risk = float(proba_map.get("At Risk", 0.0))
    att = _fnum(feat.get("attendance"), 50.0)
    mut = _fnum(feat.get("mean_ut1"), None)  # mean over available UTs
    fails = _fnum(feat.get("ut1_fail_count"), 0.0) or 0.0
    fr = _fnum(feat.get("ut1_fail_rate"), 0.0) or 0.0
    n_ut = _fnum(feat.get("n_ut1_present"), 0.0) or 0.0
    strength = profile_strength(feat)

    # --- Hard risk floor ---
    hard_risk = (
        (att is not None and att < 55)
        or (mut is not None and mut < 6)
        or (fr >= 0.45 and fails >= 2)
        or (mut is not None and mut < 8 and att is not None and att < 65)
    )
    if hard_risk and p_good < 0.55:
        return (
            "At Risk",
            f"guardrail_hard_risk (att={att}, mut={mut}, fails={fails}, fr={fr:.2f})",
            float(max(p_risk, 0.58)),
        )

    # --- Clear Good ---
    clear_good = (
        fails <= 0
        and fr <= 0.12
        and (att is None or att >= 78)
        and mut is not None
        and mut >= 12.5
        and p_risk < 0.28
        and (p_good >= 0.32 or strength >= 4.0)
    )
    if clear_good:
        return (
            "Good",
            f"guardrail_clear_good (mut={mut}, att={att}, P_good={p_good:.3f})",
            float(max(p_good, 0.58)),
        )

    # Strong Good even if model said Average
    if (
        status == "Average"
        and fails <= 0
        and (att is None or att >= 82)
        and mut is not None
        and mut >= 14
        and p_risk < 0.22
    ):
        return (
            "Good",
            f"guardrail_promote_good_strong (mut={mut}, att={att})",
            float(max(p_good, 0.55)),
        )

    if status == "Average" and strength >= 4.0 and p_risk < 0.20 and p_good >= max(p_avg - 0.08, 0.30):
        return (
            "Good",
            f"guardrail_promote_good (strength={strength:.1f}, P_good={p_good:.3f})",
            float(max(p_good, 0.52)),
        )

    # --- Demote optimistic Good ---
    if status == "Good":
        if (mut is not None and mut < 9) or (att is not None and att < 70) or fails >= 2:
            if p_risk >= 0.30:
                return (
                    "At Risk",
                    f"guardrail_demote_good_to_risk (mut={mut}, att={att}, fails={fails})",
                    float(max(p_risk, 0.52)),
                )
            return (
                "Average",
                f"guardrail_demote_good_to_avg (mut={mut}, att={att})",
                float(max(p_avg, 0.48)),
            )
        if strength <= 1.2 and p_good < 0.42:
            return (
                "Average",
                f"guardrail_demote_average (strength={strength:.1f})",
                float(max(p_avg, 0.45)),
            )

    # --- Escalate Average → At Risk ---
    if status == "Average":
        if strength <= -2.0 and (p_risk >= 0.28 or (mut is not None and mut < 8) or (att is not None and att < 68)):
            return (
                "At Risk",
                f"guardrail_escalate_risk (strength={strength:.1f}, P_risk={p_risk:.3f})",
                float(max(p_risk, 0.52)),
            )
        # Sparse data: prefer Average over confident Good/Risk
        if n_ut < 1 and mut is None and (att is None or 60 <= att <= 85):
            return (
                "Average",
                "guardrail_sparse_data_hold_average",
                float(max(p_avg, 0.40)),
            )

    # --- Soft confidence calibration ---
    conf = float(proba_map.get(status, 0.0))
    # Margin between top-2 classes boosts confidence
    probs = sorted([p_good, p_avg, p_risk], reverse=True)
    margin = (probs[0] - probs[1]) if len(probs) > 1 else 0.0
    conf = min(0.95, max(conf, 0.34) + 0.15 * margin)
    if status == "Good" and mut is not None and mut >= 15 and (att is None or att >= 85):
        conf = max(conf, 0.62)
    if status == "At Risk" and ((mut is not None and mut < 7) or (att is not None and att < 60)):
        conf = max(conf, 0.60)

    return status, "model_argmax", float(conf)



def predict_from_feat(feat: dict, year: str) -> dict[str, Any]:
    if year not in PIPELINES:
        raise HTTPException(503, f"Pipeline '{year}' not loaded")
    pipe = PIPELINES[year]
    X = vectorize(feat, pipe["medians"])
    clf, reg, le = pipe["clf"], pipe["reg"], pipe["le"]
    if clf is None or le is None:
        raise HTTPException(503, f"Classifier not loaded for '{year}'")
    pred_idx = int(clf.predict(X)[0])
    model_status = str(le.inverse_transform([pred_idx])[0])
    proba = clf.predict_proba(X)[0]
    proba_map = {str(le.classes_[i]): float(proba[i]) for i in range(len(le.classes_))}
    status, refine_reason, confidence = refine_predicted_status(feat, model_status, proba_map)
    confidence = float(confidence)
    try:
        classes_list = [str(c) for c in le.classes_]
        if status in classes_list:
            pred_idx = classes_list.index(status)
    except Exception:
        pass
    model_argmax_status = model_status
    pred_avg = float(reg.predict(X)[0]) if reg is not None else None
    if pred_avg is not None:
        pred_avg = max(0.0, min(100.0, round(pred_avg, 2)))
    # Simple drift flags vs training feature_stats
    drift_flags = []
    stats = (pipe.get("metrics") or {}).get("feature_stats") or {}
    for col in FEATURE_COLS:
        st = stats.get(col)
        if not st:
            continue
        val = float(X.iloc[0][col])
        mu, sd = st.get("mean"), st.get("std") or 1.0
        if mu is not None and sd and abs(val - mu) > 3.0 * sd:
            drift_flags.append(col)
    metrics = pipe.get("metrics") or {}
    classes = list(le.classes_)

    # Cost-sensitive policy: escalate risk when probability is high; do not
    # override a guardrail-clear Good unless risk probability is clearly high.
    cost = metrics.get("cost_policy") or {}
    tau = float(cost.get("at_risk_probability_threshold") or 0.35)
    p_at_risk = float(proba_map.get("At Risk", 0.0))
    if p_at_risk >= tau and status != "Good":
        policy_status = "At Risk"
        policy_reason = f"P(At Risk)={p_at_risk:.3f} ≥ τ={tau:.3f}"
    elif p_at_risk >= (tau + 0.12):
        policy_status = "At Risk"
        policy_reason = f"P(At Risk)={p_at_risk:.3f} ≥ hard τ={tau + 0.12:.3f}"
    else:
        policy_status = status
        policy_reason = f"refined={status} ({refine_reason}); P(At Risk)={p_at_risk:.3f}"

    # Split conformal prediction set
    conf = metrics.get("conformal") or {}
    q_hat = conf.get("q_hat")
    prediction_set = [status]
    if q_hat is not None:
        prediction_set = [
            str(classes[i])
            for i in range(len(classes))
            if (1.0 - float(proba[i])) <= float(q_hat) + 1e-12
        ]
        if not prediction_set:
            prediction_set = [status]

    # Uplift prior (intervenable region)
    att = feat.get("attendance")
    mut = feat.get("mean_ut1")
    try:
        a = float(att) if att is not None else 75.0
        u = float(mut) if mut is not None else 10.0
        ua = max(0.0, 1.0 - abs(a - 65.0) / 25.0)
        uu = max(0.0, 1.0 - abs(u - 8.5) / 6.0)
        uplift = round(0.15 + 0.7 * ua * uu, 4)
    except Exception:
        uplift = 0.25

    # Notify recommendation for HOD agents
    notify_recommended = policy_status == "At Risk" and confidence >= 0.55

    return {
        "status": status,
        "model_argmax_status": model_argmax_status,
        "refine_reason": refine_reason,
        "profile_strength": round(profile_strength(feat), 2),
        "policy_status": policy_status,
        "policy_reason": policy_reason,
        "prediction_set": prediction_set,
        "conformal": {
            "alpha": conf.get("alpha", 0.1),
            "q_hat": q_hat,
            "target_coverage": conf.get("target_coverage", 0.9),
            "empirical_coverage_holdout": conf.get("empirical_coverage"),
        },
        "probabilities": proba_map,
        "confidence": round(confidence, 4),
        "calibrated": True,
        "uplift_score": uplift,
        "notify_recommended": notify_recommended,
        "cost_threshold_at_risk": tau,
        "model_stack": metrics.get("stack") or ["RandomForest"],
        "predicted_average_pct": pred_avg,
        "year": year,
        "features_used": {k: feat.get(k) for k in FEATURE_COLS},
        "ut_basis": feat.get("ut_basis"),
        "n_ut1_raw": feat.get("n_ut1_raw"),
        "n_ut2_raw": feat.get("n_ut2_raw"),
        "drift_flags": drift_flags,
        # Internal fields for /explain (stripped on public predict responses)
        "_pred_idx": pred_idx,
        "_X": X,
    }



def _shap_values_for_class(explainer, X: pd.DataFrame, class_idx: int) -> tuple[np.ndarray, float]:
    raw = explainer.shap_values(X)
    base = explainer.expected_value

    if isinstance(raw, list):
        vals = np.asarray(raw[class_idx][0], dtype=float)
        b = float(base[class_idx]) if hasattr(base, "__len__") else float(base)
        return vals, b

    arr = np.asarray(raw)
    if arr.ndim == 3:
        vals = arr[0, :, class_idx].astype(float)
        b = float(base[class_idx]) if hasattr(base, "__len__") else float(base)
        return vals, b
    if arr.ndim == 2:
        vals = arr[0].astype(float)
        b = float(base[0]) if hasattr(base, "__len__") else float(base)
        return vals, b

    raise ValueError(f"Unexpected shap_values shape: {arr.shape}")


def _direction(
    status: str,
    shap_val: float,
    feature: str | None = None,
    value: float | None = None,
) -> str:
    """
    Teacher-facing risk vs protective label for every early-warning feature.

    Value semantics always win over SHAP sign on the predicted class.
    SHAP magnitude still ranks importance; this only fixes the direction badge.
    """
    feat = (feature or "").strip()
    try:
        v = float(value) if value is not None and str(value) != "nan" else None
    except (TypeError, ValueError):
        v = None

    # --- higher is safer ---
    if feat == "attendance":
        if v is None:
            return "protective" if shap_val < 0 and status == "At Risk" else "risk"
        if v >= 75:
            return "protective"
        if v >= 65:
            return "risk"  # below eligibility line but not critical band alone
        return "risk"

    if feat == "mean_ut1":
        if v is None:
            return "protective" if shap_val < 0 and status == "At Risk" else "risk"
        # scale 0–20
        if v >= 12:
            return "protective"
        if v >= 8:
            return "protective" if status in ("Good", "Average") else "risk"
        return "risk"

    if feat == "n_ut1_present":
        if v is None:
            return "risk"
        return "protective" if v >= 3 else "risk"

    if feat == "n_subjects":
        if v is None:
            return "risk"
        return "protective" if v >= 3 else "risk"

    # --- higher is worse ---
    if feat in ("ut1_fail_count", "fail_count"):
        if v is None:
            return "risk"
        return "risk" if v > 0 else "protective"

    if feat in ("ut1_fail_rate", "fail_rate"):
        if v is None:
            return "risk"
        return "risk" if v >= 0.15 else "protective"

    if feat == "n_absent_markers":
        if v is None:
            return "risk"
        return "risk" if v > 0 else "protective"

    # Unknown feature: At Risk class → positive SHAP = risk; else softer default
    if status == "At Risk":
        return "risk" if shap_val >= 0 else "protective"
    if status == "Good":
        return "protective" if shap_val >= 0 else "risk"
    return "protective" if shap_val >= 0 else "risk"



@app.get("/health")
def health():
    return {
        "ok": True,
        "pipelines_loaded": list(PIPELINES.keys()),
        "version": "3.1.0",
        "mode": "early_warning",
        "feature_cols": FEATURE_COLS,
        "shap_explainers": [y for y, p in PIPELINES.items() if p.get("explainer") is not None],
    }


@app.get("/metrics")
def get_metrics(year: Optional[str] = None):
    if year:
        y = resolve_year(year)
        if y not in PIPELINES:
            raise HTTPException(404, f"Unknown year {year}")
        return PIPELINES[y]["metrics"]
    return SUMMARY or {y: PIPELINES[y]["metrics"] for y in PIPELINES}



@app.get("/model-health")
def model_health():
    """Aggregate metrics, fairness slices, feature stats for admin Model Health UI."""
    years = {}
    for y, pipe in PIPELINES.items():
        m = pipe.get("metrics") or {}
        years[y] = {
            "loaded": pipe.get("clf") is not None,
            "shap": pipe.get("explainer") is not None,
            "accuracy_holdout": m.get("accuracy_holdout"),
            "cv_accuracy_mean": m.get("cv_accuracy_mean"),
            "brier_multiclass": m.get("brier_multiclass"),
            "log_loss": m.get("log_loss"),
            "conformal": m.get("conformal") or {},
            "cost_policy": m.get("cost_policy") or {},
            "uplift_prior": m.get("uplift_prior") or {},
            "fairness_slices": m.get("fairness_slices") or [],
            "feature_stats": m.get("feature_stats") or {},
            "stack": m.get("stack") or [],
            "mode": m.get("mode"),
            "adaptive_unit_tests": m.get("adaptive_unit_tests"),
        }
    production = {}
    prod_path = MODELS / "production.json"
    if prod_path.exists():
        try:
            production = json.loads(prod_path.read_text())
        except Exception:
            production = {}
    return {"years": years, "feature_cols": FEATURE_COLS, "production": production}


@app.post("/predict")
def predict(body: AssessmentMap):
    year = resolve_year(body.year, body.section)
    feat = marks_to_features(body)
    result = predict_from_feat(feat, year)
    result.pop("_pred_idx", None)
    result.pop("_X", None)
    result["prn"] = body.prn
    result["name"] = body.name
    return result


@app.post("/predict/batch")
def predict_batch(items: list[AssessmentMap]):
    """Vectorized batch predict — one model call per year group (not per student)."""
    if not items:
        return []
    # Group by resolved year to matrix-predict
    groups: dict[str, list[tuple[int, AssessmentMap, dict]]] = {}
    for i, item in enumerate(items):
        year = resolve_year(item.year, item.section)
        feat = marks_to_features(item)
        groups.setdefault(year, []).append((i, item, feat))

    out: list[dict | None] = [None] * len(items)
    for year, rows in groups.items():
        if year not in PIPELINES:
            for i, item, feat in rows:
                out[i] = {
                    "prn": item.prn,
                    "name": item.name,
                    "status": "Average",
                    "year": year,
                    "error": f"Pipeline '{year}' not loaded",
                    "source": "fallback",
                }
            continue
        pipe = PIPELINES[year]
        clf, reg, le = pipe["clf"], pipe["reg"], pipe["le"]
        if clf is None or le is None:
            for i, item, feat in rows:
                out[i] = {
                    "prn": item.prn,
                    "name": item.name,
                    "status": "Average",
                    "year": year,
                    "error": "Classifier not loaded",
                }
            continue

        frames = [vectorize(feat, pipe["medians"]) for _, _, feat in rows]
        X = pd.concat(frames, ignore_index=True)
        pred_idx = clf.predict(X)
        proba = clf.predict_proba(X)
        pred_avg = reg.predict(X) if reg is not None else None
        metrics = pipe.get("metrics") or {}
        cost = metrics.get("cost_policy") or {}
        tau = float(cost.get("at_risk_probability_threshold") or 0.35)
        classes = list(le.classes_)

        for row_i, (i, item, feat) in enumerate(rows):
            idx = int(pred_idx[row_i])
            model_status = str(le.inverse_transform([idx])[0])
            proba_row = proba[row_i]
            proba_map = {str(classes[j]): float(proba_row[j]) for j in range(len(classes))}
            # Same guardrails as single /predict (list must match detail page)
            status, refine_reason, conf = refine_predicted_status(feat, model_status, proba_map)
            p_at_risk = float(proba_map.get("At Risk", 0.0))
            if p_at_risk >= tau and status != "Good":
                policy_status = "At Risk"
            elif p_at_risk >= (tau + 0.12):
                policy_status = "At Risk"
            else:
                policy_status = status
            avg = None
            if pred_avg is not None:
                avg = max(0.0, min(100.0, round(float(pred_avg[row_i]), 2)))
            out[i] = {
                "prn": item.prn,
                "name": item.name,
                "status": status,
                "model_argmax_status": model_status,
                "model_status": model_status,
                "refine_reason": refine_reason,
                "profile_strength": round(profile_strength(feat), 2),
                "policy_status": policy_status,
                "probabilities": proba_map,
                "confidence": round(float(conf), 4),
                "predicted_average_pct": avg,
                "year": year,
                "features_used": {k: feat.get(k) for k in FEATURE_COLS},
                "model_stack": metrics.get("stack") or ["RandomForest"],
            }
    return out


@app.post("/explain")
def explain(body: AssessmentMap):
    """SHAP feature contributions for the model's predicted status class (early features)."""
    year = resolve_year(body.year, body.section)
    if year not in PIPELINES:
        raise HTTPException(503, f"Pipeline '{year}' not loaded")
    pipe = PIPELINES[year]
    explainer = get_explainer(year)
    if explainer is None:
        raise HTTPException(503, f"SHAP explainer not available for '{year}'")

    feat = marks_to_features(body)
    pred = predict_from_feat(feat, year)
    status = pred["status"]
    # Prefer internal keys; recompute if missing (robust to older return shapes)
    if pred.get("_pred_idx") is not None and pred.get("_X") is not None:
        pred_idx = int(pred["_pred_idx"])
        X = pred["_X"]
    else:
        X = vectorize(feat, pipe["medians"])
        le = pipe["le"]
        pred_idx = int(pipe["clf"].predict(X)[0])
        try:
            # Align index with label encoder class order
            classes = list(le.classes_)
            if status in classes:
                pred_idx = classes.index(status)
        except Exception:
            pass

    shap_vals, base_value = _shap_values_for_class(explainer, X, pred_idx)
    raw_row = X.iloc[0]

    contributions = []
    for i, col in enumerate(FEATURE_COLS):
        sv = float(shap_vals[i])
        contributions.append(
            {
                "feature": col,
                "value": float(raw_row[col]),
                "shap_value": round(sv, 6),
                "direction": _direction(status, sv, col, float(raw_row[col])),
            }
        )

    contributions.sort(key=lambda c: abs(c["shap_value"]), reverse=True)

    return {
        "year": year,
        "status": status,
        "mode": "early_warning",
        "feature_contributions": contributions,
        "base_value": round(float(base_value), 6),
        "prn": body.prn,
        "name": body.name,
    }


@app.get("/mlops/registry")
def mlops_registry():
    path = MODELS / "production.json"
    if not path.exists():
        return {"error": "No production.json — retrain to create registry", "years": list(PIPELINES.keys())}
    return json.loads(path.read_text())


@app.post("/mlops/promote")
def mlops_promote(body: dict[str, Any] | None = None):
    """
    Promote candidate metrics to production if rules pass.
    Body optional: { "year": "ty", "force": false }
    """
    body = body or {}
    force = bool(body.get("force"))
    years = [body["year"]] if body.get("year") else list(PIPELINES.keys())
    path = MODELS / "production.json"
    reg = json.loads(path.read_text()) if path.exists() else {
        "active_version": "manual",
        "years": {},
        "promote_rules": {"min_holdout_accuracy": 0.70, "max_overfit_gap": 0.15, "require_conformal": True},
    }
    rules = reg.get("promote_rules") or {}
    results = []
    for y in years:
        m = (PIPELINES.get(y) or {}).get("metrics") or {}
        acc = m.get("accuracy_holdout")
        gap = m.get("overfit_gap")
        conf = m.get("conformal")
        ok = True
        reasons = []
        if not force:
            if acc is not None and acc < float(rules.get("min_holdout_accuracy", 0.70)):
                ok = False
                reasons.append(f"accuracy {acc} below min")
            if gap is not None and gap > float(rules.get("max_overfit_gap", 0.15)):
                ok = False
                reasons.append(f"overfit gap {gap} too high")
            if rules.get("require_conformal") and not conf:
                ok = False
                reasons.append("missing conformal block")
        entry = reg.setdefault("years", {}).setdefault(y, {})
        if ok:
            entry["status"] = "production"
            entry["accuracy_holdout"] = acc
            entry["promoted"] = True
            results.append({"year": y, "promoted": True, "reasons": reasons})
        else:
            entry["status"] = "rejected"
            entry["reject_reasons"] = reasons
            results.append({"year": y, "promoted": False, "reasons": reasons})
    import datetime as _dt
    reg["last_promote_attempt"] = _dt.datetime.utcnow().isoformat() + "Z"
    path.write_text(json.dumps(reg, indent=2))
    return {"ok": True, "results": results, "registry": reg}


@app.post("/mlops/rollback")
def mlops_rollback(body: dict[str, Any] | None = None):
    """Mark year models as rolled_back in registry (files stay; status changes)."""
    body = body or {}
    year = body.get("year")
    path = MODELS / "production.json"
    if not path.exists():
        raise HTTPException(404, "No production registry")
    reg = json.loads(path.read_text())
    years = [year] if year else list(reg.get("years", {}).keys())
    for y in years:
        if y in reg.get("years", {}):
            reg["years"][y]["status"] = "rolled_back"
            reg["years"][y]["promoted"] = False
    import datetime as _dt
    reg["last_rollback"] = _dt.datetime.utcnow().isoformat() + "Z"
    path.write_text(json.dumps(reg, indent=2))
    return {"ok": True, "registry": reg}


# ---------------------------------------------------------------------------
# Transformer feedback sentiment (optional — loads on first request)
# ---------------------------------------------------------------------------
_sentiment_pipe = None
_sentiment_error = None
_SENTIMENT_MODEL_ID = os.environ.get(
    "SENTIMENT_MODEL_ID", "cardiffnlp/twitter-roberta-base-sentiment-latest"
)


def _get_sentiment_pipeline():
    """Lazy-load HuggingFace sentiment pipeline (CPU)."""
    global _sentiment_pipe, _sentiment_error
    if _sentiment_pipe is not None:
        return _sentiment_pipe
    if _sentiment_error is not None:
        return None
    try:
        from transformers import pipeline
        _sentiment_pipe = pipeline(
            "sentiment-analysis",
            model=_SENTIMENT_MODEL_ID,
            tokenizer=_SENTIMENT_MODEL_ID,
            truncation=True,
            max_length=256,
        )
        print(f"[ml] sentiment transformer ready: {_SENTIMENT_MODEL_ID}")
        return _sentiment_pipe
    except Exception as e:
        _sentiment_error = str(e)
        print(f"[ml] sentiment transformer unavailable: {e}")
        return None


class SentimentIn(BaseModel):
    text: str
    texts: Optional[list[str]] = None


def _map_transformer_label(label: str, score: float) -> dict:
    """Map model labels → good | average | bad."""
    lab = (label or "").strip().lower()
    # cardiffnlp: negative / neutral / positive
    if lab in ("positive", "pos", "label_2"):
        sentiment = "good"
    elif lab in ("negative", "neg", "label_0"):
        sentiment = "bad"
    elif lab in ("neutral", "label_1"):
        sentiment = "average"
    # SST-2 style
    elif lab in ("label_1",) and "roberta" not in _SENTIMENT_MODEL_ID.lower():
        sentiment = "good"
    else:
        # star ratings 1-5
        if lab in ("1 star", "2 stars"):
            sentiment = "bad"
        elif lab in ("3 stars",):
            sentiment = "average"
        elif lab in ("4 stars", "5 stars"):
            sentiment = "good"
        else:
            sentiment = "average"

    # Low confidence → pull toward average
    conf = float(score or 0)
    if conf < 0.45 and sentiment != "average":
        sentiment = "average"
        conf = max(conf, 0.4)

    return {
        "sentiment": sentiment,
        "confidence": round(conf, 4),
        "raw_label": label,
        "raw_score": round(conf, 4),
        "source": "transformer",
        "model": _SENTIMENT_MODEL_ID,
    }


@app.get("/sentiment/health")
def sentiment_health():
    pipe = _get_sentiment_pipeline()
    return {
        "ready": pipe is not None,
        "model": _SENTIMENT_MODEL_ID if pipe else None,
        "error": _sentiment_error,
    }


@app.post("/sentiment")
def sentiment_analyze(body: SentimentIn):
    """
    Transformer sentiment for teaching feedback.
    Returns good | average | bad with confidence.
    """
    pipe = _get_sentiment_pipeline()
    if pipe is None:
        raise HTTPException(
            503,
            detail={
                "error": "Transformer sentiment not loaded",
                "hint": _sentiment_error or "pip install transformers torch",
            },
        )

    batch = body.texts if body.texts else [body.text or ""]
    batch = [str(t or "").strip()[:2000] for t in batch]
    if not batch or all(not t for t in batch):
        raise HTTPException(400, "text or texts required")

    outs = []
    for t in batch:
        if not t:
            outs.append({
                "sentiment": "average",
                "confidence": 0.3,
                "source": "transformer",
                "model": _SENTIMENT_MODEL_ID,
                "empty": True,
            })
            continue
        pred = pipe(t)[0]
        mapped = _map_transformer_label(pred.get("label", ""), float(pred.get("score", 0)))
        mapped["text_preview"] = t[:120]
        outs.append(mapped)

    if body.texts:
        return {"results": outs, "source": "transformer", "model": _SENTIMENT_MODEL_ID}
    return outs[0]



# ---------------------------------------------------------------------------
# TADE — Trajectory-Aware Domain Engine (placement)
# ---------------------------------------------------------------------------
_TADE = None


def _load_tade():
    global _TADE
    if _TADE is not None:
        return _TADE
    path = MODELS / "placement" / "tade_bundle.joblib"
    if not path.exists():
        return None
    try:
        import joblib
        _TADE = joblib.load(path)
        print("[ml] TADE placement model loaded")
        return _TADE
    except Exception as e:
        print("[ml] TADE load failed:", e)
        return None


class TadeIn(BaseModel):
    year: Optional[str] = None
    yearLevel: Optional[str] = None
    ssc_pct: Optional[float] = None
    hsc_dip_pct: Optional[float] = None
    tenthPercent: Optional[float] = None
    twelfthPercent: Optional[float] = None
    diplomaPercent: Optional[float] = None
    entrance_score: Optional[float] = None
    entrance_exam: Optional[str] = None
    stream: Optional[str] = None
    cgpa: Optional[float] = None
    cgpa_fy: Optional[float] = None
    cgpa_sy: Optional[float] = None
    cgpa_ty: Optional[float] = None
    cgpa_ly: Optional[float] = None
    skillC: Optional[float] = None
    skillCpp: Optional[float] = None
    skillJava: Optional[float] = None
    skillDsa: Optional[float] = None
    skillDbms: Optional[float] = None
    skillCn: Optional[float] = None
    skillPython: Optional[float] = None
    skillAi: Optional[float] = None
    skillMl: Optional[float] = None
    skillDl: Optional[float] = None
    n_internships: Optional[int] = None
    internships: Optional[list] = None  # [{role, type, months}]
    # raw training-column aliases allowed via extra
    model_config = {"extra": "allow"}


def _body_to_row(body: TadeIn) -> dict:
    d = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    # map API names → feature builder aliases
    row = dict(d)
    if body.year or body.yearLevel:
        row["Current Year"] = body.year or body.yearLevel
    if body.ssc_pct is not None or body.tenthPercent is not None:
        row["SSC %"] = body.ssc_pct if body.ssc_pct is not None else body.tenthPercent
    if body.hsc_dip_pct is not None:
        row["10+2 / Diploma %"] = body.hsc_dip_pct
    elif body.twelfthPercent is not None:
        row["10+2 / Diploma %"] = body.twelfthPercent
    elif body.diplomaPercent is not None:
        row["10+2 / Diploma %"] = body.diplomaPercent
    if body.entrance_score is not None:
        row["Entrance Score"] = body.entrance_score
    if body.entrance_exam:
        row["Entrance Exam"] = body.entrance_exam
    if body.stream:
        row["10+2 / Diploma"] = body.stream
    for src, dst in [
        ("cgpa_fy", "FY CGPA"), ("cgpa_sy", "SY CGPA"), ("cgpa_ty", "TY CGPA"),
        ("cgpa_ly", "LY CGPA"), ("cgpa", "LY CGPA"),
        ("skillC", "C"), ("skillCpp", "C++"), ("skillJava", "OOM (Java)"),
        ("skillDsa", "NLDS / Data Structures"), ("skillDbms", "DBMS"),
        ("skillCn", "Computer Networks"), ("skillPython", "Python"),
        ("skillAi", "AI"), ("skillMl", "ML"), ("skillDl", "DL"),
    ]:
        if d.get(src) is not None:
            row[dst] = d[src]
    if body.n_internships is not None:
        row["No. of Internships"] = body.n_internships
    if body.internships:
        for i, it in enumerate(body.internships[:3], start=1):
            if not isinstance(it, dict):
                continue
            row[f"Internship {i} - Role"] = it.get("role") or it.get("title") or ""
            row[f"Internship {i} - Type"] = it.get("type") or ""
            row[f"Internship {i} - Duration (Months)"] = it.get("months") or it.get("duration") or 0
    return row


def _vectorize_tade(feat: dict, medians: dict) -> "pd.DataFrame":
    from placement_tade_features import FEATURE_COLS
    row = {}
    for c in FEATURE_COLS:
        v = feat.get(c)
        if v is None or (isinstance(v, float) and (v != v)):  # nan
            v = medians.get(c, 0.0)
        try:
            row[c] = float(v)
        except (TypeError, ValueError):
            row[c] = float(medians.get(c, 0.0))
    return pd.DataFrame([row], columns=FEATURE_COLS)


def _tade_predict_core(body: TadeIn) -> dict:
    from placement_tade_features import row_to_features, readiness_proxy_from_features, DOMAINS

    bundle = _load_tade()
    row = _body_to_row(body)
    feat = row_to_features(row)
    if bundle is None:
        # rule fallback
        ready = readiness_proxy_from_features(feat)
        # crude domain scores from skills
        scores = {
            "AI Developer": (feat.get("skill_stem_ai") or 50) + 10 * (feat.get("intern_ai_ml_hits") or 0),
            "Data Scientist": (feat.get("skill_ml") or 50) * 0.5 + (feat.get("skill_python") or 50) * 0.5,
            "Data Analyst": (feat.get("skill_dbms") or 50) * 0.6 + (feat.get("skill_python") or 50) * 0.4,
            "Fullstack": (feat.get("skill_java") or 50) * 0.4 + (feat.get("skill_dsa") or 50) * 0.3 + (feat.get("skill_cpp") or 50) * 0.3,
            "Cloud Developer": (feat.get("skill_networks") or 50) + 10 * (feat.get("intern_cloud_hits") or 0),
            "QA Tester": (feat.get("skill_mean") or 50) * 0.8 + 15 * (feat.get("intern_qa_hits") or 0),
            "Cyber Security": (feat.get("skill_networks") or 50) * 0.7 + 15 * (feat.get("intern_cyber_hits") or 0),
        }
        total = sum(max(0, v) for v in scores.values()) or 1
        proba = {k: max(0, v) / total for k, v in scores.items()}
        ranked = sorted(proba.items(), key=lambda x: -x[1])
        return {
            "source": "rules",
            "top_domain": ranked[0][0],
            "probabilities": {k: round(v, 4) for k, v in ranked},
            "domain_set": [k for k, v in ranked if v >= ranked[0][1] * 0.55][:3],
            "readiness": round(ready, 1),
            "year_locked": True,
            "features_used": feat,
        }

    medians = bundle.get("medians") or {}
    X = _vectorize_tade(feat, medians)
    clf = bundle["clf"]
    reg = bundle["reg"]
    classes = list(bundle.get("classes") or clf.classes_)
    idx_to_domain = bundle.get("idx_to_domain") or {}
    # ensure str keys
    idx_to_domain = {int(k): v for k, v in idx_to_domain.items()}

    proba_vec = clf.predict_proba(X)[0]
    proba_map = {}
    for j, cidx in enumerate(classes):
        name = idx_to_domain.get(int(cidx), DOMAINS[int(cidx)] if int(cidx) < len(DOMAINS) else str(cidx))
        proba_map[name] = float(proba_vec[j])
    ranked = sorted(proba_map.items(), key=lambda x: -x[1])
    top = ranked[0][0]
    qhat = float(bundle.get("conformal_qhat") or 0.5)
    domain_set = [name for name, p in ranked if (1.0 - p) <= qhat]
    if not domain_set:
        domain_set = [top]
    ready = float(reg.predict(X)[0])
    ready = max(0, min(100, ready))

    # simple feature contributions: top abs z-ish vs median for display
    drivers = []
    for c in list(feat.keys())[:]:
        v = feat.get(c)
        m = medians.get(c, 0)
        if v is None or (isinstance(v, float) and v != v):
            continue
        try:
            delta = float(v) - float(m)
        except (TypeError, ValueError):
            continue
        if abs(delta) < 1e-6:
            continue
        drivers.append({"feature": c, "value": round(float(v), 3), "vs_median": round(delta, 3)})
    drivers.sort(key=lambda d: -abs(d["vs_median"]))

    return {
        "source": "tade",
        "top_domain": top,
        "probabilities": {k: round(v, 4) for k, v in ranked},
        "domain_set": domain_set,
        "conformal_alpha": bundle.get("conformal_alpha", 0.1),
        "readiness": round(ready, 1),
        "year_locked": True,
        "drivers": drivers[:8],
        "metrics": bundle.get("metrics"),
        "features_used": {k: (None if (isinstance(v, float) and v != v) else v) for k, v in feat.items()},
    }


def _counterfactual(body: TadeIn, target_domain: str | None = None) -> dict:
    """Greedy gap plan: try boosting key skills / internship to move domain or readiness."""
    base = _tade_predict_core(body)
    target = target_domain or (
        base["domain_set"][1] if len(base.get("domain_set") or []) > 1 else "Data Scientist"
    )
    if target == base.get("top_domain"):
        target = "Data Scientist" if target != "Data Scientist" else "Fullstack"

    candidates = []
    # try skill bumps
    skill_keys = [
        ("skillMl", "ML skill", 15),
        ("skillDl", "DL skill", 15),
        ("skillAi", "AI skill", 15),
        ("skillPython", "Python skill", 10),
        ("skillDsa", "DSA skill", 10),
        ("skillDbms", "DBMS skill", 10),
    ]
    raw = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    for attr, label, bump in skill_keys:
        trial = dict(raw)
        cur = trial.get(attr) or 50
        trial[attr] = min(100, float(cur) + bump)
        tbody = TadeIn(**{k: v for k, v in trial.items() if v is not None})
        pred = _tade_predict_core(tbody)
        gain = (pred["probabilities"].get(target, 0) - base["probabilities"].get(target, 0))
        ready_gain = pred["readiness"] - base["readiness"]
        if gain > 0.01 or ready_gain > 1:
            candidates.append({
                "action": f"Raise {label} by ~{bump} points (practice / course / project)",
                "target_domain_prob_delta": round(gain, 4),
                "readiness_delta": round(ready_gain, 2),
                "new_top": pred["top_domain"],
                "enters_set": target in (pred.get("domain_set") or []),
            })
    # internship
    trial = dict(raw)
    trial["n_internships"] = int(trial.get("n_internships") or 0) + 1
    inter = list(trial.get("internships") or [])
    inter.append({"role": "Data Science Intern", "type": "Technical", "months": 3})
    trial["internships"] = inter
    tbody = TadeIn(**{k: v for k, v in trial.items() if v is not None})
    pred = _tade_predict_core(tbody)
    gain = pred["probabilities"].get(target, 0) - base["probabilities"].get(target, 0)
    candidates.append({
        "action": "Add 1 technical internship (≈3 months) aligned to target domain",
        "target_domain_prob_delta": round(gain, 4),
        "readiness_delta": round(pred["readiness"] - base["readiness"], 2),
        "new_top": pred["top_domain"],
        "enters_set": target in (pred.get("domain_set") or []),
    })
    candidates.sort(key=lambda c: (-(c["target_domain_prob_delta"] + c["readiness_delta"] * 0.01)))
    return {
        "base": {k: base[k] for k in ("top_domain", "probabilities", "domain_set", "readiness", "source")},
        "target_domain": target,
        "gap_plan": candidates[:5],
        "engine": "tade_counterfactual_v1",
    }


@app.get("/placement/tade/health")
def tade_health():
    b = _load_tade()
    return {
        "ready": b is not None,
        "metrics": (b or {}).get("metrics"),
        "domains": (b or {}).get("domains"),
    }


@app.post("/placement/tade/predict")
def tade_predict(body: TadeIn):
    return _tade_predict_core(body)


@app.post("/placement/tade/gap-plan")
def tade_gap_plan(body: dict[str, Any] | None = None):
    body = body or {}
    target = body.pop("target_domain", None) if isinstance(body, dict) else None
    # remaining keys → TadeIn
    try:
        tin = TadeIn(**{k: v for k, v in body.items() if k != "target_domain"})
    except Exception as e:
        raise HTTPException(400, f"Invalid body: {e}")
    return _counterfactual(tin, target)
