// TC Books — image file loading for OCR (worker: ocr)
// Mirrors tc-translate `src/lib/format.ts` readImageFile: validates the file
// is an image under a size cap, then reads it into a data URL usable
// directly as an OpenAI-style `image_url.url` content part.

export interface ImageInput {
  name: string;
  dataUrl: string;
  size: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function readImageFile(file: File): Promise<ImageInput> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("画像ファイルを選択してください。"));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error("画像サイズは10MB以下にしてください。"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("画像の読み込みに失敗しました。"));
        return;
      }
      resolve({
        name: file.name || "image",
        dataUrl: reader.result,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** 下書き保存用に画像を縮小する、失敗時は元のdataUrlを返す */
export function compressImageDataUrl(dataUrl: string, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed.length < dataUrl.length ? compressed : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.src = dataUrl;
  });
}
