# Roadmap — production deployment hardening

- [ ] DB tables: farm_runs, farm_generations, farm_ledger (RLS on, service-role only)
- [ ] Edge function: health (DB + config check, CORS)
- [ ] Edge function: farm-state (save/load, validated, fail-closed finance mode)
- [ ] Client: persistence adapter + backend health hook, graceful degradation
- [ ] Controller layer wiring engine + roles + meshNet + allocator + metrics + health
- [ ] Farm dashboard: roles / mesh / metrics / health tabs
- [ ] Mesh page: real backend/farm status readout
- [ ] Route-level code splitting + top-level error boundary
- [ ] Mobile performance tuning (cadence, list sizes)
- [ ] Tests for controller, persistence, health
- [ ] typecheck + tests + production build
- [ ] Verify deployed health and farm-state save/load, then publish
