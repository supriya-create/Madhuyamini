/** Display form of a recovery code (pure; shared by server and client). */
export function formatRecoveryCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}
