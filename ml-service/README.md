# BVU Portal ML — Multi-Year Pipelines (SY / TY / Final)

## Models

| Pipeline | Training file | Students | Holdout acc | CV acc |
|----------|---------------|----------|-------------|--------|
| **sy** | SY_CSE_Synthetic_Students_3600.xlsx | 3600 | ~99.9% | ~99.7% |
| **ty** | TY_CSE_Synthetic_Students_3400.xlsx | 3400 | ~99.6% | ~99.5% |
| **final** | Final_Year_CSE_SEM_VIII_Synthetic_3200.xlsx | 3200 | ~100% | ~100% |

Each predicts **At Risk | Average | Good**.

> Note: Labels are derived from attendance + marks rules on the same features, so accuracy is very high. Still useful for consistent portal status + year-specific patterns.

## Run

```bash
pip install -r requirements.txt
uvicorn serve:app --host 0.0.0.0 --port 8001
```

## API

```http
POST /predict
{
  "prn": "...",
  "year": "sy" | "ty" | "final",
  "section": "SY-A",
  "attendance": 78.5,
  "average_percentage": 80,
  "marks": { "Subject": { "UT-1": 12, "UT-2": 15 } }
}
```

Year is inferred from `section` if `year` is omitted (`SY-*` → sy, `TY-*` → ty).

## Retrain

```bash
python train_multi_year.py
# expects Excels under /home/workdir/attachments/ or edit paths in script
```


## Feedback sentiment (hybrid)

- `POST /sentiment` on ML service (`ml-service/serve.py`) — transformer (RoBERTa) when `transformers`+`torch` installed.
- Backend `analyzeFeedback` tries ML first; falls back to `backend/src/feedback-nlp.js` domain NLP.
- `source`: `transformer` | `hybrid` | `feedback-nlp-local`.
- Install optional: `pip install transformers torch` inside `ml-service` (first run downloads model once).


## TADE (Trajectory-Aware Domain Engine)
Train: python train_placement_tade.py
Endpoints: GET /placement/tade/health, POST /placement/tade/predict, POST /placement/tade/gap-plan
Backend: /api/placement/tade/*
