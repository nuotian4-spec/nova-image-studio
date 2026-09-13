import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadImageMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/image-storage", async () => {
  const actual = await vi.importActual<typeof import("../lib/image-storage")>("../lib/image-storage");
  return {
    ...actual,
    uploadImage: uploadImageMock,
  };
});

import { CanvasEditor } from "../CanvasEditor";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";

const project: CanvasProject = {
  id: "upload-project",
  title: "Upload",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  nodes: [
    {
      id: "image-1",
      type: CanvasNodeType.Image,
      title: "图片",
      position: { x: 40, y: 40 },
      width: 320,
      height: 240,
    },
  ],
  connections: [],
  backgroundMode: "lines",
  showImageInfo: false,
  viewport: { x: 0, y: 0, k: 1 },
};

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("CanvasEditor 上传走 File 直传", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useCanvasStore.setState({ hydrated: true, projects: [structuredClone(project)] });
    uploadImageMock.mockReset().mockResolvedValue({
      url: "blob:mock",
      storageKey: "image:mock",
      width: 8,
      height: 8,
      bytes: 4,
      mimeType: "image/png",
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("工具栏选图时把 File 交给 uploadImage，不先转 data URL", async () => {
    render(
      <CanvasEditor
        projectId={project.id}
        onBack={() => undefined}
        onRequireApiKey={() => undefined}
        showToast={() => undefined}
      />,
    );

    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"][accept="image/*"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadImageMock).toHaveBeenCalledTimes(1);
    });
    expect(uploadImageMock).toHaveBeenCalledWith(file);
    expect(uploadImageMock.mock.calls[0][0]).toBeInstanceOf(File);
  });
});
