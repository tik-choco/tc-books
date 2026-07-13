import { describe, expect, it } from "vitest";
import { bytesToDataUrl, dataUrlToBytes } from "./image";

describe("dataUrlToBytes / bytesToDataUrl", () => {
  it("MIMEを保持したまま相互変換できる", () => {
    // 1x1 の透明PNG (data URLのサンプルとしてよく使われる既知のバイト列)
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const { bytes, mime } = dataUrlToBytes(dataUrl);
    expect(mime).toBe("image/png");
    expect(bytes.length).toBeGreaterThan(0);

    const roundTripped = bytesToDataUrl(bytes, mime);
    expect(roundTripped).toBe(dataUrl);
  });

  it("大きめのバイト列でもチャンク分割で破損せず往復できる", () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const dataUrl = bytesToDataUrl(bytes, "application/octet-stream");
    const back = dataUrlToBytes(dataUrl);
    expect(back.mime).toBe("application/octet-stream");
    expect(back.bytes).toEqual(bytes);
  });

  it("data URL でない文字列は例外を投げる", () => {
    expect(() => dataUrlToBytes("not-a-data-url")).toThrow();
  });
});
