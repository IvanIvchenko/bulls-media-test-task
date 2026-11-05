import type { ClaimsMapper } from './claims.mapper.js';
import type { ClaimsRepository } from './claims.repository.js';
import type { ClaimRecord, ClaimToken, Result, TicketClaims } from '../domain/index.js';

/** Who is processing which ticket, shared by every instance that uses the same database. */
export class ClaimsService implements TicketClaims {
  public constructor(
    private readonly repository: ClaimsRepository,
    private readonly mapper: ClaimsMapper,
  ) {}

  public async tryClaim(ticketId: string, requestHash: string): Promise<ClaimToken | undefined> {
    return this.repository.insertIfAbsent(ticketId, requestHash);
  }

  public async find(ticketId: string): Promise<ClaimRecord | undefined> {
    const row = await this.repository.findById(ticketId);
    return row ? this.mapper.toRecord(row) : undefined;
  }

  public async takeOver(ticketId: string, expiredToken: ClaimToken): Promise<ClaimToken | undefined> {
    return this.repository.replaceOwner(ticketId, expiredToken);
  }

  public async complete(ticketId: string, token: ClaimToken, result: Result): Promise<boolean> {
    return this.repository.markDone(ticketId, token, JSON.stringify(result));
  }

  public async release(ticketId: string, token: ClaimToken): Promise<void> {
    await this.repository.deleteInProgress(ticketId, token);
  }
}
