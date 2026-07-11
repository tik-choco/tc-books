// ReportsView: sub-tabbed financial reports (trial balance / balance sheet /
// income statement) with a shared month/year/all-period selector. Reads the
// ledger directly from store.ts and re-derives everything via reports.ts —
// no local report state beyond the UI selection itself.
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { AccountBalance, DateRange, JournalEntry } from "../types";
import { loadEntries, subscribeBooks } from "../lib/store";
import { todayYmd } from "../lib/journal";
import { balanceSheet, incomeStatement, monthRange, trialBalance } from "../lib/reports";
import { paneEnterClass, useEnterDirection } from "../hooks/useEnterDirection";
import "../styles/reports.css";

type ReportTab = "trial" | "bs" | "is";
type PeriodKind = "month" | "year" | "all";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

function uniqueSortedDesc(values: string[]): string[] {
  return [...new Set(values)].sort().reverse();
}

function computeRange(kind: PeriodKind, month: string, year: string): DateRange {
  if (kind === "month" && month) return monthRange(month);
  if (kind === "year" && year) return { from: `${year}-01-01`, to: `${year}-12-31` };
  return {};
}

function sumBy(rows: AccountBalance[], key: "debit" | "credit"): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: "trial", label: "試算表" },
  { id: "bs", label: "貸借対照表" },
  { id: "is", label: "損益計算書" },
];
const REPORT_TAB_ORDER: readonly ReportTab[] = REPORT_TABS.map((tab) => tab.id);

export function ReportsView(): JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadEntries());
  useEffect(() => subscribeBooks(() => setEntries(loadEntries())), []);

  const months = useMemo(() => {
    const list = uniqueSortedDesc(entries.map((e) => e.date.slice(0, 7)));
    return list.length > 0 ? list : [todayYmd().slice(0, 7)];
  }, [entries]);
  const years = useMemo(() => {
    const list = uniqueSortedDesc(entries.map((e) => e.date.slice(0, 4)));
    return list.length > 0 ? list : [todayYmd().slice(0, 4)];
  }, [entries]);

  const [reportTab, setReportTab] = useState<ReportTab>("trial");
  const enterDir = useEnterDirection(REPORT_TAB_ORDER, reportTab);
  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [monthValue, setMonthValue] = useState(() => months[0]);
  const [yearValue, setYearValue] = useState(() => years[0]);

  const range = useMemo(
    () => computeRange(periodKind, monthValue, yearValue),
    [periodKind, monthValue, yearValue],
  );
  const asOf = useMemo(() => range.to ?? entries[0]?.date ?? todayYmd(), [range, entries]);

  const trial = useMemo(() => trialBalance(entries, range), [entries, range]);
  const bs = useMemo(() => balanceSheet(entries, asOf), [entries, asOf]);
  const is = useMemo(() => incomeStatement(entries, range), [entries, range]);

  const trialDebitTotal = sumBy(trial, "debit");
  const trialCreditTotal = sumBy(trial, "credit");

  return (
    <div class="rpt-page">
      <div class="rpt-toolbar">
        <div class="rpt-tab-group">
          {REPORT_TABS.map(({ id, label }) => (
            <button
              key={id}
              class={`rpt-tab-btn${reportTab === id ? " rpt-tab-btn--active" : ""}`}
              onClick={() => setReportTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="rpt-period">
          <select
            value={periodKind}
            onChange={(e) => setPeriodKind(e.currentTarget.value as PeriodKind)}
          >
            <option value="month">月</option>
            <option value="year">年</option>
            <option value="all">全期間</option>
          </select>
          {periodKind === "month" && (
            <select value={monthValue} onChange={(e) => setMonthValue(e.currentTarget.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {periodKind === "year" && (
            <select value={yearValue} onChange={(e) => setYearValue(e.currentTarget.value)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div key={reportTab} class={paneEnterClass(enterDir)}>
        {reportTab === "trial" && (
          <div class="rpt-section">
            <h3 class="rpt-section-title">試算表</h3>
            {trial.length === 0 ? (
              <p class="rpt-empty">この期間の仕訳がありません。</p>
            ) : (
              <div class="rpt-table-wrap">
                <table class="rpt-table">
                  <thead>
                    <tr>
                      <th>科目コード</th>
                      <th>科目</th>
                      <th class="num">借方合計</th>
                      <th class="num">貸方合計</th>
                      <th class="num">残高</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trial.map((row) => (
                      <tr key={row.account.id}>
                        <td>{row.account.code}</td>
                        <td>{row.account.name}</td>
                        <td class="num">{formatYen(row.debit)}</td>
                        <td class="num">{formatYen(row.credit)}</td>
                        <td class="num">{formatYen(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>借方・貸方合計</td>
                      <td class="num">{formatYen(trialDebitTotal)}</td>
                      <td class="num">{formatYen(trialCreditTotal)}</td>
                      <td class="num"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {reportTab === "bs" && (
          <div>
            <p class="rpt-asof">期末時点: {asOf}</p>
            <div class="bs-columns">
              <div class="rpt-section">
                <h3 class="bs-column-title">資産</h3>
                {bs.assets.length === 0 ? (
                  <p class="rpt-empty">残高のある資産科目がありません。</p>
                ) : (
                  <div class="rpt-table-wrap">
                    <table class="rpt-table">
                      <tbody>
                        {bs.assets.map((row) => (
                          <tr key={row.account.id}>
                            <td>{row.account.name}</td>
                            <td class="num">{formatYen(row.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>資産合計</td>
                          <td class="num">{formatYen(bs.totalAssets)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
              <div class="rpt-section">
                <h3 class="bs-column-title">負債・純資産</h3>
                <div class="rpt-table-wrap">
                  <table class="rpt-table">
                    <tbody>
                      <tr class="rpt-table-subheader">
                        <td colSpan={2}>負債</td>
                      </tr>
                      {bs.liabilities.length === 0 ? (
                        <tr>
                          <td colSpan={2} class="rpt-empty">
                            残高のある負債科目がありません。
                          </td>
                        </tr>
                      ) : (
                        bs.liabilities.map((row) => (
                          <tr key={row.account.id}>
                            <td>{row.account.name}</td>
                            <td class="num">{formatYen(row.balance)}</td>
                          </tr>
                        ))
                      )}
                      <tr class="rpt-table-subheader">
                        <td colSpan={2}>純資産</td>
                      </tr>
                      {bs.equity.map((row) => (
                        <tr key={row.account.id}>
                          <td>{row.account.name}</td>
                          <td class="num">{formatYen(row.balance)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>当期純利益(累積)</td>
                        <td class="num">{formatYen(bs.retainedEarnings)}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>負債・純資産合計</td>
                        <td class="num">{formatYen(bs.totalLiabilitiesEquity)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {reportTab === "is" && (
          <div class="rpt-stack">
            <div class="rpt-section">
              <h3 class="rpt-section-title">収益</h3>
              {is.revenues.length === 0 ? (
                <p class="rpt-empty">この期間の収益がありません。</p>
              ) : (
                <div class="rpt-table-wrap">
                  <table class="rpt-table">
                    <tbody>
                      {is.revenues.map((row) => (
                        <tr key={row.account.id}>
                          <td>{row.account.name}</td>
                          <td class="num">{formatYen(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>収益合計</td>
                        <td class="num">{formatYen(is.totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            <div class="rpt-section">
              <h3 class="rpt-section-title">費用</h3>
              {is.expenses.length === 0 ? (
                <p class="rpt-empty">この期間の費用がありません。</p>
              ) : (
                <div class="rpt-table-wrap">
                  <table class="rpt-table">
                    <tbody>
                      {is.expenses.map((row) => (
                        <tr key={row.account.id}>
                          <td>{row.account.name}</td>
                          <td class="num">{formatYen(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>費用合計</td>
                        <td class="num">{formatYen(is.totalExpense)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            <div class="is-net-income">
              <span class="is-net-income-label">当期純利益</span>
              <span
                class={`num is-net-income-value ${is.netIncome >= 0 ? "amt-credit" : "amt-debit"}`}
              >
                {formatYen(is.netIncome)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
