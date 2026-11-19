export function parseStrictInteger(value: unknown): number | undefined {
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    value.length > 10
  ) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
