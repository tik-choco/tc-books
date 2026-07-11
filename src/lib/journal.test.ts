import { beforeEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "../types";
import { buildQuickEntry, entryCreditTotal, entryDebitTotal, validateEntry } from "./journal";

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    date: "2026-07-01",
    description: "ランチ",
    lines: [
      { accountId: "food", debit: 1000, credit: 0 },
      { accountId: "cash", debit: 0, credit: 1000 },
    ],
    source: "manual",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateEntry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("正常な仕訳はエラーなし", () => {
    expect(validateEntry(baseEntry())).toEqual([]);
  });

  it("行が0件だとエラー", () => {
    const errors = validateEntry(baseEntry({ lines: [] }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("借方合計と貸方合計が不一致だとエラー", () => {
    const errors = validateEntry(
      baseEntry({
        lines: [
          { accountId: "food", debit: 1000, credit: 0 },
          { accountId: "cash", debit: 0, credit: 900 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes("一致"))).toBe(true);
  });

  it("存在しない科目だとエラー", () => {
    const errors = validateEntry(
      baseEntry({
        lines: [
          { accountId: "not-a-real-account", debit: 1000, credit: 0 },
          { accountId: "cash", debit: 0, credit: 1000 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes("科目"))).toBe(true);
  });

  it("行内で借方・貸方の両方に正の値があるとエラー", () => {
    const errors = validateEntry(
      baseEntry({
        lines: [
          { accountId: "food", debit: 1000, credit: 500 },
          { accountId: "cash", debit: 0, credit: 500 },
        ],
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("日付形式が不正だとエラー", () => {
    const errors = validateEntry(baseEntry({ date: "2026/07/01" }));
    expect(errors.some((e) => e.includes("日付"))).toBe(true);
  });

  it("entryDebitTotal / entryCreditTotal は各行の合計", () => {
    const entry = baseEntry();
    expect(entryDebitTotal(entry)).toBe(1000);
    expect(entryCreditTotal(entry)).toBe(1000);
  });
});

describe("buildQuickEntry", () => {
  it("expense: 借方=カテゴリ、貸方=支払手段", () => {
    const entry = buildQuickEntry({
      kind: "expense",
      date: "2026-07-05",
      amount: 1500,
      categoryAccountId: "food",
      methodAccountId: "cash",
      description: "ランチ",
    });
    expect(entry.lines).toEqual([
      { accountId: "food", debit: 1500, credit: 0 },
      { accountId: "cash", debit: 0, credit: 1500 },
    ]);
    expect(entry.date).toBe("2026-07-05");
    expect(entry.description).toBe("ランチ");
    expect(entry.source).toBe("quick");
    expect(validateEntry(entry)).toEqual([]);
  });

  it("income: 借方=受取手段、貸方=カテゴリ", () => {
    const entry = buildQuickEntry({
      kind: "income",
      date: "2026-07-06",
      amount: 300000,
      categoryAccountId: "salary",
      methodAccountId: "bank",
      description: "給与",
    });
    expect(entry.lines).toEqual([
      { accountId: "bank", debit: 300000, credit: 0 },
      { accountId: "salary", debit: 0, credit: 300000 },
    ]);
    expect(validateEntry(entry)).toEqual([]);
  });

  it("sourceを明示指定すればそちらが使われる", () => {
    const entry = buildQuickEntry({
      kind: "expense",
      date: "2026-07-05",
      amount: 100,
      categoryAccountId: "food",
      methodAccountId: "cash",
      description: "",
      source: "ocr",
    });
    expect(entry.source).toBe("ocr");
  });
});
