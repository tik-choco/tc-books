// 領収書発行 (receipt issuance) の構築・検証・仕訳変換ロジック。
// 自分が受け取った金銭に対して渡す正式な領収書を発行する機能で、既存の
// ReceiptImport (受け取った領収書のOCR取り込み) とは別物。

import type { IssuedReceipt, JournalEntry, ReceiptIssueInput } from "../types";
import { buildQuickEntry } from "./journal";

export function newReceiptId(): string {
  return crypto.randomUUID();
}

/** "No. 0001" (4桁ゼロ埋め、5桁以上はそのまま) */
export function formatReceiptNo(issueNo: number): string {
  const s = String(issueNo);
  return `No. ${s.length >= 4 ? s : s.padStart(4, "0")}`;
}

/** "¥12,345" */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** 末尾が"様"ならそのまま (例 "上様")、それ以外は `${payerName} 様` */
export function formatPayerName(payerName: string): string {
  return payerName.endsWith("様") ? payerName : `${payerName} 様`;
}

/**
 * 検証: 宛名・但し書き・発行者名はtrim後非空 / 金額は正の整数 / 発行日はYYYY-MM-DD。
 * エラーメッセージ(日本語)の配列、空配列=OK
 */
export function validateReceiptInput(input: ReceiptIssueInput): string[] {
  const errors: string[] = [];

  if (input.payerName.trim() === "") {
    errors.push("宛名を入力してください");
  }

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    errors.push("金額は1円以上の整数で入力してください");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) {
    errors.push("発行日はYYYY-MM-DD形式で入力してください");
  }

  if (input.note.trim() === "") {
    errors.push("但し書きを入力してください");
  }

  if (input.issuerName.trim() === "") {
    errors.push("発行者名を入力してください");
  }

  return errors;
}

export function buildIssuedReceipt(input: ReceiptIssueInput, issueNo: number): IssuedReceipt {
  return {
    payerName: input.payerName,
    amount: Math.trunc(input.amount),
    issueDate: input.issueDate,
    note: input.note,
    issuerName: input.issuerName,
    id: newReceiptId(),
    issueNo,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 売上仕訳への変換: buildQuickEntry({ kind: "income", source: "receipt" }) に委譲。
 * 借方=受取手段(methodAccountId) / 貸方=収益科目(revenueAccountId)、date=receipt.issueDate、
 * description=`領収書発行 ${formatReceiptNo(receipt.issueNo)} ${formatPayerName(receipt.payerName)}`
 */
export function buildReceiptJournalEntry(
  receipt: IssuedReceipt,
  methodAccountId: string,
  revenueAccountId: string,
): JournalEntry {
  return buildQuickEntry({
    kind: "income",
    date: receipt.issueDate,
    amount: receipt.amount,
    categoryAccountId: revenueAccountId,
    methodAccountId,
    description: `領収書発行 ${formatReceiptNo(receipt.issueNo)} ${formatPayerName(receipt.payerName)}`,
    source: "receipt",
  });
}
