import { describe, expect, it } from "vitest";
import { formatActivityStatus, formatDateTime, formatRelativeTime, formatTokenAmount } from "../format";

describe("format helpers", () => {
  it("formats token amounts with grouping and truncated decimals", () => {
    expect(formatTokenAmount("1234567.123456789")).toBe("1,234,567.123456");
    expect(formatTokenAmount("0.100000")).toBe("0.1");
    expect(formatTokenAmount("1000")).toBe("1,000");
  });

  it("returns stable fallbacks for missing or invalid date values", () => {
    expect(formatDateTime(null)).toBe("N/A");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("formats relative time labels for recent activity", () => {
    const now = new Date("2026-04-02T12:00:00.000Z").getTime();

    expect(formatRelativeTime("2026-04-02T11:59:40.000Z", now)).toBe("刚刚");
    expect(formatRelativeTime("2026-04-02T11:55:00.000Z", now)).toBe("5 分钟前");
    expect(formatRelativeTime("2026-04-02T09:00:00.000Z", now)).toBe("3 小时前");
    expect(formatRelativeTime("2026-03-31T12:00:00.000Z", now)).toBe("2 天前");
  });

  it("formats activity statuses into readable labels", () => {
    expect(formatActivityStatus("pending")).toBe("Pending");
    expect(formatActivityStatus("complete")).toBe("Confirmed");
    expect(formatActivityStatus("reverted")).toBe("Reverted");
  });
});
