import { beforeEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "../types";
import { balanceSheet, incomeStatement, ledgerRows, monthlySummary, monthRange, trialBalance } from "./reports";

let seq = 0;
function mkEntry(date: string, lines: JournalEntry["lines"], description = ""): JournalEntry {
  seq += 1;
  const createdAt = `${date}T00:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `entry-${seq}`,
    date,
    description,
    lines,
    source: "manual",
    createdAt,
    updatedAt: createdAt,
  };
}

function sampleEntries(): JournalEntry[] {
  return [
    // 期首残高: 現金10万円 / 元入金10万円
    mkEntry("2026-01-01", [
      { accountId: "cash", debit: 100000, credit: 0 },
      { accountId: "opening-balance", debit: 0, credit: 100000 },
    ]),
    // 6月: 給与30万円 (普通預金へ)
    mkEntry("2026-06-05", [
      { accountId: "bank", debit: 300000, credit: 0 },
      { accountId: "salary", debit: 0, credit: 300000 },
    ]),
    // 6月: 食費5000円 (現金払い)
    mkEntry("2026-06-10", [
      { accountId: "food", debit: 5000, credit: 0 },
      { accountId: "cash", debit: 0, credit: 5000 },
    ]),
    // 7月: 食費3000円 (預金払い)
    mkEntry("2026-07-01", [
      { accountId: "food", debit: 3000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 3000 },
    ]),
  ];
}

beforeEach(() => {
  localStorage.clear();
  seq = 0;
});

describe("trialBalance", () => {
  it("動きのある科目のみ、code昇順で貸借が一致する", () => {
    const entries = sampleEntries();
    const rows = trialBalance(entries);

    expect(rows.length).toBe(5); // cash, bank, opening-balance, salary, food

    const codes = rows.map((r) => r.account.code);
    expect(codes).toEqual([...codes].sort());

    const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
    const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("range指定でその期間のみ集計する", () => {
    const entries = sampleEntries();
    const rows = trialBalance(entries, { from: "2026-07-01", to: "2026-07-31" });
    const foodRow = rows.find((r) => r.account.id === "food");
    expect(foodRow?.balance).toBe(3000);
    expect(rows.find((r) => r.account.id === "salary")).toBeUndefined();
  });
});

describe("balanceSheet", () => {
  it("totalAssets === totalLiabilitiesEquity が成立する (retainedEarnings込み)", () => {
    const entries = sampleEntries();
    const report = balanceSheet(entries, "2026-07-31");

    const expectedNetIncome = incomeStatement(entries, {}).netIncome;
    expect(report.retainedEarnings).toBe(expectedNetIncome);
    expect(report.totalAssets).toBe(report.totalLiabilitiesEquity);

    // 費用/収益科目は載らない
    expect(report.assets.every((b) => b.account.type === "asset")).toBe(true);
    expect(report.liabilities.every((b) => b.account.type === "liability")).toBe(true);
    expect(report.equity.every((b) => b.account.type === "equity")).toBe(true);
  });

  it("asOf以前の取引のみが反映される", () => {
    const entries = sampleEntries();
    const report = balanceSheet(entries, "2026-06-30");
    // 7月の食費3000円はまだ反映されない
    const bank = report.assets.find((b) => b.account.id === "bank");
    expect(bank?.balance).toBe(300000);
  });
});

describe("incomeStatement", () => {
  it("収益・費用・純利益を範囲内で集計する", () => {
    const entries = sampleEntries();
    const report = incomeStatement(entries, { from: "2026-06-01", to: "2026-06-30" });
    expect(report.totalRevenue).toBe(300000);
    expect(report.totalExpense).toBe(5000);
    expect(report.netIncome).toBe(295000);
  });

  it("範囲を指定しなければ全期間を集計する", () => {
    const entries = sampleEntries();
    const report = incomeStatement(entries, {});
    expect(report.totalRevenue).toBe(300000);
    expect(report.totalExpense).toBe(8000);
    expect(report.netIncome).toBe(292000);
  });
});

describe("ledgerRows", () => {
  it("日付昇順で累積残高(正残高側)を計算する", () => {
    const entries = sampleEntries();
    const rows = ledgerRows(entries, "cash");
    // cash: +100000 (1/1), -5000 (6/10)
    expect(rows.map((r) => r.balance)).toEqual([100000, 95000]);
    expect(rows[0].entry.date).toBe("2026-01-01");
    expect(rows[1].entry.date).toBe("2026-06-10");
  });

  it("負債科目は貸方が正残高側になる", () => {
    const entries: JournalEntry[] = [
      mkEntry("2026-07-01", [
        { accountId: "food", debit: 2000, credit: 0 },
        { accountId: "credit-card", debit: 0, credit: 2000 },
      ]),
      mkEntry("2026-07-15", [
        { accountId: "credit-card", debit: 2000, credit: 0 },
        { accountId: "bank", debit: 0, credit: 2000 },
      ]),
    ];
    const rows = ledgerRows(entries, "credit-card");
    expect(rows.map((r) => r.balance)).toEqual([2000, 0]);
  });

  it("存在しない科目は空配列", () => {
    expect(ledgerRows(sampleEntries(), "no-such-account")).toEqual([]);
  });
});

describe("monthlySummary", () => {
  it("月次の収支とカテゴリ内訳(金額降順)を返す", () => {
    const entries = sampleEntries();
    const summary = monthlySummary(entries, "2026-06");
    expect(summary.month).toBe("2026-06");
    expect(summary.income).toBe(300000);
    expect(summary.expense).toBe(5000);
    expect(summary.net).toBe(295000);
    expect(summary.byIncomeCategory).toEqual([{ account: expect.objectContaining({ id: "salary" }), amount: 300000 }]);
    expect(summary.byExpenseCategory).toEqual([{ account: expect.objectContaining({ id: "food" }), amount: 5000 }]);
  });
});

describe("monthRange", () => {
  it("月初・月末を返す (うるう年考慮)", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});
