# Academic Intelligence Spine

Research-aligned modules beyond predict+SHAP dashboards.

## Modules
1. **Uplift intervention allocator** — rank students by estimated benefit of action (not only risk).
2. **Closed-loop outcomes** — log intervention → later status/UT/attendance change; effectiveness rates.
3. **Workload-capped queues** — flag-rate cap (default top 15%) + per-TG weekly capacity.
4. **Fairness report** — at-risk / slow / high-uplift rates by batch letter.
5. **Drift / model health** — cohort snapshots after uploads; delta alerts; audit log.
6. **Predictive OBE** — mid-term CO attainment forecast from UT+attendance; CO→PO links.

## Where in UI
- Admin: Academic Intelligence, Interventions, Predictive OBE, Model health
- TG: Intervention queue (capacity-aware uplift list)

## Data
Client persistence keys `bvu.ai.*` (localStorage). Replace with API/DB for multi-user production.

## Honest limits
Uplift starts as a risk×fixability heuristic and blends empirical success rates as outcomes accumulate. Full causal uplift models need randomized or carefully debiased treatment logs over multiple terms.
