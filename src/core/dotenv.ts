/**
 * Serialize a flat map to dotenv text. A value is written bare when it is safe
 * to (only unambiguous characters); otherwise it is double-quoted with escapes.
 * Keys are emitted in the order given — callers sort first for deterministic
 * output (which also keeps generated files diff-stable).
 */
export function serializeDotenv(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(
    ([key, value]) => `${key}=${quote(value)}`
  );
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function quote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_.@/:+=-]+$/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}
