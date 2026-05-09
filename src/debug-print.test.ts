import { describe, expect, it, vi } from "vitest";
import { debugPrint } from "./debug-print";

describe("debugPrint", () => {
  it("prints with default DEBUG title", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    debugPrint("hello world");

    expect(spy.mock.calls).toMatchSnapshot();

    spy.mockRestore();
  });

  it("prints with custom title", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    debugPrint("some body text", "MY TITLE");

    expect(spy.mock.calls).toMatchSnapshot();

    spy.mockRestore();
  });
});
