# ML Integration (Multi-Year, Early-Warning)

## Connected pieces
1. **Portal** (frontend + backend) — Current Status | Predicted Status | Explainable drivers
2. **ML service** (`ml-service/`) — Random Forest **early-warning** models for **sy / ty / final** + SHAP

## What "Predicted Status" means
**Forecast of end-of-term outcome using only early-term signals** available around UT-1 time:
- attendance (to-date)
- mean UT-1 score
- UT-1 fail count / fail rate
- number of subjects / UT-1 assessments present
- absent / defaulter markers

The model does **not** use UT-2, RE-UT, or full-term averages. Those fields are used only when computing the training **label** (true end-of-term status), never as model inputs.

## Run all three
```bash
cd starter
npm install
pip install -r ml-service/requirements.txt
npm run dev
```
- Frontend: http://localhost:5173  
- Backend:  http://localhost:4000  
- ML:      http://localhost:8001  

## Predicted Status
- Calls `POST /api/ml/predict/batch` → ML service  
- Year from section: `SY-*` → sy, `TY-*` → ty, Final → final  
- If ML offline → rule-based fallback (Admin footer shows source)

## Explainable AI (SHAP)
- `POST /api/ml/explain` → SHAP values over the **early** feature set  
- Frontend: `explainWithModel(student)` tags `source: "model"` or falls back to `source: "rules"`

## FEATURE_COLS / EARLY_FEATURE_COLS (must match train ↔ serve)
```
attendance
mean_ut1
n_ut1_present
n_subjects
ut1_fail_count
ut1_fail_rate
n_absent_markers
```

## Models
- `models/sy_rf_status_classifier.joblib`
- `models/ty_rf_status_classifier.joblib`
- `models/final_rf_status_classifier.joblib`

## Training notes
- Labels: `label_status()` on full-term fields (attendance, avg_pct, combined fail_rate)
- Inputs: `EARLY_FEATURE_COLS` only
- Split: stratified random within a single cohort/file — **not** a cross-term generalization test (noted in metrics)
- Retrain: `python train_multi_year.py` (looks for Excel under attachments/ or data/; synthesizes a noisy early-warning cohort if files are missing)


## Feedback sentiment (hybrid)

- `POST /sentiment` on ML service (`ml-service/serve.py`) — transformer (RoBERTa) when `transformers`+`torch` installed.
- Backend `analyzeFeedback` tries ML first; falls back to `backend/src/feedback-nlp.js` domain NLP.
- `source`: `transformer` | `hybrid` | `feedback-nlp-local`.
- Install optional: `pip install transformers torch` inside `ml-service` (first run downloads model once).
