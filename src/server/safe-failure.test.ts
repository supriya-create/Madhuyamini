import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { AppError, NotFoundError } from "./errors";
import { PaymentGatewayError } from "./payments/gateway";
import {
  FAILURE_SUMMARIES,
  describeFailure,
  formatFailure,
} from "./safe-failure";
import type { FailureContext, SafeFailure } from "./safe-failure";

/**
 * The description of a failure is what gets persisted (alerts, `last_error`
 * columns, event notes), so these tests feed it everything an exception can
 * carry and check that none of it comes out. All values are synthetic.
 */

const UNSAFE = {
  apiKey: "rzp_test_NOTAREALKEY000",
  secret: "sk_test_NOTAREALSECRET000",
  bearer: "Bearer eyFAKE.TOKEN.VALUE",
  email: "leak.victim@example.com",
  phone: "+919812345678",
  sql: 'INSERT INTO "users" ("email","phone") VALUES ($1,$2)',
  constraint: "users_email_key",
  table: "customer_addresses",
  path: "/var/task/src/features/payments/internal-file.ts:42:7",
  script: '<script>alert("x")</script>',
  connection: "postgresql://app:not-a-real-password@db.internal:5432/shop",
} as const;

const EVERYTHING = Object.values(UNSAFE).join(" | ");

/** Fragments as well as whole values, so a partial leak is caught too. */
const FORBIDDEN = [
  ...Object.values(UNSAFE),
  "NOTAREAL",
  "leak.victim",
  "9812345678",
  "not-a-real-password",
  "db.internal",
  "internal-file",
  "alert(",
  "INSERT INTO",
];

const context: FailureContext = {
  source: "refund",
  reference: "refund:MY-TEST0001-1-R1",
};

const ALLOWED_KEYS = [
  "code",
  "summary",
  "source",
  "retryable",
  "reference",
  "databaseCode",
  "sqlState",
];

const SOURCES = [
  "reservation-expiry",
  "payment-webhook",
  "refund",
  "notification",
] as const;

const UNKNOWN_LINE = "UNKNOWN_ERROR: An unexpected internal error occurred.";

/**
 * Nothing unsafe in the object or in the line written to a column, however
 * it is serialised, and every field is a value from its own list or pattern:
 * a field that is merely free of the forbidden text does not pass.
 */
function expectClean(failure: SafeFailure): void {
  const written = [
    JSON.stringify(failure),
    inspect(failure, { depth: null, showHidden: true }),
    formatFailure(failure),
  ];
  for (const text of written) {
    for (const forbidden of FORBIDDEN) expect(text).not.toContain(forbidden);
  }
  for (const key of Reflect.ownKeys(failure)) {
    expect(ALLOWED_KEYS).toContain(key);
  }
  expect(Object.keys(FAILURE_SUMMARIES)).toContain(failure.code);
  expect(failure.summary).toBe(FAILURE_SUMMARIES[failure.code]);
  expect([...SOURCES, "unknown"]).toContain(failure.source);
  expect([true, false, null]).toContain(failure.retryable);
  if (failure.reference !== null) {
    expect(failure.reference).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
    expect(failure.reference).not.toMatch(/[\r\n]/);
  }
  if ("databaseCode" in failure) {
    expect(failure.databaseCode).toMatch(/^P[0-9]{4}$/);
  }
  if ("sqlState" in failure) {
    expect(failure.sqlState).toMatch(/^[0-9A-Z]{5}$/);
  }
  expect(formatFailure(failure)).not.toMatch(/[\r\n]/);
}

function describeClean(error: unknown, ctx = context): SafeFailure {
  const failure = describeFailure(error, ctx);
  expectClean(failure);
  return failure;
}

const unknown = {
  code: "UNKNOWN_ERROR",
  summary: "An unexpected internal error occurred.",
  source: "refund",
  retryable: null,
  reference: "refund:MY-TEST0001-1-R1",
};

describe("describeFailure: what an exception carries never comes out", () => {
  it("a fake API key, secret and bearer token in the message", () => {
    const error = new Error(
      `request failed with key ${UNSAFE.apiKey} and ${UNSAFE.secret}; header Authorization: ${UNSAFE.bearer}`,
    );
    expect(describeClean(error)).toEqual(unknown);
  });

  it("a customer email and phone echoed by a database validation error", () => {
    const error = new Prisma.PrismaClientValidationError(
      `Invalid \`prisma.notificationOutbox.createMany()\` invocation:\n\n{\n  data: [\n    {\n      recipient: "${UNSAFE.email}",\n      payload: { phone: "${UNSAFE.phone}" }\n    }\n  ]\n}`,
      { clientVersion: "test" },
    );
    expect(describeClean(error)).toEqual({
      ...unknown,
      code: "DATABASE_INVALID_REQUEST",
      summary:
        "The application sent the database a request it could not accept.",
      retryable: false,
    });
  });

  it("a database error with SQL, constraint and table names and the failing row", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `${UNSAFE.sql}\nUnique constraint failed on the constraint: \`${UNSAFE.constraint}\``,
      {
        code: "P2002",
        clientVersion: "test",
        meta: {
          modelName: "User",
          driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
              originalCode: "23505",
              originalMessage: `duplicate key value violates unique constraint "${UNSAFE.constraint}"`,
              kind: "UniqueConstraintViolation",
              constraint: { index: UNSAFE.constraint },
              table: UNSAFE.table,
              detail: `Key (email)=(${UNSAFE.email}) already exists.`,
            },
          },
        },
      },
    );
    expect(describeClean(error)).toEqual({
      ...unknown,
      code: "DATABASE_UNIQUE_CONFLICT",
      summary:
        "The database refused the write because it would duplicate an existing record.",
      retryable: false,
      databaseCode: "P2002",
      sqlState: "23505",
    });
  });

  it("the database client's catch-all code is read through PostgreSQL's class, never its text", () => {
    const withState = (originalCode: unknown, code = "P2039") =>
      new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
        code,
        clientVersion: "test",
        meta: {
          modelName: "NotificationOutbox",
          driverAdapterError: {
            cause: {
              originalCode,
              message: EVERYTHING,
              detail: `Failing row contains (${UNSAFE.email}, ${UNSAFE.phone}).`,
            },
          },
        },
      });
    expect(describeClean(withState("23514"))).toMatchObject({
      code: "DATABASE_CONSTRAINT_VIOLATION",
      retryable: false,
      databaseCode: "P2039",
      sqlState: "23514",
    });
    expect(describeClean(withState("40P01", "P2010"))).toMatchObject({
      code: "DATABASE_CONFLICT",
      retryable: true,
      databaseCode: "P2010",
      sqlState: "40P01",
    });
    expect(describeClean(withState("42501"))).toMatchObject({
      code: "DATABASE_ACCESS_DENIED",
    });
    expect(describeClean(withState("08006"))).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
    });
    // A state that is not a state is not kept, and tells us nothing.
    for (const forged of [
      UNSAFE.email,
      "23514; DROP TABLE users",
      { toString: () => "23514" },
      23514,
      null,
    ]) {
      const failure = describeClean(withState(forged));
      expect(failure.code).toBe("DATABASE_ERROR");
      expect(failure).not.toHaveProperty("sqlState");
    }
  });

  it("a database code that is not one is dropped", () => {
    for (const forged of [
      "P2002'; DROP TABLE users;--",
      UNSAFE.email,
      "p2002",
      "P20020",
    ]) {
      const error = new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
        code: forged,
        clientVersion: "test",
      });
      const failure = describeClean(error);
      expect(failure.code).toBe("DATABASE_ERROR");
      expect(failure).not.toHaveProperty("databaseCode");
    }
  });

  it("a connection failure whose text carries the connection string", () => {
    const error = new Prisma.PrismaClientInitializationError(
      `Can't reach database server at ${UNSAFE.connection}`,
      "test",
      "P1001",
    );
    expect(describeClean(error)).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
      databaseCode: "P1001",
    });
    expect(
      describeClean(
        new Prisma.PrismaClientInitializationError(EVERYTHING, "test", "P1000"),
      ).code,
    ).toBe("DATABASE_ACCESS_DENIED");
    expect(
      describeClean(
        new Prisma.PrismaClientUnknownRequestError(EVERYTHING, {
          clientVersion: "test",
        }),
      ).code,
    ).toBe("DATABASE_ERROR");
    expect(
      describeClean(new Prisma.PrismaClientRustPanicError(EVERYTHING, "test"))
        .code,
    ).toBe("DATABASE_ERROR");
  });

  it("a file path in the message and a stack trace", () => {
    const error = new Error(`ENOENT: no such file, open '${UNSAFE.path}'`);
    error.stack = `Error: boom\n    at secretFunction (${UNSAFE.path})\n    at ${UNSAFE.connection}`;
    expect(describeClean(error)).toEqual(unknown);
  });

  it("markup and a key in the payment provider's own description", () => {
    const rejected = new PaymentGatewayError(
      `Razorpay rejected the request: ${UNSAFE.script} ${UNSAFE.apiKey}`,
      {
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
        cause: UNSAFE.script,
      },
    );
    expect(describeClean(rejected)).toEqual({
      ...unknown,
      code: "PAYMENT_PROVIDER_REJECTED",
      summary: "The payment provider refused the request.",
      retryable: false,
    });
    const unreachable = new PaymentGatewayError(EVERYTHING, {
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      retryable: true,
      cause: new Error(EVERYTHING),
    });
    expect(describeClean(unreachable)).toMatchObject({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(
      describeClean(
        new PaymentGatewayError(EVERYTHING, {
          code: "PAYMENT_DUPLICATE_RECEIPT",
          retryable: false,
        }),
      ).code,
    ).toBe("PAYMENT_DUPLICATE_RECEIPT");
    expect(
      describeClean(
        new PaymentGatewayError(EVERYTHING, {
          code: "PAYMENT_NOT_CONFIGURED",
          retryable: false,
        }),
      ).code,
    ).toBe("PAYMENT_NOT_CONFIGURED");
  });

  it("a nested cause and attached metadata", () => {
    const error = Object.assign(
      new Error("outer", {
        cause: new Error(EVERYTHING, { cause: { token: UNSAFE.secret } }),
      }),
      {
        meta: { detail: `Failing row contains (${UNSAFE.email})` },
        response: { status: 422, body: EVERYTHING },
        config: { headers: { Authorization: UNSAFE.bearer } },
      },
    );
    expect(describeClean(error)).toEqual(unknown);
  });
});

describe("describeFailure: an error is trusted for what it is, not what it claims", () => {
  it("an object that only looks like an application error is unknown", () => {
    const lookalike = {
      name: "AppError",
      code: "INVENTORY_INCONSISTENT",
      message: EVERYTHING,
      retryable: true,
      toString: () => EVERYTHING,
    };
    expect(describeClean(lookalike)).toEqual(unknown);
  });

  it("never calls toString, on the error or on anything it carries", () => {
    const toString = vi.fn(() => EVERYTHING);
    const error = Object.assign(new Error("x"), {
      toString,
      name: { toString },
      code: { toString },
    });
    const failure = describeClean(error);
    formatFailure(failure);
    expect(failure).toEqual(unknown);
    expect(toString).not.toHaveBeenCalled();
  });

  it("an application error whose code was replaced is not believed", () => {
    const swapped = Object.assign(
      new AppError("m", { code: "INVENTORY_INCONSISTENT", status: 500 }),
      { code: { toString: () => "INVENTORY_INCONSISTENT" } },
    );
    expect(describeClean(swapped).code).toBe("APPLICATION_RULE_REFUSED");
    const forgedRetry = Object.assign(
      new PaymentGatewayError("m", {
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
      }),
      { retryable: "yes", code: UNSAFE.email },
    );
    expect(describeClean(forgedRetry)).toMatchObject({
      code: "APPLICATION_RULE_REFUSED",
      retryable: null,
    });
  });

  it("an application error with an unlisted code keeps neither the code nor the message", () => {
    const error = new AppError(EVERYTHING, { code: UNSAFE.email, status: 400 });
    expect(describeClean(error)).toEqual({
      ...unknown,
      code: "APPLICATION_RULE_REFUSED",
      summary: "An application rule refused the operation.",
      // Nothing is known about retrying it, so nothing is claimed.
      retryable: null,
    });
    expect(
      describeClean(
        new AppError(EVERYTHING, { code: "PAYMENT_NOT_ALLOWED", status: 409 }),
      ).retryable,
    ).toBeNull();
  });

  it("recognises the application codes that have a sentence of their own", () => {
    expect(
      describeClean(
        new AppError(EVERYTHING, {
          code: "INVENTORY_INCONSISTENT",
          status: 500,
        }),
      ),
    ).toMatchObject({ code: "INVENTORY_INCONSISTENT", retryable: false });
    expect(
      describeClean(
        new AppError(EVERYTHING, {
          code: "CAPTURE_NOT_APPLICABLE",
          status: 409,
        }),
      ),
    ).toMatchObject({ code: "CAPTURE_NOT_APPLICABLE", retryable: true });
    expect(describeClean(new NotFoundError(UNSAFE.email))).toMatchObject({
      code: "RECORD_NOT_FOUND",
      retryable: false,
    });
  });

  it("does not throw on an error that cannot be inspected", () => {
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(EVERYTHING);
        },
      },
    );
    expect(describeClean(hostileProxy)).toEqual(unknown);
    const throwingGetter = new AppError("m", {
      code: "NOT_FOUND",
      status: 404,
    });
    Object.defineProperty(throwingGetter, "code", {
      get() {
        throw new Error(EVERYTHING);
      },
    });
    expect(describeClean(throwingGetter)).toEqual(unknown);
  });

  it("falls back to the generic description for anything that is not an error", () => {
    for (const thrown of [
      undefined,
      null,
      0,
      12n,
      EVERYTHING,
      Symbol(UNSAFE.email),
      () => EVERYTHING,
      { message: EVERYTHING, stack: UNSAFE.path },
      [EVERYTHING],
      new Date(0),
    ]) {
      expect(describeClean(thrown)).toEqual(unknown);
    }
  });
});

describe("describeFailure: context", () => {
  it("uses the caller's fallback only when the error says nothing", () => {
    const delivery: FailureContext = {
      source: "notification",
      reference: "notification:01a1daf7-ca9c-737b-ac7e-b2054dd50aa4",
      fallback: "EMAIL_DELIVERY_FAILED",
    };
    expect(describeClean(new Error(EVERYTHING), delivery)).toEqual({
      code: "EMAIL_DELIVERY_FAILED",
      summary:
        "The email provider did not accept the message or could not be reached.",
      source: "notification",
      retryable: null,
      reference: "notification:01a1daf7-ca9c-737b-ac7e-b2054dd50aa4",
    });
    class RenderError extends Error {}
    expect(
      describeClean(new RenderError(EVERYTHING), {
        ...delivery,
        fallback: "EMAIL_RENDER_FAILED",
      }).code,
    ).toBe("EMAIL_RENDER_FAILED");
    // An error that does say something is described as what it is.
    expect(
      describeClean(
        new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
          code: "P2025",
          clientVersion: "test",
        }),
        delivery,
      ).code,
    ).toBe("DATABASE_RECORD_MISSING");
    expect(
      describeClean(
        new AppError(EVERYTHING, { code: "NOT_FOUND", status: 404 }),
        delivery,
      ).code,
    ).toBe("RECORD_NOT_FOUND");
  });

  it("keeps a reference only when it is shaped like an identifier", () => {
    const kept = [
      "order:01a1daf7-ca9c-737b-ac7e-b2054dd50aa4",
      "webhook:evt_Abc123",
      "webhook:derived:payment.captured:pay_Abc123",
      "refund:MY-P9GHP2J9-1-R1",
    ];
    for (const reference of kept) {
      expect(
        describeFailure(new Error("x"), { source: "refund", reference })
          .reference,
      ).toBe(reference);
    }
    const dropped = [
      UNSAFE.email,
      `order:${UNSAFE.script}`,
      "two words",
      "line\nbreak",
      "",
      ":leading-colon",
      "a".repeat(121),
      null,
      { toString: () => "order:1" } as unknown as string,
      42 as unknown as string,
    ];
    for (const reference of dropped) {
      const failure = describeFailure(new Error("x"), {
        source: "refund",
        reference,
      });
      expect(failure.reference).toBeNull();
      expectClean(failure);
    }
  });
});

/** An object that has been switched off: every operation on it throws. */
function revoked(target: object = {}): object {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

const refuse = (): never => {
  throw new Error(EVERYTHING);
};

/** A proxy that throws, with the forbidden text, on anything that inspects it. */
function trapped(target: object = {}): object {
  return new Proxy(target, {
    get: refuse,
    has: refuse,
    getOwnPropertyDescriptor: refuse,
    getPrototypeOf: refuse,
    ownKeys: refuse,
  });
}

function databaseError(code: string, meta: unknown) {
  return Object.assign(
    new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
      code,
      clientVersion: "test",
    }),
    { meta },
  );
}

const duplicate = {
  ...unknown,
  code: "DATABASE_UNIQUE_CONFLICT",
  summary:
    "The database refused the write because it would duplicate an existing record.",
  retryable: false,
  databaseCode: "P2002",
};

const nothingKnown = {
  code: "UNKNOWN_ERROR",
  summary: "An unexpected internal error occurred.",
  source: "unknown",
  retryable: null,
  reference: null,
};

describe("describeFailure: values that fight back", () => {
  it("a revoked proxy is unknown as the error, and unreadable anywhere inside one", () => {
    for (const thrown of [
      revoked(),
      revoked(() => EVERYTHING),
      revoked(new Error(EVERYTHING)),
      revoked(new AppError(EVERYTHING, { code: "NOT_FOUND", status: 404 })),
      revoked(
        new PaymentGatewayError(EVERYTHING, {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        }),
      ),
    ]) {
      expect(describeClean(thrown)).toEqual(unknown);
    }
    // Inside a real database error, what cannot be read is left out and the
    // rest of the error is still described.
    for (const meta of [
      revoked(),
      { driverAdapterError: revoked() },
      { driverAdapterError: { cause: revoked() } },
      { driverAdapterError: { cause: { originalCode: revoked() } } },
    ]) {
      expect(describeClean(databaseError("P2002", meta))).toEqual(duplicate);
    }
  });

  it("a revoked proxy as the context, or as any value in it, is not kept", () => {
    const asContext = describeFailure(
      new Error(EVERYTHING),
      revoked() as FailureContext,
    );
    expect(asContext).toEqual(nothingKnown);
    expectClean(asContext);
    const asValues = describeFailure(new Error(EVERYTHING), {
      source: revoked(),
      reference: revoked(),
      fallback: revoked(),
    } as unknown as FailureContext);
    expect(asValues).toEqual(nothingKnown);
    expectClean(asValues);
  });

  it("a proxy whose every trap throws", () => {
    for (const thrown of [
      trapped(),
      trapped(() => EVERYTHING),
      trapped(new AppError(EVERYTHING, { code: "NOT_FOUND", status: 404 })),
    ]) {
      expect(describeClean(thrown)).toEqual(unknown);
    }
    for (const meta of [
      trapped(),
      { driverAdapterError: trapped() },
      { driverAdapterError: { cause: trapped() } },
    ]) {
      expect(describeClean(databaseError("P2002", meta))).toEqual(duplicate);
    }
    const asContext = describeFailure(
      new Error(EVERYTHING),
      trapped() as FailureContext,
    );
    expect(asContext).toEqual(nothingKnown);
    expectClean(asContext);
  });

  it("a proxy around a real error that answers every read with the forbidden text", () => {
    const lying = new Proxy(
      new AppError("m", { code: "NOT_FOUND", status: 404 }),
      { get: () => EVERYTHING },
    );
    // It is an application error, and its code is not one on the list.
    expect(describeClean(lying)).toEqual({
      ...unknown,
      code: "APPLICATION_RULE_REFUSED",
      summary: "An application rule refused the operation.",
    });
    const lyingGateway = new Proxy(
      new PaymentGatewayError("m", {
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
      }),
      { get: () => EVERYTHING },
    );
    expect(describeClean(lyingGateway)).toEqual({
      ...unknown,
      code: "APPLICATION_RULE_REFUSED",
      summary: "An application rule refused the operation.",
    });
    const lyingDatabase = new Proxy(databaseError("P2002", undefined), {
      get: () => EVERYTHING,
    });
    expect(describeClean(lyingDatabase)).toEqual({
      ...unknown,
      code: "DATABASE_ERROR",
      summary: "The database reported an error.",
    });
  });

  it("an object that forges a known class's prototype can claim only listed values", () => {
    const refused = {
      ...unknown,
      code: "APPLICATION_RULE_REFUSED",
      summary: "An application rule refused the operation.",
    };
    const fields = {
      code: EVERYTHING,
      retryable: EVERYTHING,
      errorCode: EVERYTHING,
      message: EVERYTHING,
      meta: { driverAdapterError: { cause: { originalCode: EVERYTHING } } },
    };
    const forged = (prototype: object, own: object = fields): object =>
      Object.assign(Object.create(prototype) as object, own);
    expect(describeClean(forged(AppError.prototype))).toEqual(refused);
    expect(describeClean(forged(PaymentGatewayError.prototype))).toEqual(
      refused,
    );
    expect(
      describeClean(forged(Prisma.PrismaClientKnownRequestError.prototype)),
    ).toEqual({
      ...unknown,
      code: "DATABASE_ERROR",
      summary: "The database reported an error.",
    });
    expect(
      describeClean(forged(Prisma.PrismaClientInitializationError.prototype)),
    ).toMatchObject({ code: "DATABASE_UNAVAILABLE", retryable: true });
    // A proxy that reports a class's prototype and answers every read itself.
    const reporting = (prototype: object): object =>
      new Proxy({}, { getPrototypeOf: () => prototype, get: () => EVERYTHING });
    expect(describeClean(reporting(AppError.prototype))).toEqual(refused);
    expect(describeClean(reporting(PaymentGatewayError.prototype))).toEqual(
      refused,
    );
    // The most it can do is pick a code that is on the list.
    expect(
      describeClean(
        forged(AppError.prototype, { ...fields, code: "NOT_FOUND" }),
      ),
    ).toMatchObject({ code: "RECORD_NOT_FOUND", retryable: false });
  });

  it("Symbol.hasInstance on the thing thrown does not make it an error", () => {
    class Impostor {
      static [Symbol.hasInstance](): boolean {
        return true;
      }
      readonly code = "INVENTORY_INCONSISTENT";
      readonly retryable = true;
      readonly message = EVERYTHING;
    }
    class Thrower {
      static [Symbol.hasInstance](): never {
        throw new Error(EVERYTHING);
      }
      readonly code = "NOT_FOUND";
    }
    const claiming = Object.defineProperty(
      () => EVERYTHING,
      Symbol.hasInstance,
      { value: () => true },
    );
    for (const thrown of [
      { [Symbol.hasInstance]: () => true, code: "NOT_FOUND" },
      { [Symbol.hasInstance]: refuse, message: EVERYTHING },
      Object.assign(new Error(EVERYTHING), {
        [Symbol.hasInstance]: () => true,
        code: "INVENTORY_INCONSISTENT",
      }),
      claiming,
      Impostor,
      new Impostor(),
      Thrower,
      new Thrower(),
    ]) {
      expect(describeClean(thrown)).toEqual(unknown);
    }
  });

  it("even when instanceof is made to lie, only listed values come out", () => {
    const lookalike = {
      name: "AppError",
      code: EVERYTHING,
      retryable: EVERYTHING,
      message: EVERYTHING,
      errorCode: EVERYTHING,
      meta: { driverAdapterError: { cause: { originalCode: EVERYTHING } } },
    };
    const refused = {
      ...unknown,
      code: "APPLICATION_RULE_REFUSED",
      summary: "An application rule refused the operation.",
    };
    try {
      // Subclasses inherit it, so every application class now claims everything.
      Object.defineProperty(AppError, Symbol.hasInstance, {
        value: () => true,
        configurable: true,
      });
      expect(lookalike instanceof PaymentGatewayError).toBe(true);
      expect(describeClean(lookalike)).toEqual(refused);
      expect(describeClean(EVERYTHING)).toEqual(refused);
      expect(describeClean(() => EVERYTHING)).toEqual(refused);
      // A code and a flag that are on the lists are all that can be claimed.
      expect(
        describeClean({ ...lookalike, code: "PAYMENT_PROVIDER_REJECTED" }),
      ).toEqual({
        ...unknown,
        code: "PAYMENT_PROVIDER_REJECTED",
        summary: "The payment provider refused the request.",
      });
      // Nothing to read a field from: unknown, not a throw.
      expect(describeClean(null)).toEqual(unknown);
      expect(describeClean(undefined)).toEqual(unknown);

      Object.defineProperty(AppError, Symbol.hasInstance, {
        value: refuse,
        configurable: true,
      });
      expect(describeClean(lookalike)).toEqual(unknown);
      expect(
        describeClean(
          new AppError(EVERYTHING, { code: "NOT_FOUND", status: 404 }),
        ),
      ).toEqual(unknown);
    } finally {
      Reflect.deleteProperty(AppError, Symbol.hasInstance);
    }
    // Put back: a look-alike is unknown again and a real error is itself.
    expect(lookalike instanceof AppError).toBe(false);
    expect(describeClean(lookalike)).toEqual(unknown);
    expect(describeClean(new NotFoundError("x")).code).toBe("RECORD_NOT_FOUND");
  });

  it("reads only the fields it needs: a getter on anything else never runs", () => {
    const touched: string[] = [];
    const guard = <T extends Error>(error: T, keys: readonly string[]): T => {
      for (const key of keys) {
        Object.defineProperty(error, key, {
          configurable: true,
          get() {
            touched.push(key);
            throw new Error(EVERYTHING);
          },
        });
      }
      return error;
    };
    const text = ["message", "stack", "cause", "name", "toString", "toJSON"];
    expect(
      describeClean(
        guard(new AppError("m", { code: "NOT_FOUND", status: 404 }), [
          ...text,
          "status",
        ]),
      ),
    ).toMatchObject({ code: "RECORD_NOT_FOUND", retryable: false });
    expect(
      describeClean(
        guard(
          new PaymentGatewayError("m", {
            code: "PAYMENT_PROVIDER_UNAVAILABLE",
            retryable: true,
          }),
          [...text, "status"],
        ),
      ),
    ).toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE", retryable: true });
    expect(
      describeClean(
        guard(
          databaseError("P2002", {
            driverAdapterError: { cause: { originalCode: "23505" } },
          }),
          [...text, "clientVersion", "batchRequestIdx"],
        ),
      ),
    ).toEqual({ ...duplicate, sqlState: "23505" });
    expect(
      describeClean(
        guard(
          new Prisma.PrismaClientValidationError(EVERYTHING, {
            clientVersion: "test",
          }),
          [...text, "clientVersion"],
        ),
      ).code,
    ).toBe("DATABASE_INVALID_REQUEST");
    expect(describeClean(guard(new Error(EVERYTHING), text))).toEqual(unknown);
    expect(touched).toEqual([]);
  });

  it("a getter that throws on a field it does need is unknown, or left out", () => {
    const failing = <T extends object>(target: T, key: string): T =>
      Object.defineProperty(target, key, { enumerable: true, get: refuse });
    for (const thrown of [
      failing(
        new PaymentGatewayError("m", {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        }),
        "retryable",
      ),
      failing(
        new PaymentGatewayError("m", {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        }),
        "code",
      ),
      failing(databaseError("P2002", {}), "code"),
      failing(databaseError("P2002", {}), "meta"),
      failing(
        new Prisma.PrismaClientInitializationError(EVERYTHING, "test", "P1001"),
        "errorCode",
      ),
    ]) {
      expect(describeClean(thrown)).toEqual(unknown);
    }
    // Deeper, in what the driver attached: that one value is left out.
    for (const meta of [
      failing({}, "driverAdapterError"),
      { driverAdapterError: failing({}, "cause") },
      { driverAdapterError: { cause: failing({}, "originalCode") } },
    ]) {
      expect(describeClean(databaseError("P2002", meta))).toEqual(duplicate);
      expect(describeClean(databaseError("P2010", meta))).toEqual({
        ...unknown,
        code: "DATABASE_ERROR",
        summary: "The database reported an error.",
        databaseCode: "P2010",
      });
    }
  });

  it("reads each field once, so a value that changes between reads cannot pass a check and then differ", () => {
    // Valid for the first one, two or three reads, then the forbidden text.
    for (const validReads of [1, 2, 3]) {
      const reads = { code: 0, state: 0, gateway: 0, flag: 0 };
      const application = new AppError("m", { code: "NOT_FOUND", status: 404 });
      Object.defineProperty(application, "code", {
        get() {
          reads.code += 1;
          return reads.code <= validReads ? "NOT_FOUND" : EVERYTHING;
        },
      });
      expect(describeClean(application).code).toBe("RECORD_NOT_FOUND");

      const cause = Object.defineProperty({}, "originalCode", {
        enumerable: true,
        get() {
          reads.state += 1;
          return reads.state <= validReads ? "23505" : EVERYTHING;
        },
      });
      expect(
        describeClean(
          databaseError("P2010", { driverAdapterError: { cause } }),
        ),
      ).toEqual({
        ...unknown,
        code: "DATABASE_UNIQUE_CONFLICT",
        summary:
          "The database refused the write because it would duplicate an existing record.",
        retryable: false,
        databaseCode: "P2010",
        sqlState: "23505",
      });

      const provider = new PaymentGatewayError("m", {
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
      });
      Object.defineProperty(provider, "code", {
        get() {
          reads.gateway += 1;
          return reads.gateway <= validReads
            ? "PAYMENT_PROVIDER_REJECTED"
            : EVERYTHING;
        },
      });
      Object.defineProperty(provider, "retryable", {
        get() {
          reads.flag += 1;
          return reads.flag <= validReads ? false : EVERYTHING;
        },
      });
      expect(describeClean(provider)).toMatchObject({
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
      });
      expect(reads).toEqual({ code: 1, state: 1, gateway: 1, flag: 1 });
    }
  });

  it("never turns a value into text: no toString, valueOf or Symbol.toPrimitive runs", () => {
    const coerced = vi.fn(() => "NOT_FOUND");
    const coercible = () => ({
      toString: coerced,
      valueOf: coerced,
      toJSON: coerced,
      [Symbol.toPrimitive]: coerced,
    });
    const errors = [
      Object.assign(new AppError("m", { code: "NOT_FOUND", status: 404 }), {
        code: coercible(),
      }),
      Object.assign(
        new PaymentGatewayError("m", {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        }),
        { code: coercible(), retryable: coercible() },
      ),
      Object.assign(databaseError("P2002", coercible()), {
        code: coercible(),
      }),
      databaseError("P2010", {
        driverAdapterError: { cause: { originalCode: coercible() } },
      }),
      Object.assign(
        new Prisma.PrismaClientInitializationError("m", "test", "P1001"),
        { errorCode: coercible() },
      ),
      coercible(),
    ];
    for (const error of errors) {
      const failure = describeFailure(error, {
        source: coercible(),
        reference: coercible(),
        fallback: coercible(),
      } as unknown as FailureContext);
      expect(failure.source).toBe("unknown");
      expect(failure.reference).toBeNull();
      expect(failure).not.toHaveProperty("sqlState");
      formatFailure(failure);
    }
    expect(
      formatFailure({
        code: coercible(),
        databaseCode: coercible(),
        sqlState: coercible(),
      } as unknown as SafeFailure),
    ).toBe(UNKNOWN_LINE);
    expect(coerced).not.toHaveBeenCalled();
  });
});

describe("describeFailure: what the caller passes is checked like everything else", () => {
  it("keeps a source only when it is one of the four", () => {
    for (const source of SOURCES) {
      expect(
        describeClean(new Error(EVERYTHING), { source, reference: null })
          .source,
      ).toBe(source);
    }
    const coerced = vi.fn(() => "refund");
    const invalid: unknown[] = [
      EVERYTHING,
      UNSAFE.email,
      UNSAFE.script,
      "Refund",
      "REFUND",
      "refund ",
      " refund",
      "refund\n",
      "refund\u0000",
      "refunds",
      "",
      "constructor",
      "__proto__",
      "toString",
      0,
      1,
      true,
      null,
      undefined,
      Symbol("refund"),
      ["refund"],
      { toString: coerced, valueOf: coerced, [Symbol.toPrimitive]: coerced },
      new String("refund"),
      () => "refund",
    ];
    for (const source of invalid) {
      const failure = describeFailure(new Error(EVERYTHING), {
        source,
        reference: "refund:MY-TEST0001-1-R1",
      } as unknown as FailureContext);
      expect(failure).toEqual({ ...unknown, source: "unknown" });
      expectClean(failure);
    }
    // A context with no source at all.
    expect(
      describeFailure(new Error("x"), {
        reference: "refund:MY-TEST0001-1-R1",
      } as unknown as FailureContext),
    ).toEqual({ ...unknown, source: "unknown" });
    expect(coerced).not.toHaveBeenCalled();
  });

  it("accepts a fallback code only when it is one a caller may suggest", () => {
    for (const fallback of [
      "EMAIL_RENDER_FAILED",
      "EMAIL_DELIVERY_FAILED",
    ] as const) {
      expect(
        describeClean(new Error(EVERYTHING), { ...context, fallback }),
      ).toEqual({
        ...unknown,
        code: fallback,
        summary: FAILURE_SUMMARIES[fallback],
      });
    }
    const coerced = vi.fn(() => "EMAIL_RENDER_FAILED");
    const invalid: unknown[] = [
      EVERYTHING,
      UNSAFE.email,
      UNSAFE.script,
      // Real codes, but not ones a caller may put forward.
      "PAYMENT_PROVIDER_REJECTED",
      "DATABASE_ERROR",
      "INVENTORY_INCONSISTENT",
      "RECORD_NOT_FOUND",
      "email_render_failed",
      "EMAIL_RENDER_FAILED ",
      "EMAIL_RENDER_FAILED\n",
      "",
      // Names every object answers to.
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
      0,
      true,
      null,
      Symbol("EMAIL_RENDER_FAILED"),
      ["EMAIL_RENDER_FAILED"],
      { toString: coerced, valueOf: coerced, [Symbol.toPrimitive]: coerced },
      new String("EMAIL_RENDER_FAILED"),
    ];
    for (const fallback of invalid) {
      const failure = describeFailure(new Error(EVERYTHING), {
        ...context,
        fallback,
      } as unknown as FailureContext);
      expect(failure).toEqual(unknown);
      expect(typeof failure.summary).toBe("string");
      expectClean(failure);
    }
    expect(coerced).not.toHaveBeenCalled();
  });

  it("an invalid fallback never replaces what the error itself says", () => {
    expect(
      describeClean(new NotFoundError("x"), {
        ...context,
        fallback: EVERYTHING,
      } as unknown as FailureContext),
    ).toMatchObject({ code: "RECORD_NOT_FOUND", source: "refund" });
  });

  it("reads each context value once, and survives a context that cannot be read", () => {
    for (const validReads of [1, 2, 3]) {
      const reads = { source: 0, reference: 0, fallback: 0 };
      const shifting = {
        get source() {
          reads.source += 1;
          return reads.source <= validReads ? "notification" : EVERYTHING;
        },
        get reference() {
          reads.reference += 1;
          return reads.reference <= validReads ? "notification:N1" : EVERYTHING;
        },
        get fallback() {
          reads.fallback += 1;
          return reads.fallback <= validReads
            ? "EMAIL_DELIVERY_FAILED"
            : EVERYTHING;
        },
      };
      const failure = describeFailure(
        new Error(EVERYTHING),
        shifting as FailureContext,
      );
      expect(failure).toEqual({
        code: "EMAIL_DELIVERY_FAILED",
        summary:
          "The email provider did not accept the message or could not be reached.",
        source: "notification",
        retryable: null,
        reference: "notification:N1",
      });
      expectClean(failure);
      expect(reads).toEqual({ source: 1, reference: 1, fallback: 1 });
    }
    const throwing = {
      get source(): never {
        return refuse();
      },
      get reference(): never {
        return refuse();
      },
      get fallback(): never {
        return refuse();
      },
    };
    expect(
      describeFailure(new Error(EVERYTHING), throwing as FailureContext),
    ).toEqual(nothingKnown);
    for (const notAContext of [null, undefined, EVERYTHING, 7, () => context]) {
      const failure = describeFailure(
        new Error(EVERYTHING),
        notAContext as unknown as FailureContext,
      );
      expect(failure).toEqual(nothingKnown);
      expectClean(failure);
    }
    // A real error is still described when the context is useless.
    expect(
      describeFailure(new NotFoundError("x"), trapped() as FailureContext),
    ).toEqual({
      ...nothingKnown,
      code: "RECORD_NOT_FOUND",
      summary: "A record the operation needed was not found.",
      retryable: false,
    });
  });
});

describe("formatFailure", () => {
  it("writes the code, its fixed sentence and the checked database codes", () => {
    expect(formatFailure(describeFailure(new Error(EVERYTHING), context))).toBe(
      "UNKNOWN_ERROR: An unexpected internal error occurred.",
    );
    expect(
      formatFailure(
        describeFailure(
          new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
            code: "P2002",
            clientVersion: "test",
            meta: { driverAdapterError: { cause: { originalCode: "23505" } } },
          }),
          context,
        ),
      ),
    ).toBe(
      "DATABASE_UNIQUE_CONFLICT: The database refused the write because it would duplicate an existing record. [P2002 23505]",
    );
  });

  it("looks the sentence up again, so a tampered object still writes the fixed one", () => {
    const tampered = {
      ...describeFailure(new Error("x"), context),
      summary: EVERYTHING,
      databaseCode: EVERYTHING,
      sqlState: UNSAFE.email,
    };
    const line = formatFailure(tampered);
    expect(line).toBe("UNKNOWN_ERROR: An unexpected internal error occurred.");
    for (const forbidden of FORBIDDEN) expect(line).not.toContain(forbidden);
    const forgedCode = {
      ...tampered,
      code: EVERYTHING,
    } as unknown as SafeFailure;
    expect(formatFailure(forgedCode)).toBe(
      "UNKNOWN_ERROR: An unexpected internal error occurred.",
    );
  });

  it("reads the code once, so a code that changes after the check is not written", () => {
    const base = describeFailure(new Error("x"), context);
    // Valid for the first one, two or three reads, then the forbidden text.
    for (const validReads of [1, 2, 3]) {
      const reads = { code: 0, databaseCode: 0, sqlState: 0 };
      const shifting = {
        ...base,
        get code() {
          reads.code += 1;
          return reads.code <= validReads ? "DATABASE_ERROR" : EVERYTHING;
        },
        get databaseCode() {
          reads.databaseCode += 1;
          return reads.databaseCode <= validReads ? "P2010" : EVERYTHING;
        },
        get sqlState() {
          reads.sqlState += 1;
          return reads.sqlState <= validReads ? "23514" : EVERYTHING;
        },
      };
      const line = formatFailure(shifting as SafeFailure);
      expect(line).toBe(
        "DATABASE_ERROR: The database reported an error. [P2010 23514]",
      );
      for (const forbidden of FORBIDDEN) expect(line).not.toContain(forbidden);
      expect(reads).toEqual({ code: 1, databaseCode: 1, sqlState: 1 });
    }
  });

  it("takes a code only as a primitive string on the list, and never coerces one", () => {
    const base = describeFailure(new Error("x"), context);
    const coerced = vi.fn(() => "DATABASE_ERROR");
    const notCodes: unknown[] = [
      { toString: coerced },
      { valueOf: coerced, [Symbol.toPrimitive]: coerced },
      // Each of these would name a real code if it were turned into text.
      ["DATABASE_ERROR"],
      new String("DATABASE_ERROR"),
      Object.assign(() => EVERYTHING, { toString: coerced }),
      Symbol("DATABASE_ERROR"),
      7,
      true,
      null,
      undefined,
      "database_error",
      "DATABASE_ERROR ",
      "DATABASE_ERROR\n",
      "",
      // Names every object answers to.
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      EVERYTHING,
      UNSAFE.script,
    ];
    for (const code of notCodes) {
      const line = formatFailure({ ...base, code } as unknown as SafeFailure);
      expect(line).toBe(UNKNOWN_LINE);
    }
    // The codes beside it are held to their patterns in the same way.
    for (const value of [
      { toString: coerced },
      ["P2002"],
      new String("P2002"),
      "P2002\n",
      "p2002",
      EVERYTHING,
    ]) {
      expect(
        formatFailure({
          ...base,
          code: "DATABASE_ERROR",
          databaseCode: value,
          sqlState: value,
        } as unknown as SafeFailure),
      ).toBe("DATABASE_ERROR: The database reported an error.");
    }
    expect(coerced).not.toHaveBeenCalled();
    // Every listed code is still written as itself.
    for (const code of Object.keys(FAILURE_SUMMARIES)) {
      expect(formatFailure({ ...base, code } as SafeFailure)).toBe(
        `${code}: ${FAILURE_SUMMARIES[code as keyof typeof FAILURE_SUMMARIES]}`,
      );
    }
  });

  it("does not throw on an object that cannot be read, or on something that is not an object", () => {
    const throwing = {
      get code(): never {
        return refuse();
      },
      get databaseCode(): never {
        return refuse();
      },
      get sqlState(): never {
        return refuse();
      },
    };
    const unreadable: unknown[] = [
      throwing,
      revoked(),
      revoked(() => EVERYTHING),
      trapped(),
      trapped(describeFailure(new Error("x"), context)),
      new Proxy({}, { get: () => EVERYTHING, has: () => true }),
      // A real description, but inherited rather than the object's own.
      Object.create(describeFailure(new NotFoundError("x"), context)) as object,
      null,
      undefined,
      EVERYTHING,
      7,
      () => EVERYTHING,
    ];
    for (const value of unreadable) {
      expect(formatFailure(value as SafeFailure)).toBe(UNKNOWN_LINE);
    }
    // One unreadable field does not cost the others.
    const partly = {
      code: "DATABASE_UNIQUE_CONFLICT",
      databaseCode: "P2002",
      get sqlState(): never {
        return refuse();
      },
    };
    expect(formatFailure(partly as unknown as SafeFailure)).toBe(
      "DATABASE_UNIQUE_CONFLICT: The database refused the write because it would duplicate an existing record. [P2002]",
    );
  });

  it("every sentence is fixed text on one line", () => {
    for (const [code, summary] of Object.entries(FAILURE_SUMMARIES)) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(summary).toMatch(/^[A-Z][A-Za-z' ,-]+\.$/);
    }
  });
});

describe("operations alert producers", () => {
  const SRC = join(process.cwd(), "src");
  const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        !file.startsWith("generated"),
    )
    .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));

  it("no module that raises an operations alert uses the raw error describer", () => {
    const producers = sources.filter(({ text }) =>
      text.includes("enqueueOpsAlert("),
    );
    // The four that record an exception, the definition, and the rest.
    expect(producers.length).toBeGreaterThanOrEqual(10);
    for (const { file, text } of producers) {
      expect(text, file).not.toContain("describeError");
    }
  });

  it("the four producers that record an exception describe it through this module", () => {
    for (const file of [
      "features/payments/expiry.ts",
      "features/payments/webhook.ts",
      "server/jobs/refund-payments.ts",
      "server/jobs/send-notifications.ts",
    ]) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      expect(text, file).toContain('from "@/server/safe-failure"');
      expect(text, file).toContain("describeFailure(");
      // Reading `error.message` or `error.stack`; `...message` is a spread.
      expect(text, file).not.toMatch(
        /(?<!\.)\.message\b|\.stack\b|String\(error\)/,
      );
    }
  });

  it("a retry is decided from the original error, before and apart from its description", () => {
    for (const file of [
      "features/payments/expiry.ts",
      "features/payments/webhook.ts",
      "server/jobs/refund-payments.ts",
      "server/jobs/send-notifications.ts",
    ]) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      // The description's own view of retrying is recorded, never acted on.
      expect(text, file).not.toMatch(/failure\??\.\s*retryable/);
      expect(text, file).not.toMatch(/decideRetry\([^)]*failure/);
    }
    // The three that schedule retries decide first and describe afterwards.
    for (const file of [
      "features/payments/webhook.ts",
      "server/jobs/refund-payments.ts",
      "server/jobs/send-notifications.ts",
    ]) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      const decided = text.indexOf("decideRetry(");
      const described = text.indexOf("describeFailure(");
      expect(decided, file).toBeGreaterThan(-1);
      expect(described, file).toBeGreaterThan(decided);
    }
  });

  it("the raw describer is left in exactly the three places that await a later batch", () => {
    // Each still writes an exception's own message: to `payments.last_error`
    // and the note of the `payment.provider_order_failed` / `_retry` order
    // event (features/payments/service.ts), to
    // `product_image_uploads.sweep_error` (sweep-uploads.ts) and to
    // `customer_uploads.sweep_error` (sweep-customer-uploads.ts). A caller
    // added or removed has to be accounted for here.
    const callers = sources
      .filter(
        ({ file, text }) =>
          file !== "server/jobs/queue.ts" && text.includes("describeError"),
      )
      .map(({ file }) => file)
      .sort();
    expect(callers).toEqual([
      "features/payments/service.ts",
      "server/jobs/sweep-customer-uploads.ts",
      "server/jobs/sweep-uploads.ts",
    ]);
  });
});
