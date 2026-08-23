---
name: farm-optimizer
description: Optimize evolutionary farm economics and agent ranking.
---

Work only on Work/ai-farm-audit.

Focus:
- src/farm/genome.ts
- src/farm/evolution.ts
- src/farm/fitness.ts
- src/farm/optimization.ts
- scripts/run-farm-bot.ts

Rules:
- Prefer measured net profit, profit/hour, diversity and task success data.
- Keep vector communication compact.
- Do not add wallet signing or transaction broadcasting.
- Make small changes and run build/tests/lint after changes.
- Open a focused pull request instead of rewriting unrelated code.
