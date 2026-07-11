// Trial balance / balance sheet / income statement / ledger / monthly summary.
// Pure functions over a given entries array — account master is resolved via
// accounts.ts (which may read store.ts's custom accounts), but no report here
// reads localStorage itself.

import type { Account, AccountBalance, DateRange, JournalEntry, JournalLine } from "../types";
import { accountById, normalBalanceSide } from "./accounts";

function inRange(date: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function balanceFor(account: Account, debit: number, credit: number): number {
  return normalBalanceSide(account.type) === "debit" ? debit - credit : credit - debit;
}

/** 動きのあった科目のみ、code昇順 */
export function trialBalance(entries: JournalEntry[], range?: DateRange): AccountBalance[] {
  const totals = new Map<string, { debit: number; credit: number }>();

  for (const entry of entries) {
    if (!inRange(entry.date, range)) continue;
    for (const line of entry.lines) {
      const agg = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
      agg.debit += line.debit;
      agg.credit += line.credit;
      totals.set(line.accountId, agg);
    }
  }

  const rows: AccountBalance[] = [];
  for (const [accountId, agg] of totals) {
    if (agg.debit === 0 && agg.credit === 0) continue;
    const account = accountById(accountId);
    if (!account) continue;
    rows.push({ account, debit: agg.debit, credit: agg.credit, balance: balanceFor(account, agg.debit, agg.credit) });
  }

  return rows.sort((a, b) => a.account.code.localeCompare(b.account.code));
}

export interface BalanceSheetReport {
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  equity: AccountBalance[]; // opening-balance等
  retainedEarnings: number; // 期首からasOfまでの累積純利益 (equity側に加算表示する)
  totalAssets: number;
  totalLiabilitiesEquity: number; // liabilities + equity + retainedEarnings
}

export function balanceSheet(entries: JournalEntry[], asOf: string): BalanceSheetReport {
  const balances = trialBalance(entries, { to: asOf });

  const assets = balances.filter((b) => b.account.type === "asset");
  const liabilities = balances.filter((b) => b.account.type === "liability");
  const equity = balances.filter((b) => b.account.type === "equity");
  const revenues = balances.filter((b) => b.account.type === "revenue");
  const expenses = balances.filter((b) => b.account.type === "expense");

  const totalRevenue = revenues.reduce((sum, b) => sum + b.balance, 0);
  const totalExpense = expenses.reduce((sum, b) => sum + b.balance, 0);
  const retainedEarnings = totalRevenue - totalExpense;

  const totalAssets = assets.reduce((sum, b) => sum + b.balance, 0);
  const totalLiabilitiesEquity =
    liabilities.reduce((sum, b) => sum + b.balance, 0) + equity.reduce((sum, b) => sum + b.balance, 0) + retainedEarnings;

  return { assets, liabilities, equity, retainedEarnings, totalAssets, totalLiabilitiesEquity };
}

export interface IncomeStatementReport {
  revenues: AccountBalance[];
  expenses: AccountBalance[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export function incomeStatement(entries: JournalEntry[], range: DateRange): IncomeStatementReport {
  const balances = trialBalance(entries, range);
  const revenues = balances.filter((b) => b.account.type === "revenue");
  const expenses = balances.filter((b) => b.account.type === "expense");
  const totalRevenue = revenues.reduce((sum, b) => sum + b.balance, 0);
  const totalExpense = expenses.reduce((sum, b) => sum + b.balance, 0);
  return { revenues, expenses, totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense };
}

export interface LedgerRow {
  entry: JournalEntry;
  line: JournalLine; // この科目の行
  balance: number; // この行までの累積残高 (正残高側)
}

/** 日付昇順・同日はcreatedAt昇順 */
export function ledgerRows(entries: JournalEntry[], accountId: string, range?: DateRange): LedgerRow[] {
  const account = accountById(accountId);
  if (!account) return [];

  const matched: { entry: JournalEntry; line: JournalLine }[] = [];
  for (const entry of entries) {
    if (!inRange(entry.date, range)) continue;
    for (const line of entry.lines) {
      if (line.accountId === accountId) matched.push({ entry, line });
    }
  }

  matched.sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
    return a.entry.createdAt < b.entry.createdAt ? -1 : 1;
  });

  const side = normalBalanceSide(account.type);
  let balance = 0;
  return matched.map(({ entry, line }) => {
    balance += side === "debit" ? line.debit - line.credit : line.credit - line.debit;
    return { entry, line, balance };
  });
}

export interface CategoryAmount {
  account: Account;
  amount: number;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  income: number; // 収益合計
  expense: number; // 費用合計
  net: number;
  byExpenseCategory: CategoryAmount[]; // 金額降順
  byIncomeCategory: CategoryAmount[];
}

export function monthlySummary(entries: JournalEntry[], month: string): MonthlySummary {
  const range = monthRange(month);
  const stmt = incomeStatement(entries, range);

  const byExpenseCategory = stmt.expenses
    .map((b) => ({ account: b.account, amount: b.balance }))
    .sort((a, b) => b.amount - a.amount);
  const byIncomeCategory = stmt.revenues
    .map((b) => ({ account: b.account, amount: b.balance }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month,
    income: stmt.totalRevenue,
    expense: stmt.totalExpense,
    net: stmt.netIncome,
    byExpenseCategory,
    byIncomeCategory,
  };
}

/** { from: "YYYY-MM-01", to: 月末 } */
export function monthRange(month: string): DateRange {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mo = Number(monthStr);
  const lastDay = new Date(year, mo, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}
