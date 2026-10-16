import { Prisma } from "@japalife/db";
import { describe, expect, it } from "vitest";
import { describeError } from "./log";

describe("describeError", () => {
  it("keeps only the class and code of a Prisma error, never its message", () => {
    const error = new Prisma.PrismaClientKnownRequestError("data: { reference: 'shift:secret', amount: 500000n }", {
      code: "P2002",
      clientVersion: "test",
    });
    expect(describeError(error)).toBe("PrismaClientKnownRequestError P2002");
  });

  it("drops the message of any other Prisma error, which can echo the query", () => {
    const error = new Prisma.PrismaClientValidationError("Invalid invocation: { playerId: 'someone' }", {
      clientVersion: "test",
    });
    expect(describeError(error)).toBe("PrismaClientValidationError");
  });

  it("keeps the first line of other errors, truncated", () => {
    expect(describeError(new Error(`wallet not found\n${"stack ".repeat(10)}`))).toBe("Error: wallet not found");
    expect(describeError(new TypeError("x".repeat(500)))).toBe(`TypeError: ${"x".repeat(200)}`);
  });

  it("does not print values that are not errors", () => {
    expect(describeError({ token: "abc" })).toBe("non-Error value thrown");
  });
});
