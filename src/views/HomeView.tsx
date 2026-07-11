// HomeView — 家計簿の入口タブ。複式簿記を意識させず「支出/収入をさっと記録する」
// クイック入力フォームを中心に、月次サマリ・カテゴリ内訳・最近の記録を並べる。
// domain (store/accounts/journal/reports) と ocr (ReceiptImportButton) は
// 別workerが並行実装中のため、docs/CONTRACTS.md のシグネチャのみを頼りに実装している。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  ChartPie,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  History,
  PackageOpen,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-preact";
import type { JournalEntry } from "../types";
import { loadEntries, subscribeBooks, upsertEntry } from "../lib/store";
import {
  accountById,
  paymentMethods,
  quickExpenseCategories,
  quickIncomeCategories,
} from "../lib/accounts";
import { buildQuickEntry, entryDebitTotal, todayYmd, validateEntry } from "../lib/journal";
import type { QuickEntryInput } from "../lib/journal";
import { monthlySummary } from "../lib/reports";
import { ReceiptImportButton } from "../components/ReceiptImport";
import "../styles/home.css";

/** "YYYY-MM" を delta ヶ月分ずらす */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

interface EntryGist {
  label: string;
  amount: number;
  tone: "expense" | "income" | "neutral";
}

/** quick/ocr由来はカテゴリ科目名を表示、それ以外(手動の複雑な仕訳)は「仕訳」とだけ出す */
function describeEntry(entry: JournalEntry): EntryGist {
  if (entry.source === "quick" || entry.source === "ocr") {
    for (const line of entry.lines) {
      const account = accountById(line.accountId);
      if (!account) continue;
      if (account.type === "expense" && line.debit > 0) {
        return { label: account.name, amount: line.debit, tone: "expense" };
      }
      if (account.type === "revenue" && line.credit > 0) {
        return { label: account.name, amount: line.credit, tone: "income" };
      }
    }
  }
  return { label: "仕訳", amount: entryDebitTotal(entry), tone: "neutral" };
}

export function HomeView(): JSX.Element {
  const [month, setMonth] = useState<string>(() => todayYmd().slice(0, 7));
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadEntries());

  useEffect(() => subscribeBooks(() => setEntries(loadEntries())), []);

  const summary = useMemo(() => monthlySummary(entries, month), [entries, month]);
  const monthEntries = useMemo(
    () => entries.filter((e) => e.date.startsWith(month)),
    [entries, month],
  );
  const recentEntries = monthEntries.slice(0, 10);

  // --- クイック入力フォーム ---
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState<string>("");
  const [methodId, setMethodId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState<string>(() => todayYmd());
  const [memo, setMemo] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const categories = kind === "expense" ? quickExpenseCategories() : quickIncomeCategories();
  const methods = paymentMethods();
  const effectiveCategoryId = categories.some((c) => c.id === categoryId)
    ? categoryId
    : (categories[0]?.id ?? "");
  const effectiveMethodId = methods.some((m) => m.id === methodId)
    ? methodId
    : (methods.find((m) => m.id === "cash")?.id ?? methods[0]?.id ?? "");

  function selectKind(next: "expense" | "income") {
    setKind(next);
    setCategoryId("");
  }

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const amountValue = Math.round(Number(amount));
    if (!amount || !Number.isFinite(amountValue) || amountValue <= 0) {
      setFormError("金額を入力してください");
      return;
    }
    if (!effectiveCategoryId || !effectiveMethodId) {
      setFormError("カテゴリと支払い方法を選択してください");
      return;
    }
    const categoryAccount = accountById(effectiveCategoryId);
    const input: QuickEntryInput = {
      kind,
      date,
      amount: amountValue,
      categoryAccountId: effectiveCategoryId,
      methodAccountId: effectiveMethodId,
      description: memo.trim() || categoryAccount?.name || (kind === "expense" ? "支出" : "収入"),
    };
    const entry = buildQuickEntry(input);
    const errors = validateEntry(entry);
    if (errors.length > 0) {
      setFormError(errors.join(" / "));
      return;
    }
    upsertEntry(entry);
    setEntries(loadEntries());
    setAmount("");
    setMemo("");
    setFormError(null);
  }

  const maxExpense = summary.byExpenseCategory[0]?.amount || 1;
  const maxIncome = summary.byIncomeCategory[0]?.amount || 1;

  return (
    <div class="home-view">
      <div class="home-month-nav">
        <button
          type="button"
          class="home-month-btn"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label="前の月"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          class="home-month-label"
          onClick={() => setMonth(todayYmd().slice(0, 7))}
          title="今月に戻る"
        >
          {formatMonthLabel(month)}
        </button>
        <button
          type="button"
          class="home-month-btn"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          aria-label="次の月"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <section class="home-summary-grid">
        <div class="home-summary-card">
          <div class="home-summary-icon home-summary-icon--income">
            <TrendingUp size={18} />
          </div>
          <div class="home-summary-body">
            <span class="home-summary-label">収入</span>
            <span class="home-summary-value num">¥{summary.income.toLocaleString()}</span>
          </div>
        </div>
        <div class="home-summary-card">
          <div class="home-summary-icon home-summary-icon--expense">
            <TrendingDown size={18} />
          </div>
          <div class="home-summary-body">
            <span class="home-summary-label">支出</span>
            <span class="home-summary-value num">¥{summary.expense.toLocaleString()}</span>
          </div>
        </div>
        <div class="home-summary-card">
          <div class="home-summary-icon home-summary-icon--net">
            <Scale size={18} />
          </div>
          <div class="home-summary-body">
            <span class="home-summary-label">収支</span>
            <span
              class={`home-summary-value num ${summary.net >= 0 ? "home-net-positive" : "home-net-negative"}`}
            >
              {summary.net >= 0 ? "+" : "-"}¥{Math.abs(summary.net).toLocaleString()}
            </span>
          </div>
        </div>
      </section>

      <section class="home-card home-quick-card">
        <div class="home-quick-header">
          <h2 class="home-card-title">
            <CirclePlus size={18} />
            クイック入力
          </h2>
          <ReceiptImportButton
            label="レシートを撮って読み取る"
            onCreated={() => setEntries(loadEntries())}
          />
        </div>
        <form class="home-quick-form" onSubmit={handleSubmit}>
          <div class="home-kind-toggle" role="group" aria-label="支出または収入">
            <button
              type="button"
              class={`home-kind-btn${kind === "expense" ? " home-kind-btn-active-expense" : ""}`}
              onClick={() => selectKind("expense")}
            >
              <TrendingDown size={16} />
              支出
            </button>
            <button
              type="button"
              class={`home-kind-btn${kind === "income" ? " home-kind-btn-active-income" : ""}`}
              onClick={() => selectKind("income")}
            >
              <TrendingUp size={16} />
              収入
            </button>
          </div>

          <label class="home-field">
            <span class="home-field-label">金額</span>
            <div class="home-amount-wrap">
              <span class="home-amount-yen">¥</span>
              <input
                class="home-amount-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={amount}
                onInput={(e) => {
                  setFormError(null);
                  setAmount(e.currentTarget.value.replace(/[^0-9]/g, ""));
                }}
              />
            </div>
          </label>

          <div class="home-field">
            <span class="home-field-label">カテゴリ</span>
            <div class="home-chip-row">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  class={`home-chip${c.id === effectiveCategoryId ? " home-chip-active" : ""}`}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div class="home-field-row">
            <label class="home-field">
              <span class="home-field-label">{kind === "expense" ? "支払い方法" : "受取先"}</span>
              <select
                value={effectiveMethodId}
                onChange={(e) => setMethodId(e.currentTarget.value)}
              >
                {methods.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label class="home-field">
              <span class="home-field-label">日付</span>
              <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
            </label>
          </div>

          <label class="home-field">
            <span class="home-field-label">メモ（任意）</span>
            <input
              type="text"
              placeholder="例）スーパーで買い物"
              value={memo}
              onInput={(e) => setMemo(e.currentTarget.value)}
            />
          </label>

          {formError && <p class="home-form-error">{formError}</p>}

          <button type="submit" class="home-submit-btn">
            追加
          </button>
        </form>
      </section>

      {monthEntries.length === 0 ? (
        <section class="home-card home-empty-card">
          <div class="home-empty-state">
            <div class="home-empty-icon">
              <PackageOpen size={28} />
            </div>
            <p class="home-empty-title">{formatMonthLabel(month)}の記録はまだありません</p>
            <p class="home-empty-desc">
              上のクイック入力フォームか、レシート読み取りから最初の記録を追加してみましょう。
            </p>
          </div>
        </section>
      ) : (
        <div class="home-content-grid">
          <section class="home-card">
            <h2 class="home-card-title">
              <ChartPie size={18} />
              カテゴリ別内訳
            </h2>
            {summary.byExpenseCategory.length === 0 ? (
              <p class="home-breakdown-empty">今月の支出はまだありません。</p>
            ) : (
              <ul class="home-breakdown-list">
                {summary.byExpenseCategory.map((c) => (
                  <li class="home-breakdown-row" key={c.account.id}>
                    <span class="home-breakdown-name">{c.account.name}</span>
                    <span class="home-breakdown-bar-track">
                      <span
                        class="home-breakdown-bar-fill"
                        style={{ width: `${Math.round((c.amount / maxExpense) * 100)}%` }}
                      />
                    </span>
                    <span class="home-breakdown-amount num">¥{c.amount.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}

            {summary.byIncomeCategory.length > 0 && (
              <div class="home-breakdown-income">
                <h3 class="home-breakdown-subtitle">収入内訳</h3>
                <ul class="home-breakdown-list home-breakdown-list--small">
                  {summary.byIncomeCategory.map((c) => (
                    <li class="home-breakdown-row home-breakdown-row--income" key={c.account.id}>
                      <span class="home-breakdown-name">{c.account.name}</span>
                      <span class="home-breakdown-bar-track home-breakdown-bar-track--income">
                        <span
                          class="home-breakdown-bar-fill home-breakdown-bar-fill--income"
                          style={{ width: `${Math.round((c.amount / maxIncome) * 100)}%` }}
                        />
                      </span>
                      <span class="home-breakdown-amount num">¥{c.amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section class="home-card">
            <h2 class="home-card-title">
              <History size={18} />
              最近の記録
            </h2>
            <ul class="home-recent-list">
              {recentEntries.map((entry) => {
                const gist = describeEntry(entry);
                return (
                  <li class="home-recent-row" key={entry.id}>
                    <span class="home-recent-date">{formatDay(entry.date)}</span>
                    <span class="home-recent-desc">{entry.description}</span>
                    <span class="home-recent-category">{gist.label}</span>
                    <span
                      class={`home-recent-amount num${
                        gist.tone === "expense"
                          ? " home-amount-expense"
                          : gist.tone === "income"
                            ? " home-amount-income"
                            : ""
                      }`}
                    >
                      {gist.tone === "expense" ? "-" : gist.tone === "income" ? "+" : ""}¥
                      {gist.amount.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
