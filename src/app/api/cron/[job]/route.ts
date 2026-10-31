import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { isJobName, runJob } from "@/server/jobs";

/**
 * Scheduled job endpoints (vercel.json). The only credential is the bearer
 * secret Vercel Cron sends as CRON_SECRET; without it the routes are closed.
 * Jobs are idempotent and lease-based, so overlapping invocations are safe.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(
  request: Request,
  context: { params: Promise<{ job: string }> },
): Promise<Response> {
  if (!env.cronSecret) {
    return NextResponse.json(
      { error: "cron is not configured" },
      { status: 503 },
    );
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const { job } = await context.params;
  if (!isJobName(job)) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  try {
    const summary = await runJob(job);
    return NextResponse.json({ job, ...summary });
  } catch (error) {
    console.error(`[cron] ${job} failed`, {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
