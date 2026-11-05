export interface ErrorBody {
  status: number;
  code: string;
}

/** Predictable, domain-specific failure. The global `ErrorFilter` turns it into `{ code, message }`. */
export class BusinessLogicError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(
    message: string,
    errorBody: ErrorBody,
    /** Debug context for the logs. Never sent to the client. */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BusinessLogicError';
    this.status = errorBody.status;
    this.code = errorBody.code;
  }
}
