import en from "../../../content/copy/en.json";
import type { Copy } from "./copy";

/**
 * The English copy and the placeholder filler, with no zod and no schemas:
 * the welcome screen imports this (`@japalife/shared/copy`) before the game
 * downloads, so it must stay tiny. The schema (`copySchema`) is checked at
 * server boot and in tests, not in the browser.
 */
export const COPY: Copy = en;

/** Fills `{name}` placeholders. Unknown names are left as they are, so a mistake is visible, not blank. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
