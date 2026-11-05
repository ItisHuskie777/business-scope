import { describe, expect, test } from "vitest";
import { clampNumber, isValidState, isValidZip } from "./validation.js";

// These mirror the server's rules (server/routes_optimized.js); if one side
// changes, the UI would start sending requests the API rejects.

describe("isValidZip", () => {
  test("accepts exactly five digits", () => {
    expect(isValidZip("19104")).toBe(true);
    expect(isValidZip("00501")).toBe(true);
  });

  test("rejects other lengths, letters, ZIP+4 and non-strings", () => {
    for (const value of ["1910", "191045", "1910a", "19104-1234", "", " 19104", null, undefined, 19104]) {
      expect(isValidZip(value)).toBe(false);
    }
  });
});

describe("isValidState", () => {
  test("accepts two letters in either case", () => {
    expect(isValidState("PA")).toBe(true);
    expect(isValidState("pa")).toBe(true);
  });

  test("rejects names, digits and non-strings", () => {
    for (const value of ["Pennsylvania", "P", "P1", "", null, undefined, 42]) {
      expect(isValidState(value)).toBe(false);
    }
  });
});

describe("clampNumber", () => {
  test("keeps a value that is in range", () => {
    expect(clampNumber("3.5", 0, 0, 5)).toBe(3.5);
  });

  test("clamps to the bounds", () => {
    expect(clampNumber("9", 0, 0, 5)).toBe(5);
    expect(clampNumber(-2, 0, 0, 5)).toBe(0);
  });

  test("falls back when the input is not a number", () => {
    expect(clampNumber("abc", 4, 0, 5)).toBe(4);
    expect(clampNumber(undefined, 4, 0, 5)).toBe(4);
  });
});
