import "server-only";

import { parseEnv } from "./env-schema";

/** Validated server configuration. Parsed once, on first import, so misconfiguration fails fast. */
export const env = parseEnv(process.env);

export const isProduction = env.siteEnv === "production";
