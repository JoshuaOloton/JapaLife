/**
 * Writes JSON the way the hand-made content files look: nested objects
 * indented, but each building, prop or point on one line, so a generated city
 * file of thousands of things still diffs line by line.
 */
export function formatJson(value: unknown): string {
  return `${block(value, "")}\n`;
}

/** Objects and arrays this short (once on one line) stay on one line. */
const INLINE_LIMIT = 160;

function block(value: unknown, indent: string): string {
  const flat = inline(value);
  if (flat.length + indent.length <= INLINE_LIMIT || value === null || typeof value !== "object") return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${block(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${block(item, inner)}`).join(",\n")}\n${indent}}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(inline).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return entries.length === 0 ? "{}" : `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}
