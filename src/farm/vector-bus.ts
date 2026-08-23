import type { Agent, Opportunity } from "./types";

/** Compact machine-to-machine message used by agents to coordinate without chat transcripts. */
export interface AgentVector {
  sender: number;
  generation: number;
  opportunityId: string;
  strategy: number[];
  confidence: number;
  expectedValue: number;
  resourceCost: number;
  novelty: number;
  urgency: number;
  ttl: number;
}

export interface VectorSignal {
  recipient?: number;
  vector: AgentVector;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function encodeVector(
  agent: Agent,
  opportunity: Opportunity,
  generation: number,
  expectedValue: number,
  confidence: number,
): AgentVector {
  const strategy = [
    agent.genome.riskTolerance,
    agent.genome.verificationLevel,
    agent.genome.researchDepth,
    agent.genome.parallelism / 8,
    agent.genome.computeBudget / 400,
  ].map(clamp01);

  return {
    sender: Number(agent.id.replace(/\D/g, "")) || 0,
    generation,
    opportunityId: opportunity.id,
    strategy,
    confidence: clamp01(confidence),
    expectedValue,
    resourceCost: opportunity.computeCost,
    novelty: clamp01(1 - opportunity.competition),
    urgency: clamp01(1 - opportunity.durationMin / 180),
    ttl: 3,
  };
}

export function rankVector(vector: AgentVector): number {
  return (
    vector.expectedValue * (0.5 + vector.confidence * 0.5) +
    vector.novelty * 10 +
    vector.urgency * 5 -
    vector.resourceCost * 0.5
  );
}

/** Bounded in-memory message bus for the farm generation. */
export class VectorBus {
  private readonly messages: AgentVector[] = [];
  constructor(private readonly maxMessages = 2000) {}

  publish(message: AgentVector): void {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) this.messages.splice(0, this.messages.length - this.maxMessages);
  }

  receive(recipientGeneration: number): AgentVector[] {
    return this.messages
      .filter((m) => m.generation >= recipientGeneration - m.ttl)
      .sort((a, b) => rankVector(b) - rankVector(a));
  }

  clearGeneration(generation: number): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].generation < generation - this.messages[i].ttl) this.messages.splice(i, 1);
    }
  }

  get size(): number {
    return this.messages.length;
  }
}
