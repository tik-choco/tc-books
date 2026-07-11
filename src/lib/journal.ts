// Journal entry construction, validation, and quick-entry conversion.

import type { EntrySource, JournalEntry, JournalLine } from "../types";
import { accountById } from "./accounts";

export function newEntryId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** ローカルタイムゾーンの YYYY-MM-DD */
export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function entryDebitTotal(entry: JournalEntry): number {
  return entry.lines.reduce((sum, line) => sum + line.debit, 0);
}

export function entryCreditTotal(entry: JournalEntry): number {
  return entry.lines.reduce((sum, line) => sum + line.credit, 0);
}

/**
 * 検証: 行が1つ以上 / 各行はdebit・creditの一方のみ正の整数 / 借方合計===貸方合計 /
 * accountIdが存在 / dateがYYYY-MM-DD。エラーメッセージ(日本語)の配列、空配列=OK
 */
export function validateEntry(entry: JournalEntry): string[] {
  const errors: string[] = [];

  if (entry.lines.length === 0) {
    errors.push("仕訳行が1つ以上必要です");
  }

  entry.lines.forEach((line, i) => {
    const n = i + 1;
    if (!accountById(line.accountId)) {
      errors.push(`${n}行目: 存在しない科目が指定されています`);
    }
    const debitIsInt = Number.isInteger(line.debit) && line.debit >= 0;
    const creditIsInt = Number.isInteger(line.credit) && line.credit >= 0;
    if (!debitIsInt || !creditIsInt) {
      errors.push(`${n}行目: 金額は0以上の整数で入力してください`);
    } else if (!((line.debit > 0 && line.credit === 0) || (line.credit > 0 && line.debit === 0))) {
      errors.push(`${n}行目: 借方・貸方のどちらか一方のみを正の金額で入力してください`);
    }
  });

  if (entryDebitTotal(entry) !== entryCreditTotal(entry)) {
    errors.push("借方合計と貸方合計が一致しません");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.push("日付はYYYY-MM-DD形式で入力してください");
  }

  return errors;
}

export interface QuickEntryInput {
  kind: "expense" | "income";
  date: string;
  amount: number;
  categoryAccountId: string; // expense科目 or revenue科目
  methodAccountId: string; // paymentMethodの科目
  description: string;
  source?: EntrySource; // 省略時 "quick"
}

/**
 * 家計簿クイック入力→複式仕訳へ変換。
 * expense: 借方=カテゴリ / 貸方=支払手段(資産なら貸方、負債(クレカ)も貸方)
 * income:  借方=受取手段 / 貸方=カテゴリ
 */
export function buildQuickEntry(input: QuickEntryInput): JournalEntry {
  const amount = Math.trunc(input.amount);
  const lines: JournalLine[] =
    input.kind === "expense"
      ? [
          { accountId: input.categoryAccountId, debit: amount, credit: 0 },
          { accountId: input.methodAccountId, debit: 0, credit: amount },
        ]
      : [
          { accountId: input.methodAccountId, debit: amount, credit: 0 },
          { accountId: input.categoryAccountId, debit: 0, credit: amount },
        ];

  const now = nowIso();
  return {
    id: newEntryId(),
    date: input.date,
    description: input.description,
    lines,
    source: input.source ?? "quick",
    createdAt: now,
    updatedAt: now,
  };
}
