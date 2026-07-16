import { describe, expect, it } from "vitest";
import { parseEntrySuggestion } from "./suggest";

const VALID_IDS = new Set(["cash", "dining", "food", "bank"]);

describe("parseEntrySuggestion", () => {
  it("正常なJSON", () => {
    const raw =
      '{"description":"セブンでコーヒー","date":"2026-07-15","amount":300,"debitAccountId":"dining","creditAccountId":"cash"}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result).toEqual({
      description: "セブンでコーヒー",
      date: "2026-07-15",
      amount: 300,
      debitAccountId: "dining",
      creditAccountId: "cash",
      raw,
    });
  });

  it("コードフェンス付きJSON", () => {
    const raw =
      '```json\n{"description":"ランチ","date":"2026-07-16","amount":1200,"debitAccountId":"dining","creditAccountId":"cash"}\n```';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.description).toBe("ランチ");
    expect(result.amount).toBe(1200);
    expect(result.debitAccountId).toBe("dining");
    expect(result.creditAccountId).toBe("cash");
    expect(result.raw).toBe(raw);
  });

  it("JSON前後に説明文がある応答", () => {
    const raw =
      '以下が推定結果です。\n{"description":"食料品","date":"2026-07-14","amount":2500,"debitAccountId":"food","creditAccountId":"bank"}\nご確認ください。';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.description).toBe("食料品");
    expect(result.date).toBe("2026-07-14");
    expect(result.amount).toBe(2500);
    expect(result.debitAccountId).toBe("food");
    expect(result.creditAccountId).toBe("bank");
  });

  it("候補外のaccountIdはnullに落ちる", () => {
    const raw =
      '{"description":"謎の支払い","date":"2026-07-16","amount":500,"debitAccountId":"unknown-account","creditAccountId":"cash"}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.debitAccountId).toBeNull();
    expect(result.creditAccountId).toBe("cash");
  });

  it("負数の金額はnull", () => {
    const raw = '{"description":"返金","date":null,"amount":-300,"debitAccountId":"cash","creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.amount).toBeNull();
  });

  it("小数の金額は丸められる", () => {
    const raw = '{"description":"端数あり","date":null,"amount":299.6,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.amount).toBe(300);
  });

  it("金額が文字列でも数値化できれば有効", () => {
    const raw = '{"description":"文字列金額","date":null,"amount":"450","debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.amount).toBe(450);
  });

  it("金額が数値化できない文字列ならnull", () => {
    const raw =
      '{"description":"不明金額","date":null,"amount":"たくさん","debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.amount).toBeNull();
  });

  it("0以下に丸められる金額はnull", () => {
    const raw = '{"description":"ゼロ","date":null,"amount":0.2,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.amount).toBeNull();
  });

  it("不正な日付形式はnull", () => {
    const raw =
      '{"description":"日付不正","date":"2026/07/16","amount":100,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.date).toBeNull();
  });

  it("和暦など変換されていない日付もnull", () => {
    const raw =
      '{"description":"和暦","date":"令和6年7月11日","amount":100,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.date).toBeNull();
  });

  it("JSONが全く無い応答は全フィールドnullでrawを保持", () => {
    const raw = "すみません、うまく読み取れませんでした。";
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result).toEqual({
      description: null,
      date: null,
      amount: null,
      debitAccountId: null,
      creditAccountId: null,
      raw,
    });
  });

  it("descriptionが空文字ならnull", () => {
    const raw = '{"description":"   ","date":null,"amount":null,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.description).toBeNull();
  });

  it("descriptionが空トリム前提でtrimされる", () => {
    const raw = '{"description":"  コーヒー  ","date":null,"amount":null,"debitAccountId":null,"creditAccountId":null}';
    const result = parseEntrySuggestion(raw, VALID_IDS);
    expect(result.description).toBe("コーヒー");
  });
});
