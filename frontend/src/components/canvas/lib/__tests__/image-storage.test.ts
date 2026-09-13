import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, Blob>();

vi.mock("localforage", () => ({
  default: {
    createInstance: () => ({
      setItem: async (key: string, value: Blob) => {
        memory.set(key, value);
        return value;
      },
      getItem: async (key: string) => memory.get(key) ?? null,
      removeItem: async (key: string) => {
        memory.delete(key);
      },
      iterate: async () => undefined,
    }),
  },
}));

import { getImageBlob, uploadImage } from "../image-storage";

/** 1×1 PNG，用于验证 data URL → Blob 不依赖 fetch。 */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    this.naturalWidth = 1;
    this.naturalHeight = 1;
    queueMicrotask(() => this.onload?.());
  }
}

describe("uploadImage 避开 CSP 对 data: 的 fetch 拦截", () => {
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).startsWith("data:")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.reject(new Error(`unexpected fetch: ${String(input)}`));
      }),
    );
    vi.stubGlobal("Image", FakeImage);
    if (typeof URL.createObjectURL !== "function") {
      URL.createObjectURL = vi.fn(() => "blob:mock-image");
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mock fetch 对 data: 抛错时仍写入 IndexedDB 并返回宽高", async () => {
    const result = await uploadImage(PNG_1X1);

    expect(fetch).not.toHaveBeenCalled();
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.storageKey).toMatch(/^image:/);
    expect(result.url).toMatch(/^blob:/);

    const stored = await getImageBlob(result.storageKey);
    expect(stored).toBeInstanceOf(Blob);
    expect(stored?.type).toBe("image/png");
    expect(stored?.size).toBe(result.bytes);
  });

  it("Blob 输入不走 fetch，原样写入 IndexedDB", async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const result = await uploadImage(blob);

    expect(fetch).not.toHaveBeenCalled();
    expect(result.bytes).toBe(4);
    expect(result.mimeType).toBe("image/png");
    await expect(getImageBlob(result.storageKey)).resolves.toBe(blob);
  });
});
