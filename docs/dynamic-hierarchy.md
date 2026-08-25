# Dynamic hierarchical mesh

This branch adopts a pragmatic hierarchy inspired by the attached research report and by the existing Farm/Mesh architecture.

## Model

- Every agent may operate independently as a specialist worker.
- Agents form temporary clusters for cooperative tasks.
- Compact vector messages are the default coordination payload.
- A supervisor is an elected cluster role, not a permanent node type.
- An agent promoted to supervisor does not disappear; its prior workload is reassigned and its role/capabilities change.
- An odd cluster size is a **trigger to consider** election, not a rule that sacrifices an arbitrary node.
- Supervisor choice considers capability, reliability, capacity, load and latency.
- A failed/degraded/recovering supervisor triggers re-election.
- Cluster epochs make transitions observable and prevent stale leadership state.

## Security and reliability

The research report recommends encrypted/signed peer communication, compartmentalization, failover, idempotency and dedicated tests. This branch adds an optional AES-256-GCM vector transport boundary while retaining the existing simulation VectorBus. Production key provisioning must remain external to source control.

## Existing architecture retained

- Central Mind remains the top-level coordinator.
- DepartmentMesh remains the inter-department control plane.
- Hive topology remains responsible for node selection/routing.
- Farm roles/lifecycle remain the worker capability layer.
- Financial capabilities remain isolated from worker authority.

## Next integration stages

1. Route cluster formation through `hierarchy.ts`.
2. Connect promotion/demotion to role lifecycle without losing worker history.
3. Add heartbeat-driven supervisor failover.
4. Add task idempotency/deduplication.
5. Integrate authenticated transport behind a deployment flag.
6. Feed cluster state into the live CPU mesh visualization.
