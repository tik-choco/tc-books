// LedgerView: two-pane general ledger. Left pane lists every account
// (grouped by AccountType, current balance shown, custom accounts editable/
// archivable). Right pane shows the ledgerRows() table for whichever
// account is selected, with its own month/all-period filter.
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Archive, ArchiveRestore, BookOpenText, Pencil, Plus, X } from "lucide-preact";
import type { Account, AccountType, DateRange, JournalEntry, JournalLine } from "../types";
import { loadEntries, subscribeBooks, upsertCustomAccount } from "../lib/store";
import { accountById, allAccounts } from "../lib/accounts";
import { todayYmd } from "../lib/journal";
import { ledgerRows, monthRange } from "../lib/reports";
import "../styles/reports.css";

type LedgerPeriodKind = "all" | "month";

const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_LABELS: Record<AccountType, string> = {
  asset: "資産",
  liability: "負債",
  equity: "純資産",
  revenue: "収益",
  expense: "費用",
};
const DEFAULT_CODE_BASE: Record<AccountType, number> = {
  asset: 100,
  liability: 200,
  equity: 300,
  revenue: 400,
  expense: 500,
};

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

function uniqueSortedDesc(values: string[]): string[] {
  return [...new Set(values)].sort().reverse();
}

function suggestCode(type: AccountType, accounts: Account[]): string {
  const nums = accounts
    .filter((a) => a.type === type)
    .map((a) => Number(a.code))
    .filter((n) => Number.isFinite(n));
  if (nums.length > 0) return String(Math.max(...nums) + 1);
  return String(DEFAULT_CODE_BASE[type] + 1);
}

function counterpartLabel(entry: JournalEntry, line: JournalLine): string {
  const others = entry.lines.filter((l) => l !== line);
  const ids = [...new Set(others.map((l) => l.accountId))];
  if (ids.length === 0) return "-";
  if (ids.length === 1) return accountById(ids[0])?.name ?? "-";
  return "諸口";
}

export function LedgerView(): JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadEntries());
  useEffect(() => subscribeBooks(() => setEntries(loadEntries())), []);

  const accounts = useMemo(() => {
    // Base chart (current book kind + custom accounts). Union in any
    // accountId referenced by loaded entries but absent from the current
    // chart (e.g. left over after a book-kind change) — accountById()
    // resolves those via its cross-kind fallback so history stays visible
    // in the ledger even though the account no longer belongs to the
    // active chart. Unresolvable ids (e.g. deleted custom accounts) stay
    // ignored, matching prior behavior.
    const base = allAccounts();
    const seen = new Set(base.map((a) => a.id));
    const extra = new Map<string, Account>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (seen.has(line.accountId) || extra.has(line.accountId)) continue;
        const resolved = accountById(line.accountId);
        if (resolved) extra.set(line.accountId, resolved);
      }
    }
    return [...base, ...extra.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [entries]);
  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const acc of accounts) {
      const rows = ledgerRows(entries, acc.id);
      map.set(acc.id, rows.length > 0 ? rows[rows.length - 1].balance : 0);
    }
    return map;
  }, [entries, accounts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && accounts.some((a) => a.id === selectedId)) return;
    const firstActive = accounts.find((a) => !a.archived) ?? accounts[0];
    setSelectedId(firstActive ? firstActive.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);
  const selectedAccount = selectedId ? accountById(selectedId) : undefined;

  const months = useMemo(() => {
    const list = uniqueSortedDesc(entries.map((e) => e.date.slice(0, 7)));
    return list.length > 0 ? list : [todayYmd().slice(0, 7)];
  }, [entries]);
  const [periodKind, setPeriodKind] = useState<LedgerPeriodKind>("all");
  const [monthValue, setMonthValue] = useState(() => months[0]);

  const range = useMemo<DateRange>(
    () => (periodKind === "month" && monthValue ? monthRange(monthValue) : {}),
    [periodKind, monthValue],
  );
  const rows = useMemo(
    () => (selectedId ? ledgerRows(entries, selectedId, range) : []),
    [entries, selectedId, range],
  );

  // --- Account add/edit form ------------------------------------------------
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<AccountType>("expense");
  const [formCode, setFormCode] = useState("");

  function openAddForm() {
    setEditingId(null);
    setFormName("");
    setFormType("expense");
    setFormCode(suggestCode("expense", accounts));
    setFormOpen(true);
  }

  function openEditForm(acc: Account) {
    setEditingId(acc.id);
    setFormName(acc.name);
    setFormType(acc.type);
    setFormCode(acc.code);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function submitForm(e: Event) {
    e.preventDefault();
    const name = formName.trim();
    const code = formCode.trim();
    if (!name || !code) return;
    const existing = editingId ? accounts.find((a) => a.id === editingId) : undefined;
    upsertCustomAccount({
      id: existing?.id ?? crypto.randomUUID(),
      code,
      name,
      type: formType,
      isCustom: true,
      archived: existing?.archived ?? false,
    });
    closeForm();
  }

  function toggleArchive(acc: Account) {
    upsertCustomAccount({ ...acc, archived: !acc.archived });
  }

  const grouped = useMemo(() => {
    const map = new Map<AccountType, Account[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const acc of accounts) map.get(acc.type)?.push(acc);
    return map;
  }, [accounts]);

  return (
    <div class="ledger-view">
      <aside class="ledger-sidebar">
        <div class="ledger-sidebar-head">
          <h2>勘定科目</h2>
          <button class="btn btn-ghost btn-small" onClick={() => (formOpen ? closeForm() : openAddForm())}>
            {formOpen ? <X size={14} /> : <Plus size={14} />}
            {formOpen ? "閉じる" : "科目を追加"}
          </button>
        </div>

        {formOpen && (
          <form class="ledger-add-form" onSubmit={submitForm}>
            <label class="field">
              <span>名前</span>
              <input
                type="text"
                value={formName}
                onInput={(e) => setFormName(e.currentTarget.value)}
                required
              />
            </label>
            <label class="field">
              <span>タイプ</span>
              <select
                value={formType}
                onChange={(e) => {
                  const t = e.currentTarget.value as AccountType;
                  setFormType(t);
                  if (!editingId) setFormCode(suggestCode(t, accounts));
                }}
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>科目コード</span>
              <input
                type="text"
                value={formCode}
                onInput={(e) => setFormCode(e.currentTarget.value)}
                required
              />
            </label>
            <div class="ledger-form-actions">
              <button type="button" class="btn btn-small" onClick={closeForm}>
                キャンセル
              </button>
              <button type="submit" class="btn btn-primary btn-small">
                {editingId ? "保存" : "追加"}
              </button>
            </div>
          </form>
        )}

        {TYPE_ORDER.map((type) => {
          const list = grouped.get(type) ?? [];
          if (list.length === 0) return null;
          return (
            <div class="ledger-account-group" key={type}>
              <h3 class="ledger-account-group-title">{TYPE_LABELS[type]}</h3>
              <ul class="ledger-account-list">
                {list.map((acc) => (
                  <li key={acc.id}>
                    <button
                      class={`ledger-account-item${
                        selectedId === acc.id ? " ledger-account-item--active" : ""
                      }${acc.archived ? " ledger-account-item--archived" : ""}`}
                      onClick={() => setSelectedId(acc.id)}
                    >
                      <span class="ledger-account-name">{acc.name}</span>
                      <span class="ledger-account-balance num">
                        {formatYen(balances.get(acc.id) ?? 0)}
                      </span>
                    </button>
                    {acc.isCustom && (
                      <div class="ledger-account-actions">
                        <button class="icon-btn" title="編集" onClick={() => openEditForm(acc)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          class="icon-btn"
                          title={acc.archived ? "復元" : "アーカイブ"}
                          onClick={() => toggleArchive(acc)}
                        >
                          {acc.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </aside>

      <section class="ledger-main">
        {!selectedAccount ? (
          <div class="empty-state">
            <BookOpenText size={40} />
            <p class="empty-state-title">科目がありません</p>
            <p class="empty-state-description">
              「科目を追加」から勘定科目を作成すると、ここに総勘定元帳が表示されます。
            </p>
          </div>
        ) : (
          <>
            <div class="ledger-main-head">
              <div class="ledger-main-title">
                <h2>
                  {selectedAccount.name}
                  <span style="margin-left:8px">({TYPE_LABELS[selectedAccount.type]})</span>
                </h2>
                <span>
                  現在残高:{" "}
                  <strong class="num ledger-main-balance">
                    {formatYen(balances.get(selectedAccount.id) ?? 0)}
                  </strong>
                </span>
              </div>
              <div class="ledger-period">
                <select
                  value={periodKind}
                  onChange={(e) => setPeriodKind(e.currentTarget.value as LedgerPeriodKind)}
                >
                  <option value="all">全期間</option>
                  <option value="month">月</option>
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
              </div>
            </div>

            {rows.length === 0 ? (
              <p class="rpt-empty">この期間の記帳がありません。</p>
            ) : (
              <div class="rpt-table-wrap">
                <table class="rpt-table">
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>摘要</th>
                      <th>相手科目</th>
                      <th class="num">借方</th>
                      <th class="num">貸方</th>
                      <th class="num">残高</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.entry.id}:${row.entry.lines.indexOf(row.line)}`}>
                        <td>{row.entry.date}</td>
                        <td>{row.entry.description}</td>
                        <td>{counterpartLabel(row.entry, row.line)}</td>
                        <td class="num">{row.line.debit > 0 ? formatYen(row.line.debit) : ""}</td>
                        <td class="num">{row.line.credit > 0 ? formatYen(row.line.credit) : ""}</td>
                        <td class="num">{formatYen(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
