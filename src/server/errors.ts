/**
 * Application errors carry a stable code, an HTTP status and a message that
 * is safe to show to users. Anything else (database errors, stack traces)
 * must be logged on the server and surfaced only as a generic failure.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    options: { code: string; status: number; cause?: unknown },
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, { code: "NOT_FOUND", status: 404 });
  }
}

export class ValidationError extends AppError {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super("Invalid input", { code: "VALIDATION_FAILED", status: 400 });
    this.issues = issues;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
