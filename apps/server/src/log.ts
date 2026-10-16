import { Prisma } from "@japalife/db";

const MAX_MESSAGE_LENGTH = 200;

/**
 * A one-line description of an error that is safe to write to the logs.
 * Prisma messages can echo the query and its arguments (player ids, amounts,
 * references), so for those only the error class and code are kept. Other
 * messages keep their first line, truncated, never stacks of request data.
 * CLAUDE.md: never log passwords, tokens or payment details.
 */
export function describeError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `${error.name} ${error.code}`;
  if (!(error instanceof Error)) return "non-Error value thrown";
  if (error.name.startsWith("Prisma")) return error.name;
  const firstLine = error.message.split("\n", 1)[0] ?? "";
  return `${error.name}: ${firstLine.slice(0, MAX_MESSAGE_LENGTH)}`;
}

/** Logs a failure with its context, through `describeError`. Use this, not console.error(error). */
export function logError(context: string, error: unknown): void {
  console.error(`${context}: ${describeError(error)}`);
}
