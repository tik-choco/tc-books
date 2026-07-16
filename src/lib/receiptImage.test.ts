import { describe, expect, it } from "vitest";
import type { IssuedReceipt } from "../types";
import { RECEIPT_SHEET_CSS, buildReceiptSvg, receiptPngFileName } from "./receiptImage";

function baseReceipt(overrides: Partial<IssuedReceipt> = {}): IssuedReceipt {
  return {
    id: "r1",
    payerName: "山田太郎",
    amount: 5000,
    issueDate: "2026-07-16",
    note: "お品代として",
    issuerName: "発行者花子",
    issueNo: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("RECEIPT_SHEET_CSS", () => {
  it("外部リソース参照やCSS変数を含まない", () => {
    expect(RECEIPT_SHEET_CSS).not.toContain("var(--");
    expect(RECEIPT_SHEET_CSS).not.toContain("@media");
    expect(RECEIPT_SHEET_CSS).not.toContain("url(");
    expect(RECEIPT_SHEET_CSS).not.toContain("@import");
  });

  it("sheetの基本規則を含む", () => {
    expect(RECEIPT_SHEET_CSS).toContain(".receipt-print-sheet");
    expect(RECEIPT_SHEET_CSS).toContain(".rps-amount-box");
  });
});

describe("buildReceiptSvg", () => {
  it("整形式なSVGを組み立てる (DOMParserで解析可能)", () => {
    const svg = buildReceiptSvg('<div xmlns="http://www.w3.org/1999/xhtml">x</div>', 640, 900);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

    expect(doc.getElementsByTagName("parsererror").length).toBe(0);

    const root = doc.documentElement;
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("width")).toBe("640");
    expect(root.getAttribute("height")).toBe("900");

    expect(doc.getElementsByTagName("foreignObject").length).toBe(1);
  });
});

describe("receiptPngFileName", () => {
  it("issueNoを4桁ゼロ埋めしたファイル名を返す", () => {
    const receipt = baseReceipt({ issueNo: 1, issueDate: "2026-07-16" });
    expect(receiptPngFileName(receipt)).toBe("領収書_0001_2026-07-16.png");
  });

  it("issueNoが5桁以上ならそのまま", () => {
    const receipt = baseReceipt({ issueNo: 12345, issueDate: "2026-08-01" });
    expect(receiptPngFileName(receipt)).toBe("領収書_12345_2026-08-01.png");
  });
});
