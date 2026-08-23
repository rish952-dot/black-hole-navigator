# Copilot handoff — Neural Mesh Stress

Work only on `Work/ai-farm-audit`.

## Goal
Stress-test the shared neural mesh / vector bus and optimize it without redesigning the Black Hole simulator or changing economic fitness.

## Current test
- 64 mesh nodes
- 20 rounds
- 2 vectors/node/round
- bus cap 10,000
- up to 10 real AI nodes
- AI calls use short English and compact JSON vectors

## AI node contract
Each AI node receives a compact vector and returns only:
`{confidence,novelty,urgency,strategy}`

Numbers must be 0..1. Do not invent profit. Do not access wallets. Do not sign or send blockchain transactions.

## Measure
1. vectors published
2. peak bus size
3. receive vectors
4. elapsed time
5. vectors/second
6. AI calls
7. AI failures
8. memory/CPU pressure if runner metrics are available

## Optimize
Focus on:
- allocations in `src/farm/vector-bus.ts`
- ranking cost
- bounded retention / TTL cleanup
- duplicate vectors
- unnecessary serialization
- AI request batching/concurrency
- deterministic seeds for farm state

## Do not
- rewrite the physics simulator
- couple AI output directly to economic fitness
- add payment signing
- add wallet private keys
- remove repository safety boundaries

## Output
Read `mesh-stress-results.json` and `mesh-stress-result.md`.
Recommend only changes backed by measured data.
