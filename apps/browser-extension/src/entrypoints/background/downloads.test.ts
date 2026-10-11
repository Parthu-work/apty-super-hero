import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadChatImagesInBackground } from "./downloads";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";
const download = vi.fn();

function chat(...images: Array<{ imageData: string; imageTitle?: string }>) {
  return [
    { id: "m1", parts: [{ type: "text" }] },
    { id: "m2", parts: images.map((image) => ({ type: "image", ...image })) },
    { id: "m3" },
  ];
}

beforeEach(() => {
  let id = 0;
  download.mockReset().mockImplementation(async () => ++id);
  vi.stubGlobal("chrome", { downloads: { download } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadChatImagesInBackground", () => {
  it.each([
    ["../outside", "folderPrefix contains forbidden traversal pattern: .."],
    ["a/%2E%2E/b", "folderPrefix contains forbidden traversal pattern: %2e%2e"],
    ["a\\b", "folderPrefix must not contain backslashes"],
    ["/etc", "folderPrefix must not have leading or trailing slashes"],
    ["shots/", "folderPrefix must not have leading or trailing slashes"],
    ["a//b", "folderPrefix contains empty path segments"],
  ])("refuses the folder %j before downloading anything", async (folderPrefix, error) => {
    const result = await downloadChatImagesInBackground(
      chat({ imageData: PNG }),
      folderPrefix,
    );
    expect(result).toEqual({ success: false, errors: [error] });
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a traversal in any image name", async () => {
    const result = await downloadChatImagesInBackground(
      chat({ imageData: PNG }, { imageData: PNG }),
      "shots",
      ["ok", "..%2fsecret"],
    );
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatch(/^imageNames\[1\] contains forbidden/);
    expect(download).not.toHaveBeenCalled();
  });

  it("saves only data:image URLs, under the folder, with the given names stripped to safe characters", async () => {
    const result = await downloadChatImagesInBackground(
      chat(
        { imageData: PNG },
        { imageData: "https://evil.example/x.png" },
        { imageData: JPEG },
      ),
      "shots/today",
      ["Login page!", "unused", "Chart: 2"],
    );

    expect(download.mock.calls.map(([options]) => options)).toEqual([
      { url: PNG, filename: "shots/today/Login page.png", saveAs: true },
      { url: JPEG, filename: "shots/today/Chart 2.jpg", saveAs: true },
    ]);
    expect(result).toEqual({
      success: true,
      downloadedCount: 2,
      downloadIds: [1, 2],
      filesList: ["shots/today/Login page.png", "shots/today/Chart 2.jpg"],
      errors: ["Invalid image data format"],
    });
  });

  it("names an image from its title and a timestamp when no name is given", async () => {
    await downloadChatImagesInBackground(
      chat({ imageData: PNG, imageTitle: "  Order Form (v2) " }),
    );
    expect(download.mock.calls[0]?.[0].filename).toMatch(
      /^order-form-v2-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/,
    );
  });

  it("reports a failed download without failing the ones that worked", async () => {
    download
      .mockRejectedValueOnce(new Error("Download canceled"))
      .mockResolvedValueOnce(7);
    const result = await downloadChatImagesInBackground(
      chat({ imageData: PNG }, { imageData: PNG }),
    );
    expect(result).toMatchObject({
      success: true,
      downloadedCount: 1,
      downloadIds: [7],
      errors: ["Error downloading image: Download canceled"],
    });
  });

  it("keeps each given name on its own image after a failed download", async () => {
    download
      .mockRejectedValueOnce(new Error("Download canceled"))
      .mockResolvedValueOnce(7);
    const result = await downloadChatImagesInBackground(
      chat({ imageData: PNG }, { imageData: PNG }),
      undefined,
      ["first", "second"],
    );
    expect(result.filesList).toEqual(["second.png"]);
  });

  it("saves an SVG image with the .svg extension", async () => {
    const result = await downloadChatImagesInBackground(
      chat({ imageData: "data:image/svg+xml;base64,PHN2Zz4=" }),
      undefined,
      ["diagram"],
    );
    expect(result.filesList).toEqual(["diagram.svg"]);
  });

  it("says so when the downloads permission is missing", async () => {
    vi.stubGlobal("chrome", {});
    expect(
      await downloadChatImagesInBackground(chat({ imageData: PNG })),
    ).toEqual({
      success: false,
      errors: ["Downloads permission not available."],
    });
  });
});
