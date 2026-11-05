import { setTimeout as delay } from 'node:timers/promises';

import { claimIdentity, hashRequest, type ClaimIdentity } from './request-hash.util.js';
import type { Acquired, TicketOutcome, TicketRunner, TicketsOptions } from './typedef.js';
import { FLAG, type ClaimToken, type TicketClaims } from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';
import { Logger } from '../shared/logger/logger.js';

/**
 * Makes ticket processing idempotent by ticket id and sender, so a client retry can never turn an approved refund
 * into a "denied: already refunded", and no ticket is processed twice even when several instances share
 * one database. The database is the referee: the first caller to claim an id owns it.
 *
 * - Unclaimed id: claim it, run the agent, store the decision.
 * - Claimed, same payload, done: replay the stored decision.
 * - Claimed, same payload, still running elsewhere: wait for it, then replay.
 * - Claimed, owner presumed dead (stale): one caller takes over and runs it.
 * - Claimed with a different payload: conflict.
 * - A request rejected as invalid, or a run that throws, gives the id back so the client can retry.
 */
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(
    private readonly claims: TicketClaims,
    private readonly agent: TicketRunner,
    private readonly options: TicketsOptions,
  ) {
    this.sleep = options.sleep ?? ((ms) => delay(ms));
  }

  public async process(raw: unknown): Promise<TicketOutcome> {
    const identity = claimIdentity(raw);
    if (!identity) return { kind: 'ran', result: await this.agent.run(raw) }; // malformed id or e-mail: the agent refuses it
    const { ticketId, claimKey } = identity;

    const acquired = await this.acquire(identity, hashRequest(raw));
    if (acquired.kind === 'replayed') return acquired;

    let result;
    try {
      result = await this.agent.run(raw);
    } catch (error) {
      await this.claims.release(claimKey, acquired.token); // let a retry run
      throw error;
    }

    if (result.flags.includes(FLAG.INVALID_INPUT)) {
      await this.claims.release(claimKey, acquired.token); // a rejected request does not claim its id
    } else if (!(await this.claims.complete(claimKey, acquired.token, result))) {
      this.logger.warn('claim was taken over while the agent ran; the new owner decides', { ticketId });
    }
    return { kind: 'ran', result };
  }

  private async acquire({ ticketId, claimKey }: ClaimIdentity, requestHash: string): Promise<Acquired> {
    const clock = this.options.monotonicMs;
    const deadline = clock() + this.options.waitMs;

    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && clock() >= deadline) throw this.inProgress(ticketId);

      const token = await this.claims.tryClaim(claimKey, requestHash);
      if (token) return { kind: 'owned', token };

      const existing = await this.claims.find(claimKey);
      if (!existing) continue; // released between the two calls: try to claim again
      if (existing.requestHash !== requestHash) throw this.conflict(ticketId);
      if (existing.status === 'done' && existing.result) return { kind: 'replayed', result: existing.result };

      if (existing.ageMs > this.options.staleAfterMs) {
        const taken = await this.claims.takeOver(claimKey, existing.ownerToken);
        if (taken) return this.takenOver(ticketId, taken);
        continue; // somebody else took it over first
      }
      await this.sleep(this.options.pollMs);
    }
  }

  private takenOver(ticketId: string, token: ClaimToken): Acquired {
    this.logger.warn('took over a stale claim', { ticketId });
    return { kind: 'owned', token };
  }

  private conflict(ticketId: string): BusinessLogicError {
    return new BusinessLogicError(
      `Ticket ${ticketId} was already processed with a different payload.`,
      ErrorCodes.TICKET_ID_CONFLICT,
    );
  }

  private inProgress(ticketId: string): BusinessLogicError {
    return new BusinessLogicError(
      `Ticket ${ticketId} is still being processed. Retry shortly.`,
      ErrorCodes.TICKET_IN_PROGRESS,
    );
  }
}
