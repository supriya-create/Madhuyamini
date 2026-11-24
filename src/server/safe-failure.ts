import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { AppError } from "./errors";
import { PaymentGatewayError } from "./payments/gateway";

/**
 * What may be written down about a failure.
 *
 * An exception's own text is not ours to keep: a database error can echo the
 * query and its values, a provider error carries the provider's wording, and
 * either can quote a customer's details. So nothing here reads a message, a
 * stack, a cause, a `name` or `toString()`. A failure is described by a code
 * from a closed list, the fixed sentence that belongs to that code, and a
 * few identifiers that are each checked before they are kept.
 *
 * An error is recognised only by what it is (`instanceof` a class that this
 * application or its database client defines) and by comparing its fields
 * with literals. An object that merely looks like one of those errors is
 * unknown, and an unknown error gets the generic fallback.
 *
 * What the caller passes in is held to the same rule as what the error
 * carries: the types say what a caller should pass, and the checks below are
 * what is relied on. Every value is read once, must be a primitive of the
 * right type, and is kept only if it is on its list or matches its pattern.
 */

/** Every code a failure can be recorded under, with the only sentence that goes with it. */
export const FAILURE_SUMMARIES = {
  PAYMENT_PROVIDER_UNAVAILABLE:
    "The payment provider could not be reached or did not answer in time.",
  PAYMENT_PROVIDER_REJECTED: "The payment provider refused the request.",
  PAYMENT_DUPLICATE_RECEIPT:
    "The payment provider already holds an order for this receipt.",
  PAYMENT_NOT_CONFIGURED:
    "Online payment is not configured in this environment.",
  CAPTURE_NOT_APPLICABLE:
    "A capture arrived for a payment attempt that is not in a state to accept one.",
  INVENTORY_INCONSISTENT:
    "The stock counters and the reservations for an item disagree.",
  RECORD_NOT_FOUND: "A record the operation needed was not found.",
  APPLICATION_RULE_REFUSED: "An application rule refused the operation.",
  DATABASE_UNIQUE_CONFLICT:
    "The database refused the write because it would duplicate an existing record.",
  DATABASE_CONSTRAINT_VIOLATION:
    "The database refused the write because it would break a data rule.",
  DATABASE_RECORD_MISSING:
    "The database could not find a record the operation depends on.",
  DATABASE_CONFLICT:
    "The database stopped the transaction because it conflicted with another one.",
  DATABASE_UNAVAILABLE:
    "The database could not be reached or did not answer in time.",
  DATABASE_ACCESS_DENIED:
    "The database refused the application's credentials or permissions.",
  DATABASE_INVALID_REQUEST:
    "The application sent the database a request it could not accept.",
  DATABASE_ERROR: "The database reported an error.",
  EMAIL_RENDER_FAILED: "The email could not be built from its stored data.",
  EMAIL_DELIVERY_FAILED:
    "The email provider did not accept the message or could not be reached.",
  UNKNOWN_ERROR: "An unexpected internal error occurred.",
} as const;

export type FailureCode = keyof typeof FAILURE_SUMMARIES;

const FAILURE_CODES = Object.keys(FAILURE_SUMMARIES) as FailureCode[];

/** The subsystems that record failures: the only values `source` can take. */
const FAILURE_SOURCES = [
  "reservation-expiry",
  "payment-webhook",
  "refund",
  "notification",
] as const;

/** The subsystem that met the failure. */
export type FailureSource = (typeof FAILURE_SOURCES)[number];

/** The only codes a caller may suggest for an error that says nothing itself. */
const FALLBACK_CODES = [
  "EMAIL_RENDER_FAILED",
  "EMAIL_DELIVERY_FAILED",
] as const satisfies readonly FailureCode[];

type FallbackCode = (typeof FALLBACK_CODES)[number];

/**
 * A failure as it may be persisted. Every value is either one of this
 * module's own constants or has passed the check named beside it.
 */
export type SafeFailure = {
  readonly code: FailureCode;
  /** Always `FAILURE_SUMMARIES[code]`. */
  readonly summary: string;
  /** One of the four subsystems; "unknown" when the caller named none of them. */
  readonly source: FailureSource | "unknown";
  /**
   * Whether trying again can help, as far as the error itself says; null
   * when it does not say. This describes the error and decides nothing: a
   * caller chooses what to retry from the original error and its own policy,
   * never from this field.
   */
  readonly retryable: boolean | null;
  /** The record concerned, as given by the caller; null unless shaped like an identifier. */
  readonly reference: string | null;
  /** The database client's public error code (`P` and four digits). */
  readonly databaseCode?: string;
  /** PostgreSQL's five-character SQLSTATE. */
  readonly sqlState?: string;
};

export interface FailureContext {
  readonly source: FailureSource;
  readonly reference: string | null;
  /**
   * What an unrecognised error most plausibly is at this point in the
   * caller. Used only when the error itself tells us nothing.
   */
  readonly fallback?: FallbackCode;
}

type Classified = {
  readonly code: FailureCode;
  readonly retryable: boolean | null;
  readonly databaseCode?: string;
  readonly sqlState?: string;
};

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const DATABASE_CODE = /^P[0-9]{4}$/;
const SQL_STATE = /^[0-9A-Z]{5}$/;

const GATEWAY_CODES: ReadonlyMap<string, FailureCode> = new Map<
  string,
  FailureCode
>([
  ["PAYMENT_PROVIDER_UNAVAILABLE", "PAYMENT_PROVIDER_UNAVAILABLE"],
  ["PAYMENT_PROVIDER_REJECTED", "PAYMENT_PROVIDER_REJECTED"],
  ["PAYMENT_DUPLICATE_RECEIPT", "PAYMENT_DUPLICATE_RECEIPT"],
  ["PAYMENT_NOT_CONFIGURED", "PAYMENT_NOT_CONFIGURED"],
]);

/** Application error codes that have a sentence of their own; any other is "a rule refused it". */
const APPLICATION_CODES: ReadonlyMap<string, Classified> = new Map<
  string,
  Classified
>([
  [
    "INVENTORY_INCONSISTENT",
    { code: "INVENTORY_INCONSISTENT", retryable: false },
  ],
  // The attempt may yet reach a state that accepts the capture.
  [
    "CAPTURE_NOT_APPLICABLE",
    { code: "CAPTURE_NOT_APPLICABLE", retryable: true },
  ],
  ["NOT_FOUND", { code: "RECORD_NOT_FOUND", retryable: false }],
]);

const unique: Classified = {
  code: "DATABASE_UNIQUE_CONFLICT",
  retryable: false,
};
const constraint: Classified = {
  code: "DATABASE_CONSTRAINT_VIOLATION",
  retryable: false,
};
const missing: Classified = {
  code: "DATABASE_RECORD_MISSING",
  retryable: false,
};
const conflict: Classified = { code: "DATABASE_CONFLICT", retryable: true };
const unavailable: Classified = {
  code: "DATABASE_UNAVAILABLE",
  retryable: true,
};
const denied: Classified = { code: "DATABASE_ACCESS_DENIED", retryable: false };
const invalid: Classified = {
  code: "DATABASE_INVALID_REQUEST",
  retryable: false,
};
const generic: Classified = { code: "DATABASE_ERROR", retryable: null };

/** The database client's documented codes, by what they mean for an operator. */
const DATABASE_CODES: ReadonlyMap<string, Classified> = new Map<
  string,
  Classified
>([
  ["P1000", denied],
  ["P1010", denied],
  ["P1001", unavailable],
  ["P1002", unavailable],
  ["P1008", unavailable],
  ["P1017", unavailable],
  ["P2024", unavailable],
  ["P2002", unique],
  ["P2003", constraint],
  ["P2004", constraint],
  ["P2011", constraint],
  ["P2014", constraint],
  ["P2001", missing],
  ["P2015", missing],
  ["P2018", missing],
  ["P2025", missing],
  ["P2034", conflict],
  ["P2005", invalid],
  ["P2006", invalid],
  ["P2007", invalid],
  ["P2019", invalid],
  ["P2020", invalid],
  ["P2033", invalid],
]);

/** For the client's catch-all codes, PostgreSQL's own class says what happened. */
function fromSqlState(sqlState: string): Classified | null {
  if (sqlState === "23505") return unique;
  if (sqlState === "42501") return denied;
  switch (sqlState.slice(0, 2)) {
    case "23":
      return constraint;
    case "40":
      return conflict;
    case "08":
    case "53":
    case "57":
      return unavailable;
    case "28":
      return denied;
    default:
      return null;
  }
}

/**
 * The listed value that `value` is, or undefined. Only a primitive string
 * can be one: nothing is coerced, so no `toString` is ever called. What comes
 * back is this module's own constant, not the value that was passed in.
 */
function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === "string"
    ? allowed.find((item) => item === value)
    : undefined;
}

function databaseCodeOf(value: unknown): string | undefined {
  return typeof value === "string" && DATABASE_CODE.test(value)
    ? value
    : undefined;
}

function sqlStateOf(value: unknown): string | undefined {
  return typeof value === "string" && SQL_STATE.test(value) ? value : undefined;
}

function referenceOf(value: unknown): string | null {
  return typeof value === "string" && REFERENCE.test(value) ? value : null;
}

/**
 * One own property of a value that may be anything, read once. A getter that
 * throws, a proxy that refuses and a value that is not an object all read as
 * undefined, so nothing passed in can make the caller throw.
 */
function property(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/** The SQLSTATE the driver attached to a database error, if it is one. */
function driverSqlState(meta: unknown): string | undefined {
  return sqlStateOf(
    property(
      property(property(meta, "driverAdapterError"), "cause"),
      "originalCode",
    ),
  );
}

function withDatabaseCodes(
  base: Classified,
  databaseCode: string | undefined,
  sqlState: string | undefined,
): Classified {
  return {
    code: base.code,
    retryable: base.retryable,
    ...(databaseCode ? { databaseCode } : {}),
    ...(sqlState ? { sqlState } : {}),
  };
}

/** Null when the error is not an instance of anything this module knows. */
function classify(error: unknown): Classified | null {
  if (error instanceof PaymentGatewayError) {
    const code: unknown = error.code;
    const retryable: unknown = error.retryable;
    return {
      code:
        (typeof code === "string" ? GATEWAY_CODES.get(code) : undefined) ??
        "APPLICATION_RULE_REFUSED",
      retryable: typeof retryable === "boolean" ? retryable : null,
    };
  }
  if (error instanceof AppError) {
    const code: unknown = error.code;
    return (
      (typeof code === "string" ? APPLICATION_CODES.get(code) : undefined) ?? {
        code: "APPLICATION_RULE_REFUSED",
        // An unlisted code says nothing about retrying, so neither does this.
        retryable: null,
      }
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const databaseCode = databaseCodeOf(error.code);
    const sqlState = driverSqlState(error.meta);
    const known =
      (databaseCode ? DATABASE_CODES.get(databaseCode) : undefined) ??
      (sqlState ? fromSqlState(sqlState) : null) ??
      generic;
    return withDatabaseCodes(known, databaseCode, sqlState);
  }
  if (error instanceof Prisma.PrismaClientValidationError) return invalid;
  if (error instanceof Prisma.PrismaClientInitializationError) {
    const databaseCode = databaseCodeOf(error.errorCode);
    const known =
      (databaseCode ? DATABASE_CODES.get(databaseCode) : undefined) ??
      unavailable;
    return withDatabaseCodes(known, databaseCode, undefined);
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return generic;
  }
  return null;
}

/**
 * Describes a failure for the record. Never throws, whatever was thrown at
 * it or passed with it: an error that cannot even be inspected is simply
 * unknown, and a context value that is not on its list is not kept.
 */
export function describeFailure(
  error: unknown,
  context: FailureContext,
): SafeFailure {
  let classified: Classified | null;
  try {
    classified = classify(error);
  } catch {
    classified = null;
  }
  const code =
    classified?.code ??
    oneOf(FALLBACK_CODES, property(context, "fallback")) ??
    "UNKNOWN_ERROR";
  return {
    code,
    summary: FAILURE_SUMMARIES[code],
    source: oneOf(FAILURE_SOURCES, property(context, "source")) ?? "unknown",
    retryable: classified?.retryable ?? null,
    reference: referenceOf(property(context, "reference")),
    ...(classified?.databaseCode
      ? { databaseCode: classified.databaseCode }
      : {}),
    ...(classified?.sqlState ? { sqlState: classified.sqlState } : {}),
  };
}

/**
 * One line for a `last_error` column or an event note: the code, its fixed
 * sentence and the checked database codes, and nothing else. Never throws.
 *
 * Nothing about the object passed in is taken on trust. Each field is read
 * once; the code must be a primitive string on the list, and the sentence is
 * looked up again from it, so the line is the fixed one whatever the object
 * carries. Anything else is written as the generic code.
 */
export function formatFailure(failure: SafeFailure): string {
  const code =
    oneOf(FAILURE_CODES, property(failure, "code")) ?? "UNKNOWN_ERROR";
  const codes = [
    databaseCodeOf(property(failure, "databaseCode")),
    sqlStateOf(property(failure, "sqlState")),
  ].filter((value): value is string => value !== undefined);
  return `${code}: ${FAILURE_SUMMARIES[code]}${codes.length > 0 ? ` [${codes.join(" ")}]` : ""}`;
}
