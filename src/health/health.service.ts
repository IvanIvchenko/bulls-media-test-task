import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

export interface HealthStatus {
  status: 'ok';
  llm: string;
}

export class HealthService {
  public constructor(
    /** Rejects if the database cannot be reached. */
    private readonly probeDatabase: () => Promise<void>,
    private readonly llmName: string,
  ) {}

  public async check(): Promise<HealthStatus> {
    try {
      await this.probeDatabase();
    } catch {
      throw new BusinessLogicError('Database is unavailable', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', llm: this.llmName };
  }
}
