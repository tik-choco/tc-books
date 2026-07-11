// Standard chart of accounts (per BookKind) + custom account merge. Codes:
// asset 100s, liability 200s, equity 300s, revenue 400s, expense 500s
// (docs/CONTRACTS.md).
//
// Design: accounts that represent the same underlying concept across book
// kinds reuse the same `id` (e.g. cash/bank/sales/transport/opening-balance)
// even though their code/name may differ per kind — this keeps historical
// journal lines and cross-book display stable. Kind-specific accounts get
// their own id.

import type { Account, AccountType, BookKind } from "../types";
import { getActiveBook, loadCustomAccounts } from "./store";

const HOUSEHOLD_ACCOUNTS: Account[] = [
  // 資産
  { id: "cash", code: "101", name: "現金", type: "asset", paymentMethod: true },
  { id: "bank", code: "102", name: "普通預金", type: "asset", paymentMethod: true },
  { id: "emoney", code: "103", name: "電子マネー", type: "asset", paymentMethod: true },
  { id: "receivable", code: "104", name: "売掛金", type: "asset" },
  { id: "other-asset", code: "105", name: "その他資産", type: "asset" },
  // 負債
  { id: "credit-card", code: "201", name: "クレジットカード", type: "liability", paymentMethod: true },
  { id: "loan", code: "202", name: "借入金", type: "liability" },
  { id: "payable", code: "203", name: "未払金", type: "liability" },
  { id: "other-liability", code: "204", name: "その他負債", type: "liability" },
  // 純資産
  { id: "opening-balance", code: "301", name: "元入金・繰越", type: "equity" },
  // 収益
  { id: "salary", code: "401", name: "給与", type: "revenue", quickCategory: true },
  { id: "bonus", code: "402", name: "賞与", type: "revenue", quickCategory: true },
  { id: "sales", code: "403", name: "事業売上", type: "revenue", quickCategory: true },
  { id: "interest", code: "404", name: "利息・配当", type: "revenue", quickCategory: true },
  { id: "other-income", code: "405", name: "その他収入", type: "revenue", quickCategory: true },
  // 費用
  { id: "food", code: "501", name: "食費", type: "expense", quickCategory: true },
  { id: "dining", code: "502", name: "外食", type: "expense", quickCategory: true },
  { id: "daily", code: "503", name: "日用品", type: "expense", quickCategory: true },
  { id: "housing", code: "504", name: "住居・家賃", type: "expense", quickCategory: true },
  { id: "utilities", code: "505", name: "水道光熱", type: "expense", quickCategory: true },
  { id: "communication", code: "506", name: "通信", type: "expense", quickCategory: true },
  { id: "transport", code: "507", name: "交通", type: "expense", quickCategory: true },
  { id: "medical", code: "508", name: "医療", type: "expense", quickCategory: true },
  { id: "education", code: "509", name: "教育", type: "expense", quickCategory: true },
  { id: "entertainment", code: "510", name: "娯楽", type: "expense", quickCategory: true },
  { id: "clothing", code: "511", name: "衣服・美容", type: "expense", quickCategory: true },
  { id: "social", code: "512", name: "交際費", type: "expense", quickCategory: true },
  { id: "insurance", code: "513", name: "保険", type: "expense", quickCategory: true },
  { id: "tax", code: "514", name: "税金", type: "expense", quickCategory: true },
  { id: "supplies", code: "515", name: "消耗品", type: "expense", quickCategory: true },
  { id: "misc-expense", code: "516", name: "雑費", type: "expense", quickCategory: true },
];

const CIRCLE_ACCOUNTS: Account[] = [
  // 資産
  { id: "cash", code: "101", name: "現金", type: "asset", paymentMethod: true },
  { id: "bank", code: "102", name: "普通預金", type: "asset", paymentMethod: true },
  { id: "emoney", code: "103", name: "電子マネー", type: "asset", paymentMethod: true },
  { id: "receivable", code: "104", name: "未収金", type: "asset" },
  { id: "other-asset", code: "105", name: "その他資産", type: "asset" },
  // 負債
  { id: "payable", code: "201", name: "未払金", type: "liability" },
  { id: "loan", code: "202", name: "借入金", type: "liability" },
  { id: "other-liability", code: "203", name: "その他負債", type: "liability" },
  // 純資産
  { id: "opening-balance", code: "301", name: "繰越金", type: "equity" },
  // 収益
  { id: "membership-fee", code: "401", name: "会費収入", type: "revenue", quickCategory: true },
  { id: "event-income", code: "402", name: "イベント収入", type: "revenue", quickCategory: true },
  { id: "donation", code: "403", name: "寄付・カンパ", type: "revenue", quickCategory: true },
  { id: "grant", code: "404", name: "助成金・補助金", type: "revenue", quickCategory: true },
  { id: "other-income", code: "405", name: "その他収入", type: "revenue", quickCategory: true },
  // 費用
  { id: "venue", code: "501", name: "会場費", type: "expense", quickCategory: true },
  { id: "equipment-expense", code: "502", name: "備品・機材費", type: "expense", quickCategory: true },
  { id: "printing", code: "503", name: "印刷・制作費", type: "expense", quickCategory: true },
  { id: "event-expense", code: "504", name: "イベント運営費", type: "expense", quickCategory: true },
  { id: "party", code: "505", name: "懇親会費", type: "expense", quickCategory: true },
  { id: "transport", code: "506", name: "交通費", type: "expense", quickCategory: true },
  { id: "communication", code: "507", name: "通信・サーバー費", type: "expense", quickCategory: true },
  { id: "fees", code: "508", name: "支払手数料", type: "expense", quickCategory: true },
  { id: "supplies", code: "509", name: "消耗品", type: "expense", quickCategory: true },
  { id: "misc-expense", code: "510", name: "雑費", type: "expense", quickCategory: true },
];

const BUSINESS_ACCOUNTS: Account[] = [
  // 資産
  { id: "cash", code: "101", name: "現金", type: "asset", paymentMethod: true },
  { id: "bank", code: "102", name: "普通預金", type: "asset", paymentMethod: true },
  { id: "receivable", code: "103", name: "売掛金", type: "asset" },
  { id: "prepaid", code: "104", name: "前払金", type: "asset" },
  { id: "equipment", code: "105", name: "工具器具備品", type: "asset" },
  { id: "deposit-paid", code: "106", name: "敷金・保証金", type: "asset" },
  { id: "other-asset", code: "107", name: "その他資産", type: "asset" },
  // 負債
  { id: "payable-trade", code: "201", name: "買掛金", type: "liability" },
  { id: "credit-card", code: "202", name: "クレジットカード", type: "liability", paymentMethod: true },
  { id: "loan", code: "203", name: "借入金", type: "liability" },
  { id: "payable", code: "204", name: "未払金", type: "liability" },
  { id: "deposits-received", code: "205", name: "預り金", type: "liability" },
  { id: "other-liability", code: "206", name: "その他負債", type: "liability" },
  // 純資産
  { id: "opening-balance", code: "301", name: "元入金・繰越", type: "equity" },
  // 収益
  { id: "sales", code: "401", name: "売上高", type: "revenue", quickCategory: true },
  { id: "misc-income", code: "402", name: "雑収入", type: "revenue", quickCategory: true },
  // 費用
  { id: "purchases", code: "501", name: "仕入高", type: "expense", quickCategory: true },
  { id: "outsourcing", code: "502", name: "外注費", type: "expense", quickCategory: true },
  { id: "salary-expense", code: "503", name: "給料賃金", type: "expense", quickCategory: true },
  { id: "rent", code: "504", name: "地代家賃", type: "expense", quickCategory: true },
  { id: "utilities", code: "505", name: "水道光熱費", type: "expense", quickCategory: true },
  { id: "communication", code: "506", name: "通信費", type: "expense", quickCategory: true },
  { id: "transport", code: "507", name: "旅費交通費", type: "expense", quickCategory: true },
  { id: "advertising", code: "508", name: "広告宣伝費", type: "expense", quickCategory: true },
  { id: "entertainment-biz", code: "509", name: "接待交際費", type: "expense", quickCategory: true },
  { id: "meeting", code: "510", name: "会議費", type: "expense", quickCategory: true },
  { id: "supplies", code: "511", name: "消耗品費", type: "expense", quickCategory: true },
  { id: "fees", code: "512", name: "支払手数料", type: "expense", quickCategory: true },
  { id: "insurance-biz", code: "513", name: "損害保険料", type: "expense", quickCategory: true },
  { id: "depreciation", code: "514", name: "減価償却費", type: "expense" },
  { id: "tax", code: "515", name: "租税公課", type: "expense", quickCategory: true },
  { id: "misc-expense", code: "516", name: "雑費", type: "expense", quickCategory: true },
];

/** @deprecated 家計簿(household)の標準科目。kind別には standardAccountsFor() を使う */
export const STANDARD_ACCOUNTS: Account[] = HOUSEHOLD_ACCOUNTS;

/** 帳簿種別ごとの標準勘定科目チャート */
export function standardAccountsFor(kind: BookKind): Account[] {
  switch (kind) {
    case "circle":
      return CIRCLE_ACCOUNTS;
    case "business":
      return BUSINESS_ACCOUNTS;
    case "household":
    default:
      return HOUSEHOLD_ACCOUNTS;
  }
}

const ALL_STANDARD_CHARTS: Account[][] = [HOUSEHOLD_ACCOUNTS, CIRCLE_ACCOUNTS, BUSINESS_ACCOUNTS];

/** アクティブ帳簿の standardAccountsFor() + loadCustomAccounts()、code昇順 */
export function allAccounts(): Account[] {
  return [...standardAccountsFor(getActiveBook().kind), ...loadCustomAccounts()].sort((a, b) => a.code.localeCompare(b.code));
}

/** archived除外 */
export function activeAccounts(): Account[] {
  return allAccounts().filter((a) => !a.archived);
}

/**
 * アクティブ帳簿のチャート+カスタム科目からidで検索。見つからない場合は
 * 全kindの標準チャートを横断検索する (過去データ/帳簿間の表示崩れ防止)。
 */
export function accountById(id: string): Account | undefined {
  const found = allAccounts().find((a) => a.id === id);
  if (found) return found;
  for (const chart of ALL_STANDARD_CHARTS) {
    const fallback = chart.find((a) => a.id === id);
    if (fallback) return fallback;
  }
  return undefined;
}

/** active のみ */
export function accountsByType(type: AccountType): Account[] {
  return activeAccounts().filter((a) => a.type === type);
}

/** active & expense & quickCategory */
export function quickExpenseCategories(): Account[] {
  return activeAccounts().filter((a) => a.type === "expense" && a.quickCategory);
}

/** active & revenue & quickCategory */
export function quickIncomeCategories(): Account[] {
  return activeAccounts().filter((a) => a.type === "revenue" && a.quickCategory);
}

/** active & paymentMethod */
export function paymentMethods(): Account[] {
  return activeAccounts().filter((a) => a.paymentMethod);
}

export function normalBalanceSide(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}
