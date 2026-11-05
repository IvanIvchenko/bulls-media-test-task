import pino from 'pino';

import { requestContext } from './request-context.js';

/** Customer fields are always masked, whatever a caller logs. */
const REDACT = {
  paths: ['customerEmail', 'email', 'subject', 'body', '*.customerEmail', '*.subject', '*.body'],
  censor: '[redacted]',
};

/** JSON logs to stderr so stdout stays clean for the CLI's JSON output. */
const createRoot = (level: string, destination: pino.DestinationStream = pino.destination(2)) =>
  pino({ level, redact: REDACT }, destination);

/** Per-class logger: `private readonly logger = new Logger(ClassName.name);` */
export class Logger {
  private static root = createRoot('info');

  /** Call once at startup, before the first request. `destination` lets tests capture the output. */
  public static configure(level: string, destination?: pino.DestinationStream): void {
    Logger.root = createRoot(level, destination);
  }

  /** The underlying pino instance, for the HTTP framework's request logging. */
  public static get pino(): pino.Logger {
    return Logger.root;
  }

  public constructor(private readonly context: string) {}

  public debug(message: string, extra: object = {}): void {
    Logger.root.debug({ context: this.context, ...requestContext.getStore(), ...extra }, message);
  }

  public log(message: string, extra: object = {}): void {
    Logger.root.info({ context: this.context, ...requestContext.getStore(), ...extra }, message);
  }

  public warn(message: string, extra: object = {}): void {
    Logger.root.warn({ context: this.context, ...requestContext.getStore(), ...extra }, message);
  }

  public error(message: string, extra: object = {}): void {
    Logger.root.error({ context: this.context, ...requestContext.getStore(), ...extra }, message);
  }

  public fatal(message: string, extra: object = {}): void {
    Logger.root.fatal({ context: this.context, ...requestContext.getStore(), ...extra }, message);
  }
}
