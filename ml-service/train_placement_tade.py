"""
Train Trajectory-Aware Domain Engine (TADE):
  - LightGBM multi-class → Target Domain
  - LightGBM regressor → readiness proxy 0–100
  - Split conformal thresholds per class (90% coverage target)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, classification_report

from placement_tade_features import (
    FEATURE_COLS,
    DOMAINS,
    dataframe_from_excel,
    readiness_proxy_from_features,
)

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "Placement_Domain_Training_Data_60K.xlsx"
OUT = ROOT / "models" / "placement"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    if not DATA.exists():
        print(f"Missing data: {DATA}")
        sys.exit(1)

    try:
        import lightgbm as lgb
    except ImportError:
        print("Installing lightgbm...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "lightgbm"])
        import lightgbm as lgb

    print("Loading", DATA)
    X, y = dataframe_from_excel(str(DATA))
    # filter unknown domains
    mask = y.isin(DOMAINS)
    X, y = X.loc[mask].reset_index(drop=True), y.loc[mask].reset_index(drop=True)
    print("rows", len(X), "features", X.shape[1])
    print(y.value_counts())

    readiness = X.apply(lambda r: readiness_proxy_from_features(r.to_dict()), axis=1)

    X_train, X_temp, y_train, y_temp, r_train, r_temp = train_test_split(
        X, y, readiness, test_size=0.30, random_state=42, stratify=y
    )
    X_cal, X_test, y_cal, y_test, r_cal, r_test = train_test_split(
        X_temp, y_temp, r_temp, test_size=0.50, random_state=42, stratify=y_temp
    )

    domain_to_idx = {d: i for i, d in enumerate(DOMAINS)}
    idx_to_domain = {i: d for d, i in domain_to_idx.items()}
    y_train_i = y_train.map(domain_to_idx)
    y_cal_i = y_cal.map(domain_to_idx)
    y_test_i = y_test.map(domain_to_idx)

    clf = lgb.LGBMClassifier(
        n_estimators=200,
        learning_rate=0.08,
        max_depth=8,
        num_leaves=48,
        subsample=0.85,
        colsample_bytree=0.85,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
        verbosity=-1,
    )
    clf.fit(X_train, y_train_i)

    reg = lgb.LGBMRegressor(
        n_estimators=150,
        learning_rate=0.08,
        max_depth=6,
        num_leaves=32,
        subsample=0.85,
        colsample_bytree=0.85,
        random_state=42,
        n_jobs=-1,
        verbosity=-1,
    )
    reg.fit(X_train, r_train)

    # metrics
    pred_test = clf.predict(X_test)
    acc = float(accuracy_score(y_test_i, pred_test))
    f1 = float(f1_score(y_test_i, pred_test, average="macro"))
    print("TEST accuracy", round(acc, 4), "macro F1", round(f1, 4))
    print(classification_report(y_test_i, pred_test, target_names=DOMAINS, digits=3))

    r_pred = reg.predict(X_test)
    rmse = float(np.sqrt(np.mean((r_pred - r_test.values) ** 2)))
    print("Readiness RMSE", round(rmse, 3))

    # Split conformal: nonconformity = 1 - p_true on calibration set
    proba_cal = clf.predict_proba(X_cal)
    classes = list(clf.classes_)
    nonconf = []
    for i, true_i in enumerate(y_cal_i.values):
        # position of true class in classes array
        if true_i not in classes:
            nonconf.append(1.0)
            continue
        col = list(classes).index(true_i)
        nonconf.append(1.0 - float(proba_cal[i, col]))
    nonconf = np.array(nonconf)
    # quantile for 90% coverage (split conformal)
    alpha = 0.10
    n = len(nonconf)
    q_level = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
    qhat = float(np.quantile(nonconf, q_level, method="higher"))
    print("Conformal qhat (alpha=0.1)", round(qhat, 4))

    # empirical coverage on test
    proba_test = clf.predict_proba(X_test)
    cover = 0
    set_sizes = []
    for i, true_i in enumerate(y_test_i.values):
        s = []
        for j, cidx in enumerate(classes):
            if (1.0 - float(proba_test[i, j])) <= qhat:
                s.append(int(cidx))
        set_sizes.append(len(s))
        if true_i in s:
            cover += 1
    coverage = cover / max(len(y_test_i), 1)
    print("Test conformal coverage", round(coverage, 4), "avg set size", round(np.mean(set_sizes), 3))

    medians = {c: float(X_train[c].median()) if X_train[c].notna().any() else 0.0 for c in FEATURE_COLS}

    bundle = {
        "clf": clf,
        "reg": reg,
        "feature_cols": FEATURE_COLS,
        "domains": DOMAINS,
        "domain_to_idx": domain_to_idx,
        "idx_to_domain": idx_to_domain,
        "classes": list(classes),
        "conformal_qhat": qhat,
        "conformal_alpha": alpha,
        "medians": medians,
        "metrics": {
            "accuracy_test": acc,
            "macro_f1_test": f1,
            "readiness_rmse": rmse,
            "conformal_coverage_test": coverage,
            "conformal_avg_set_size": float(np.mean(set_sizes)),
            "n_train": len(X_train),
            "n_cal": len(X_cal),
            "n_test": len(X_test),
        },
    }
    joblib.dump(bundle, OUT / "tade_bundle.joblib")
    (OUT / "tade_metrics.json").write_text(json.dumps(bundle["metrics"], indent=2))
    (OUT / "tade_features.json").write_text(json.dumps({"feature_cols": FEATURE_COLS, "domains": DOMAINS}, indent=2))
    print("Saved", OUT / "tade_bundle.joblib")


if __name__ == "__main__":
    main()
