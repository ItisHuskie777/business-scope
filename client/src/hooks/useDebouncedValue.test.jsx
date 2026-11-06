// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useDebouncedValue from "./useDebouncedValue.js";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("only reports the value once it has been stable for the delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "s" },
    });
    expect(result.current).toBe("s");

    rerender({ value: "st" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "sta" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("s");   // still typing

    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe("sta");
  });
});
