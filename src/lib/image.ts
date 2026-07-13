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

/**
 * data URL (`data:<mime>;base64,<data>`) を MIME を保持したまま Uint8Array に
 * デコードする。mistlib storage_add へ渡すバイト列を作るために使う
 * (下書き画像をlocalStorageへインライン保存する代わりにOPFSへ逃がす経路)。
 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("不正な画像データです。");
  }
  const header = dataUrl.slice(5, commaIndex); // "data:" の後、"," の前
  const mime = header.split(";")[0] || "application/octet-stream";
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

/** dataUrlToBytesの逆変換。mistlib storage_getで取得したバイト列を表示可能なdata URLに戻す */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
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
