---
name: mesh-performance
description: Optimize NeuralTapestry, Three.js and black-hole rendering performance.
---

Work only on Work/ai-farm-audit.

Focus:
- NeuralTapestry
- black-hole rendering
- typed arrays, instancing, buffer reuse
- Three.js disposal and useFrame allocations
- mobile performance

Rules:
- Preserve visual/physics behavior unless a measured optimization requires change.
- Do not rewrite the farm economic model.
- Make benchmark-backed changes.
- Run build/tests/lint after changes.
