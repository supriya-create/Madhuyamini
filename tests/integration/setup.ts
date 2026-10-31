import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveTestDatabaseUrl } from "./test-database";

// Runs before each test file is imported, so `@/server/env` (parsed on import)
// sees the test database and test-safe settings rather than the developer's.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SITE_ENV = "development";
process.env.SITE_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-at-least-32-chars";
process.env.EMAIL_TRANSPORT = "file";
process.env.EMAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "madhuyamini-mail-"));
process.env.PASSWORD_BREACH_CHECK = "off";
