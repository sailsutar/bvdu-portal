# System Design Index

| Document | Audience | Content |
|----------|----------|---------|
| [HLD.md](./HLD.md) | Guides, architects | Context, layers, deployment view |
| [LLD.md](./LLD.md) | Developers | Modules, schemas, sequences, APIs |
| [CICD.md](./CICD.md) | DevOps / team | CI workflow, environments, secrets |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Operators | Env vars, run, backup |
| [../ML-INTEGRATION.md](../ML-INTEGRATION.md) | ML owners | Predict/explain contracts |

## Design decisions (summary)

1. **Monorepo `starter/`** — frontend, backend, ml-service together for student projects.  
2. **PRN longitudinal model** — one person across years; cohort id for intake batch.  
3. **Separate ML process** — Python stack isolated from Node; HTTP contract.  
4. **Atlas-first data** — multi-device HOD use without depending on browser-only storage.  
5. **Role portals** — separate UX per actor instead of one mega-admin screen.
