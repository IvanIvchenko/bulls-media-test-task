import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { State } from './agent.state.js';
import type { AuditTrail, OrderTools, PolicyTools, ReviewStore } from '../domain/index.js';
import type { LLM } from '../llm/typedef.js';

export type AgentState = typeof State.State;
export type AgentStateUpdate = Partial<AgentState>;

/** Everything the agent needs from the outside world. Injected, so tests can swap any of it. */
export interface AgentDeps {
  llm: LLM;
  orders: OrderTools;
  policies: PolicyTools;
  audit: AuditTrail;
  reviews: ReviewStore;
  /** Where a run that pauses for a person is saved. Only paused runs touch it. */
  checkpointer: BaseCheckpointSaver;
  /** Clock, read once per use. A function so a long-running server sees real time; tests pass a fixed date. */
  now: () => Date;
}

/** One step of the graph: reads the state, returns the part of it that this step owns. */
export interface AgentNode {
  execute(state: AgentState): Promise<AgentStateUpdate>;
}

/** Options for one run. */
export interface RunOptions {
  /**
   * Let an escalation a reviewer can settle pause for a human. The run is saved under this id and resumed with it.
   * Without it the run never pauses (the CLI, tests, a service with review switched off).
   */
  reviewId?: string;
}
