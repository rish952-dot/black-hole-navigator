# Production deployment hardening — Black Hole Navigator + Agent Farm

Current state: the 3D mesh/black-hole simulator, the Agent Farm engine, and three backend functions (AI tick, AI stream, physics) all work and the production build, typecheck and tests are green. What's missing for a real deployment is persistence, health visibility, error containment, and wiring of the modules that were added but never connected (roles, mesh network, allocator, metrics, health).

Nothing existing gets rebuilt or redesigned. All work is additive or a targeted fix.

## 1. Real backend state (not mock-only)

- New database tables for farm runs, per-generation records, and ledger entries. They stay fully locked down: no public read/write, reachable only through a server function.
- New `farm-state` function: saves a run snapshot and loads it back by run key, with strict input validation and size caps.
- New `health` function: reports whether the database and AI gateway config are reachable, plus a version stamp.

## 2. Persistence + graceful degradation

- Client persistence adapter with autosave (throttled) and restore-on-load, keyed by a stable run key stored locally.
- Every backend call is wrapped so failures never break the UI: the farm keeps running locally and shows an "offline" state instead.

## 3. Wire the unused modules through a controller

- New controller layer (UI → controller → agents → mesh → persistence) that runs the engine and, each generation, updates agent roles/lifecycle, the adaptive mesh topology, metrics, and the health report.
- Farm dashboard gains Roles, Mesh, Metrics and Health tabs fed by the controller.

## 4. Live mesh visualization tied to real state

- The simulator already publishes its field into the farm. Add the reverse channel: farm health and backend status feed a compact status readout on the mesh page, degrading to "local only" when the backend is unavailable.

## 5. Finance stays fail-closed

- Deployment mode is clamped server-side and client-side to simulation/paper. Real-money modes are rejected with an explicit error; no payout execution path is added, and no secrets reach the client.

## 6. Deployment-path fixes and mobile/reliability

- Route-level code splitting so the 1.8 MB bundle no longer loads the 3D stack on every route.
- A top-level error boundary so a WebGL or render failure shows a recovery screen instead of a blank page.
- Page title/description per route; correct CORS on all functions; 404 route already present.
- Mobile: lower default simulation cadence and lighter dashboard lists on small screens.

## 7. Validation then publish

Run typecheck, the full test suite (plus new tests for the controller, persistence adapter and health logic), and a production build. Then exercise the deployed backend functions directly (health, farm-state save/load) and confirm the app loads, before publishing to a public Lovable URL.

## Technical notes

- Tables: `farm_runs`, `farm_generations`, `farm_ledger`; RLS enabled with no anon/authenticated grants, service-role only, accessed via edge function.
- Functions use the shared CORS headers and return CORS on error paths too.
- Persistence writes are debounced (~5 s) and bounded (last 200 generations, last 500 ledger rows) to keep payloads small.
