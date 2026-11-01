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
// Owner notifications and operations alerts go to this inbox in tests.
process.env.ORDER_NOTIFY_EMAIL = "owner@example.com";
process.env.CRON_SECRET = "integration-cron-secret-value";
// Throwaway TOTP key for the staff second-factor tests (32 zero-free bytes, base64url).
process.env.ADMIN_TOTP_KEY ??= "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
// Throwaway Cloudinary values: signatures are computed locally; nothing is uploaded.
process.env.CLOUDINARY_CLOUD_NAME ??= "test-cloud";
process.env.CLOUDINARY_API_KEY ??= "123456789012345";
process.env.CLOUDINARY_API_SECRET ??= "integration-test-cloudinary-secret";
