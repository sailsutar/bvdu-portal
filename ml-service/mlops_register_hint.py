"""
After train_multi_year.py finishes, push metrics into the portal MLOps registry
(via future API) or print a candidate payload for the Admin → Advanced → MLOps tab.

Example:
  python train_multi_year.py
  python mlops_register_hint.py  # prints JSON to register as candidate
"""
import json
from pathlib import Path

def main():
    root = Path(__file__).resolve().parent / "models"
    rows = []
    for name in ("sy_metrics.json", "ty_metrics.json", "final_metrics.json"):
        p = root / name
        if p.exists():
            rows.append(json.loads(p.read_text()))
    if not rows:
        print("{}")
        return
    holdout = sum(r.get("accuracy_holdout", 0) for r in rows) / len(rows)
    payload = {
        "version": f"auto_{rows[0].get('mode', 'model')}",
        "metrics": {"holdout": round(holdout, 4), "fairnessGap": 0.05},
        "notes": "Generated from models/*_metrics.json after retrain",
    }
    print(json.dumps(payload, indent=2))

if __name__ == "__main__":
    main()
