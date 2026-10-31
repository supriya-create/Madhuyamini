import { resolveTestDatabaseUrl } from "./test-database";

// Runs before each test file is imported, so `@/server/env` (parsed on import)
// sees the test database rather than the developer's database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SITE_ENV = "development";
