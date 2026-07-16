// 発行済み領収書をPNG画像として保存する機能。html2canvas等のnpm依存を追加せず、
// ブラウザ標準のSVG <foreignObject> にDOMをそのまま埋め込んでラスタライズする手法を使う
// （sheetをクローン→XHTML直列化→SVG化→Imageとして読み込み→canvasへdrawImage→toBlob）。
// RECEIPT_SHEET_CSS は receipts.css の .receipt-print-sheet / .rps-* 規則の逐語コピーなので、
// receipts.css側のsheetレイアウトを変更したら同じ変更内でこちらも必ず追随させること。

import type { IssuedReceipt } from "../types";

export const RECEIPT_SHEET_CSS = `
.receipt-print-sheet {
  width: 640px;
  max-width: none;
  margin: 0;
  padding: 40px 44px;
  background: #ffffff;
  color: #171717;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  font-family: "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", serif;
}

.rps-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}

.rps-title {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: #171717;
}

.rps-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 0.82rem;
  color: #444444;
  white-space: nowrap;
}

.rps-payer {
  padding-bottom: 8px;
  margin-bottom: 24px;
  border-bottom: 1.5px solid #171717;
  font-size: 1.3rem;
  font-weight: 700;
  color: #171717;
}

.rps-amount-box {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 16px 20px;
  margin-bottom: 20px;
  border: 2px solid #171717;
  border-radius: 4px;
  background: #fafafa;
}

.rps-amount-label {
  font-size: 0.9rem;
  font-weight: 700;
  color: #444444;
}

.rps-amount-value {
  flex: 1;
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  color: #171717;
}

.rps-amount-tail {
  font-size: 1.2rem;
  font-weight: 700;
  color: #171717;
}

.rps-note {
  margin-bottom: 6px;
  font-size: 0.95rem;
  color: #222222;
}

.rps-confirm {
  margin-bottom: 32px;
  font-size: 0.85rem;
  color: #444444;
}

.rps-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.rps-stamp {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 88px;
  border: 1px dashed #999999;
  border-radius: 2px;
  color: #999999;
  font-size: 0.7rem;
  text-align: center;
  writing-mode: vertical-rl;
}

.rps-issuer {
  text-align: right;
}

.rps-issuer-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: #171717;
}
`;

/** "領収書_0001_2026-07-16.png" (issueNo 4桁ゼロ埋め、5桁以上はそのまま) */
export function receiptPngFileName(receipt: IssuedReceipt): string {
  const s = String(receipt.issueNo);
  const no = s.length >= 4 ? s : s.padStart(4, "0");
  return `領収書_${no}_${receipt.issueDate}.png`;
}

/** 純粋な文字列組み立て: sheetのXHTMLをforeignObjectで包んだSVGマークアップを返す */
export function buildReceiptSvg(xhtml: string, widthPx: number, heightPx: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${widthPx}px"><style>${RECEIPT_SHEET_CSS}</style>${xhtml}</div></foreignObject></svg>`;
}

/**
 * 表示中の .receipt-print-sheet 要素をPNG画像のBlobに変換する。
 * head末尾に一時<style>(RECEIPT_SHEET_CSS)を追加してカスケード同点で勝たせつつ、
 * 画面外(fixed, left:-9999px)の幅640pxホストにcloneNodeして高さを実測する
 * （head末尾に置くことで、ページ側の max-width:640px メディアクエリを測定時にも無効化する）。
 */
export function receiptSheetToPngBlob(sheet: HTMLElement, scale = 2): Promise<Blob> {
  const styleEl = document.createElement("style");
  styleEl.textContent = RECEIPT_SHEET_CSS;
  document.head.appendChild(styleEl);

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  host.style.width = "640px";
  const clone = sheet.cloneNode(true) as HTMLElement;
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const height = Math.ceil(clone.getBoundingClientRect().height);
    const xhtml = new XMLSerializer().serializeToString(clone);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildReceiptSvg(xhtml, 640, height));

    return new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640 * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvasの初期化に失敗しました"));
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 640, height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("PNG画像の生成に失敗しました"));
            return;
          }
          resolve(blob);
        }, "image/png");
      };
      img.onerror = () => reject(new Error("領収書画像の生成に失敗しました"));
      img.src = url;
    });
  } finally {
    host.remove();
    styleEl.remove();
  }
}

/** BlobをファイルとしてダウンロードさせるためのDOM操作 (a[download] + click) */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
