import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/server/auth/auth";

/**
 * Better Auth HTTP handler. Only the paths listed in auth.ts are served;
 * everything else answers 404 and is reached through Server Actions instead.
 */
export const { GET, POST } = toNextJsHandler(auth);
