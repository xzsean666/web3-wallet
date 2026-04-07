import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

async function loadSystem() {
  vi.resetModules();
  return import("../system");
}

describe("system service", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
  });

  it("returns a local preview overview outside Tauri", async () => {
    const system = await loadSystem();

    await expect(system.getAppOverview()).resolves.toMatchObject({
      appName: "Web3 Wallet",
      appVersion: "preview",
      runtime: "Browser preview (no Tauri IPC)",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads the overview via invoke inside Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      appName: "Web3 Wallet",
      appVersion: "0.1.0",
      runtime: "Tauri",
      securityPolicy: "policy",
      storageStrategy: "storage",
    });
    const system = await loadSystem();

    await expect(system.getAppOverview()).resolves.toMatchObject({
      appVersion: "0.1.0",
      runtime: "Tauri",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_app_overview");
  });
});
