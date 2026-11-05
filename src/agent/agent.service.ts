import { buildGraph } from './agent.graph.js';
import type { Result } from '../domain/index.js';
import { CheckEligibilityNode } from './nodes/check-eligibility.node.js';
import { CitePoliciesNode } from './nodes/cite-policies.node.js';
import { ClassifyNode } from './nodes/classify.node.js';
import { DecideNode } from './nodes/decide.node.js';
import { DraftReplyNode } from './nodes/draft-reply.node.js';
import { ExecuteRefundNode } from './nodes/execute-refund.node.js';
import { FinalizeNode } from './nodes/finalize.node.js';
import { GatherNode } from './nodes/gather.node.js';
import { LoadPoliciesNode } from './nodes/load-policies.node.js';
import { ScanInjectionNode } from './nodes/scan-injection.node.js';
import { ValidateNode } from './nodes/validate.node.js';
import type { AgentDeps } from './typedef.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

/** The triage agent: compiles the graph once, then runs it for one raw (untrusted) ticket at a time. */
export class AgentService {
  private readonly graph: ReturnType<typeof buildGraph>;

  public constructor(deps: AgentDeps) {
    this.graph = buildGraph({
      validate: new ValidateNode(),
      load_policies: new LoadPoliciesNode(deps.policies),
      scan_injection: new ScanInjectionNode(),
      classify: new ClassifyNode(deps.llm),
      gather: new GatherNode(deps.orders),
      check_eligibility: new CheckEligibilityNode(deps.now),
      decide: new DecideNode(),
      execute_refund: new ExecuteRefundNode(deps.orders, deps.now),
      cite_policies: new CitePoliciesNode(),
      draft_reply: new DraftReplyNode(deps.llm),
      finalize: new FinalizeNode(deps.audit, deps.now),
    });
  }

  public async run(raw: unknown): Promise<Result> {
    const finalState = await this.graph.invoke({
      raw,
      lookup: 'skipped',
      relatedPolicies: [],
      refundAmount: 0,
      reply: '',
    });
    if (!finalState.result) {
      throw new BusinessLogicError('The agent finished without producing a result.', ErrorCodes.AGENT_STATE_INVARIANT);
    }
    return finalState.result;
  }
}
