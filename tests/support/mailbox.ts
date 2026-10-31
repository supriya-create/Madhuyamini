import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface CapturedEmail {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly sentAt: string;
}

/** Reads messages written by the file email transport, newest first. */
export async function readMailbox(
  directory: string,
  to?: string,
): Promise<CapturedEmail[]> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return [];
  }
  const messages: CapturedEmail[] = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const parsed: unknown = JSON.parse(
      await readFile(join(directory, file), "utf8"),
    );
    if (
      parsed &&
      typeof parsed === "object" &&
      "to" in parsed &&
      "subject" in parsed
    ) {
      messages.push(parsed as CapturedEmail);
    }
  }
  const filtered = to
    ? messages.filter((m) => m.to.toLowerCase() === to.toLowerCase())
    : messages;
  return filtered.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

/** Waits briefly for a message to arrive (the transport writes asynchronously). */
export async function waitForEmail(
  directory: string,
  to: string,
  subjectPattern: RegExp,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = (await readMailbox(directory, to)).find((m) =>
      subjectPattern.test(m.subject),
    );
    if (match) return match;
    if (Date.now() > deadline)
      throw new Error(`No email to ${to} matching ${subjectPattern}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** First http(s) link in the text body. */
export function firstLink(message: CapturedEmail): string {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error(`No link in email "${message.subject}"`);
  return match[0];
}
