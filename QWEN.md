# Qwen Engineering Contract — Schwarzschild Lab

## Project identity

This repository is a CPU-first autonomous mesh simulation and visualization project. The primary user-facing experience is the Schwarzschild Lab JARVIS-style live mesh. The codebase contains a FarmEngine simulation, Central Mind coordination, Department Mesh topology, AI-node definitions, execution/ledger/evolution systems, and React/Vite visualization components.

## Non-negotiable architecture

- Preserve the existing architecture unless a change is required to fix a concrete defect.
- Do not replace the mesh with a static mock, random particle animation, or disconnected demo.
- `FarmEngine` remains the source of truth for farm/economic simulation state.
- Central Mind and Department Mesh remain the coordination layer.
- `LiveMeshNetwork` should visualize actual runtime mesh/department state.
- CPU-first rendering is intentional. Do not introduce GPU-heavy rendering merely to make the visualization look better.
- NeuralTapestry/4D views are visualization layers; do not represent them as proof of real model inference.
- AI provider nodes must remain explicit about whether they are configured, unavailable, simulated, or actively running.

## Safety and honesty

- Never invent secrets, API keys, database credentials, payment credentials, deployment URLs, or external-service success.
- Never commit secrets.
- Never enable real-money payments or uncontrolled autonomous external work as a side effect of a bug fix.
- Do not report a subsystem as live merely because an interface or type exists.
- Prefer explicit health states: `healthy`, `degraded`, `disabled`, `unconfigured`, `error`, or `simulated` where appropriate.

## Engineering workflow

1. Inspect the relevant code before modifying it.
2. Run available typecheck, tests, lint and production build commands before changes.
3. Fix root causes instead of masking errors.
4. Add regression coverage for meaningful fixes where practical.
5. Re-run the relevant checks after changes.
6. Keep changes small and reviewable.
7. If blocked by secrets, GitHub settings, Supabase configuration, provider APIs, or deployment configuration, report the exact blocker and the manual action required.

## Mesh-specific priorities

When debugging the live mesh:

1. Verify the mesh state producer.
2. Verify Central Mind/department state propagation.
3. Verify node health/load calculations.
4. Verify React state subscriptions and lifecycle cleanup.
5. Verify animation loops do not leak timers/listeners.
6. Verify mobile layout and low-end CPU behavior.
7. Only then tune visual effects.

## AI integration

Qwen Code is an engineering/development agent used through GitHub Actions. It is not itself one of the runtime AI mesh providers. Keep the distinction explicit:

- Qwen Code Action: repository maintenance, code review, debugging, testing and safe code modification.
- Runtime AI mesh: configured model/provider nodes used by the application.

The Qwen workflow may modify code only within the repository and must leave infrastructure/secrets for explicit human configuration.
