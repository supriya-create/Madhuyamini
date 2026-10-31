# Integration tests

These run against a real PostgreSQL database and truncate every table between tests.

- The URL comes from `TEST_DATABASE_URL` (default `postgresql://localhost:5432/madhuyamini_test`) and **must** name a database ending in `_test`.
- Migrations are applied once per run by `global-setup.ts`.
- Run with `npm run test:integration`. `npm test` runs only the unit project.
