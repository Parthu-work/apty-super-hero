/**
 * Downloading chat images to disk, from either the internal message router
 * or the QuickJS skill runtime (via a global function binding).
 */

/**
 * Validate a path segment to prevent directory traversal and unsafe characters.
 */
function validatePathSegment(
  segment: string | undefined,
  fieldName: string,
): string | null {
  if (segment === undefined || segment === "") return null;

  const traversalPatterns = [
    "..",
    "%2e%2e",
    "%2E%2E",
    "..%2f",
    "..%5c",
    "%2f..",
    "%5c..",
  ];
  for (const pattern of traversalPatterns) {
    if (segment.toLowerCase().includes(pattern.toLowerCase())) {
      return `${fieldName} contains forbidden traversal pattern: ${pattern}`;
    }
  }
  if (segment.includes("\\"))
    return `${fieldName} must not contain backslashes`;
  if (segment.startsWith("/") || segment.endsWith("/"))
    return `${fieldName} must not have leading or trailing slashes`;
  if (segment.includes("//"))
    return `${fieldName} contains empty path segments`;

  return null;
}

export async function downloadChatImagesInBackground(
  messages: Array<{
    id: string;
    parts?: Array<{
      type: string;
      imageData?: string;
      imageTitle?: string;
    }>;
  }>,
  folderPrefix?: string,
  imageNames?: string[],
): Promise<{
  success: boolean;
  downloadedCount?: number;
  downloadIds?: number[];
  errors?: string[];
  filesList?: string[];
}> {
  try {
    if (!chrome.downloads) {
      return {
        success: false,
        errors: ["Downloads permission not available."],
      };
    }

    const folderPrefixError = validatePathSegment(folderPrefix, "folderPrefix");
    if (folderPrefixError)
      return { success: false, errors: [folderPrefixError] };

    if (imageNames) {
      for (let i = 0; i < imageNames.length; i++) {
        const nameError = validatePathSegment(
          imageNames[i],
          `imageNames[${i}]`,
        );
        if (nameError) return { success: false, errors: [nameError] };
      }
    }

    const downloadIds: number[] = [];
    const errors: string[] = [];
    const filesList: string[] = [];
    let downloadedCount = 0;
    let imageIndex = 0;

    for (const message of messages) {
      if (!message.parts) continue;
      for (const part of message.parts) {
        if (part.type === "image" && part.imageData) {
          try {
            // Validate image data format
            if (!part.imageData.startsWith("data:image/")) {
              errors.push("Invalid image data format");
              imageIndex++;
              continue;
            }

            let filename: string;
            const imageName = imageNames?.[imageIndex];
            if (imageName) {
              filename = imageName.replace(/[^a-zA-Z0-9一-龥\s-]/g, "").trim();
            } else {
              const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .slice(0, -5);
              const titleSlug = part.imageTitle
                ? part.imageTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                : "image";
              filename = `${titleSlug}-${timestamp}`;
            }

            const fullFilename = folderPrefix
              ? `${folderPrefix}/${filename}`
              : filename;

            const mimeMatch = part.imageData.match(/data:image\/([^;]+)/);
            const extension =
              mimeMatch?.[1] === "jpeg" ? "jpg" : (mimeMatch?.[1] ?? "png");
            const imageFilename = fullFilename.includes(".")
              ? fullFilename
              : `${fullFilename}.${extension}`;

            const downloadId = await chrome.downloads.download({
              url: part.imageData,
              filename: imageFilename,
              saveAs: true,
            });

            downloadIds.push(downloadId);
            filesList.push(imageFilename);
            downloadedCount++;
            imageIndex++;
          } catch (error) {
            errors.push(
              `Error downloading image: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return {
      success: downloadedCount > 0 || errors.length === 0,
      downloadedCount,
      downloadIds,
      filesList,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/** Expose the download flow as a global callable from the QuickJS skill runtime. */
export function registerGlobalDownloadHelper(): void {
  (
    globalThis as Record<string, unknown>
  ).downloadCurrentChatImagesFromBackground = async (
    folderPrefix: string,
    imageNames?: string[],
    filenamingStrategy: string = "descriptive",
    displayResults: boolean = true,
  ) => {
    try {
      const sidepanelResponse = await chrome.runtime.sendMessage({
        request: "provide-current-chat-images",
        folderPrefix,
        imageNames,
        filenamingStrategy,
        displayResults,
      });

      if (sidepanelResponse?.images && sidepanelResponse.images.length > 0) {
        const result = await downloadChatImagesInBackground(
          sidepanelResponse.images,
          folderPrefix,
          imageNames,
        );
        return {
          success: result.success,
          downloadedCount: result.downloadedCount,
          downloadIds: result.downloadIds,
          folderPath: folderPrefix,
          filesList: result.filesList ?? [],
          error: result.errors?.join(", "),
        };
      }

      return { success: false, error: "No images found in current chat" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
