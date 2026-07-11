import { describe, expect, it } from "vitest";
import { parseReceiptScan } from "./ocr";

describe("parseReceiptScan", () => {
  it("有効なJSONを正しくパースする", () => {
    const raw = JSON.stringify({
      date: "2024-07-11",
      vendor: "セブンイレブン",
      total: 1080,
      tax: 80,
      items: [{ name: "おにぎり", amount: 150 }],
      category: "food",
    });
    const scan = parseReceiptScan(raw, "transcript text");
    expect(scan).toEqual({
      date: "2024-07-11",
      vendor: "セブンイレブン",
      total: 1080,
      tax: 80,
      items: [{ name: "おにぎり", amount: 150 }],
      suggestedAccountId: "food",
      raw,
      transcript: "transcript text",
    });
  });

  it("コードフェンスに包まれたJSONもパースする", () => {
    const json = JSON.stringify({
      date: "2024-07-11",
      vendor: "店A",
      total: 500,
      tax: null,
      items: [],
      category: null,
    });
    const raw = "```json\n" + json + "\n```";
    const scan = parseReceiptScan(raw, "t");
    expect(scan.date).toBe("2024-07-11");
    expect(scan.vendor).toBe("店A");
    expect(scan.total).toBe(500);
    expect(scan.tax).toBeNull();
    expect(scan.suggestedAccountId).toBeNull();
  });

  it("前後に説明文が付いたJSONもパースする", () => {
    const json = JSON.stringify({
      date: "2024-07-11",
      vendor: "店B",
      total: 2000,
      tax: 200,
      items: [],
      category: "dining",
    });
    const raw = `了解しました。以下がJSONです。\n${json}\nご確認ください。`;
    const scan = parseReceiptScan(raw, "t");
    expect(scan.vendor).toBe("店B");
    expect(scan.total).toBe(2000);
    expect(scan.suggestedAccountId).toBe("dining");
  });

  it("壊れた/途中で切れたJSONは空フィールドを返し例外を投げない", () => {
    const raw = '{"date":"2024-07-11","vendor":"店C","total":1000,"tax":';
    expect(() => parseReceiptScan(raw, "t")).not.toThrow();
    const scan = parseReceiptScan(raw, "t");
    expect(scan).toEqual({
      date: null,
      vendor: null,
      total: null,
      tax: null,
      items: [],
      suggestedAccountId: null,
      raw,
      transcript: "t",
    });
  });

  it("JSONブロックが全く見つからない場合も空フィールドを返す", () => {
    const raw = "申し訳ありませんが、この画像は読み取れませんでした。";
    const scan = parseReceiptScan(raw, "");
    expect(scan.date).toBeNull();
    expect(scan.vendor).toBeNull();
    expect(scan.raw).toBe(raw);
    expect(scan.transcript).toBe("");
  });

  it("文字列型の数値を整数に変換する", () => {
    const raw = JSON.stringify({
      date: "2024-07-11",
      vendor: "店D",
      total: "1500",
      tax: "100.6",
      items: [{ name: "商品X", amount: "300" }],
      category: null,
    });
    const scan = parseReceiptScan(raw, "t");
    expect(scan.total).toBe(1500);
    expect(scan.tax).toBe(101);
    expect(scan.items).toEqual([{ name: "商品X", amount: 300 }]);
  });

  it("未知のカテゴリIDはnullになる", () => {
    const raw = JSON.stringify({
      date: "2024-07-11",
      vendor: "店E",
      total: 100,
      tax: 0,
      items: [],
      category: "not-a-real-category",
    });
    const scan = parseReceiptScan(raw, "t");
    expect(scan.suggestedAccountId).toBeNull();
  });

  it("YYYY-MM-DD形式以外の日付はnullになる", () => {
    const raw = JSON.stringify({
      date: "2024/07/11",
      vendor: "店F",
      total: 100,
      tax: 0,
      items: [],
      category: null,
    });
    const scan = parseReceiptScan(raw, "t");
    expect(scan.date).toBeNull();
  });

  it("amountが数値化できない品目は除外する", () => {
    const raw = JSON.stringify({
      date: "2024-07-11",
      vendor: "店G",
      total: 100,
      tax: 0,
      items: [
        { name: "有効", amount: 100 },
        { name: "無効", amount: "abc" },
        { name: "", amount: 50 },
      ],
      category: null,
    });
    const scan = parseReceiptScan(raw, "t");
    expect(scan.items).toEqual([{ name: "有効", amount: 100 }]);
  });
});
