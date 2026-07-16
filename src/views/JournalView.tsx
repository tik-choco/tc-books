// 仕訳帳ビュー: 仕訳一覧テーブル + 月/摘要フィルタ + 新規/編集/削除。
// データは store.ts を直読みし、subscribeBooks で他タブ/OCR取り込み等の変更を
// 即座に反映する（props無し・自己完結、docs/CONTRACTS.md の Views 節を参照）。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { NotebookPen, Pencil, Plus, Search, Trash2 } from "lucide-preact";
import type { EntrySource, JournalEntry } from "../types";
import { deleteEntry, loadEntries, subscribeBooks } from "../lib/store";
import { accountById } from "../lib/accounts";
import { todayYmd } from "../lib/journal";
import { EntryEditor } from "../components/EntryEditor";
import { ReceiptImportButton } from "../components/ReceiptImport";
import "../styles/journal.css";

const SOURCE_LABEL: Record<EntrySource, string> = {
  manual: "手入力",
  quick: "かんたん",
  ocr: "OCR",
  receipt: "領収書",
};

type EditorState = { mode: "new" } | { mode: "edit"; entry: JournalEntry };

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

function accountName(accountId: string): string {
  return accountById(accountId)?.name ?? "(不明な科目)";
}

export function JournalView(): JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[]>(() => loadEntries());
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  useEffect(() => subscribeBooks(() => setEntries(loadEntries())), []);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(todayYmd().slice(0, 7));
    for (const entry of entries) set.add(entry.date.slice(0, 7));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (month && !entry.date.startsWith(month)) return false;
      if (q) {
        const haystack = `${entry.description} ${entry.memo ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, month, search]);

  function openNew() {
    setEditor({ mode: "new" });
  }

  function openEdit(entry: JournalEntry) {
    setEditor({ mode: "edit", entry });
  }

  function closeEditor() {
    setEditor(null);
  }

  function handleDeleteRow(entry: JournalEntry) {
    const ok = confirm(`この仕訳を削除しますか?\n${entry.date} ${entry.description}`);
    if (!ok) return;
    deleteEntry(entry.id);
  }

  function handleDeleteFromEditor(entry: JournalEntry) {
    const ok = confirm(`この仕訳を削除しますか?\n${entry.date} ${entry.description}`);
    if (!ok) return;
    deleteEntry(entry.id);
    closeEditor();
  }

  return (
    <div class="jv-view">
      <div class="jv-inner">
        <div class="jv-toolbar">
          <div class="jv-filters">
            <select class="jv-select" value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
              <option value="">全期間</option>
              {monthOptions.map((ym) => (
                <option key={ym} value={ym}>
                  {formatMonthLabel(ym)}
                </option>
              ))}
            </select>
            <label class="jv-search">
              <Search size={14} />
              <input
                value={search}
                placeholder="摘要・メモで検索"
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="jv-actions">
            <button type="button" class="jv-btn jv-btn-primary" onClick={openNew}>
              <Plus size={15} /> 新規仕訳
            </button>
            <ReceiptImportButton />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div class="jv-empty">
            <NotebookPen size={28} />
            {entries.length === 0 ? (
              <>
                <p class="jv-empty-title">まだ仕訳がありません</p>
                <p class="jv-empty-sub">
                  領収書の読み取りか、上の「新規仕訳」から始めましょう。
                </p>
              </>
            ) : (
              <>
                <p class="jv-empty-title">条件に一致する仕訳がありません</p>
                <p class="jv-empty-sub">月や検索キーワードを変えてお試しください。</p>
              </>
            )}
          </div>
        ) : (
          <div class="jv-table-wrap">
            <table class="jv-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>摘要</th>
                  <th>借方科目・金額</th>
                  <th>貸方科目・金額</th>
                  <th>出所</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const debitLines = entry.lines.filter((line) => line.debit > 0);
                  const creditLines = entry.lines.filter((line) => line.credit > 0);
                  return (
                    <tr key={entry.id}>
                      <td class="jv-date">{entry.date}</td>
                      <td class="jv-desc-cell">
                        <div class="jv-desc">{entry.description || "(摘要なし)"}</div>
                        {entry.memo ? <div class="jv-memo">{entry.memo}</div> : null}
                      </td>
                      <td>
                        <div class="jv-lines">
                          {debitLines.map((line, i) => (
                            <div class="jv-line-row" key={`${entry.id}-d-${i}`}>
                              <span class="jv-account">{accountName(line.accountId)}</span>
                              <span class="num jv-amount jv-amount--debit">
                                ¥{line.debit.toLocaleString("ja-JP")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div class="jv-lines">
                          {creditLines.map((line, i) => (
                            <div class="jv-line-row" key={`${entry.id}-c-${i}`}>
                              <span class="jv-account">{accountName(line.accountId)}</span>
                              <span class="num jv-amount jv-amount--credit">
                                ¥{line.credit.toLocaleString("ja-JP")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span class={`jv-badge jv-badge--${entry.source}`}>{SOURCE_LABEL[entry.source]}</span>
                      </td>
                      <td>
                        <div class="jv-row-actions">
                          <button
                            type="button"
                            class="jv-icon-btn"
                            onClick={() => openEdit(entry)}
                            title="編集"
                            aria-label="編集"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            class="jv-icon-btn jv-icon-btn--danger"
                            onClick={() => handleDeleteRow(entry)}
                            title="削除"
                            aria-label="削除"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editor ? (
        <EntryEditor
          entry={editor.mode === "edit" ? editor.entry : null}
          onClose={closeEditor}
          onDelete={editor.mode === "edit" ? () => handleDeleteFromEditor(editor.entry) : undefined}
        />
      ) : null}
    </div>
  );
}
