-- Runtime database role (docs/admin.md §13, decision A13).
-- Run as the table owner before `prisma migrate deploy`; migration 7 grants
-- privileges to this role when it exists. Locally it is NOLOGIN: the owner
-- connection is kept for development and `SET ROLE madhuyamini_app` is used
-- by the privilege tests. Hosted environments create it with LOGIN and a
-- password and point DATABASE_URL at it (Phase 11).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madhuyamini_app') THEN
    CREATE ROLE madhuyamini_app NOLOGIN;
  END IF;
END
$$;
-- Lets the owner switch to the role (SET ROLE) to prove what it cannot do.
GRANT madhuyamini_app TO CURRENT_USER;
