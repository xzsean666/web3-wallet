import { describe, expect, it } from "vitest";
import { computeFocusScrollDelta, measureKeyboardInset } from "../mobileViewport";

describe("mobileViewport", () => {
  it("returns zero when the viewport is not reduced by the keyboard", () => {
    expect(measureKeyboardInset(839, 839, 0)).toBe(0);
    expect(measureKeyboardInset(839, 900, 0)).toBe(0);
  });

  it("measures keyboard overlap from the stable and current viewport heights", () => {
    expect(measureKeyboardInset(839, 523, 0)).toBe(316);
    expect(measureKeyboardInset(839, 523, 12)).toBe(304);
    expect(measureKeyboardInset(839, 523, 0, 316)).toBe(0);
  });

  it("only scrolls by the minimum distance needed to reveal the focused field", () => {
    expect(computeFocusScrollDelta(120, 180, 0, 500, 0)).toBe(0);
    expect(computeFocusScrollDelta(420, 540, 0, 500, 0)).toBe(64);
    expect(computeFocusScrollDelta(12, 70, 0, 500, 16)).toBe(-16);
  });
});
