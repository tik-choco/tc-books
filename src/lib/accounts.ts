// Standard chart of accounts + custom account merge. Codes: asset 100s,
// liability 200s, equity 300s, revenue 400s, expense 500s (docs/CONTRACTS.md).

import type { Account, AccountType } from "../types";
import { loadCustomAccounts } from "./store";

export const STANDARD_ACCOUNTS: Account[] = [
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

/** STANDARD + loadCustomAccounts()、code昇順 */
export function allAccounts(): Account[] {
  return [...STANDARD_ACCOUNTS, ...loadCustomAccounts()].sort((a, b) => a.code.localeCompare(b.code));
}

/** archived除外 */
export function activeAccounts(): Account[] {
  return allAccounts().filter((a) => !a.archived);
}

export function accountById(id: string): Account | undefined {
  return allAccounts().find((a) => a.id === id);
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
