// 仕訳エディタモーダル（新規/編集共通）。JournalView から entry=null(新規) または
// 既存 JournalEntry(編集) を渡して開く。保存時は validateEntry() でエラーがあれば
// 日本語メッセージを表示し、無ければ upsertEntry() して onClose() する。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Plus, Save, Sparkles, Trash2, X } from "lucide-preact";
import type { Account, AccountType, JournalEntry, JournalLine } from "../types";
import { activeAccounts } from "../lib/accounts";
import { newEntryId, nowIso, todayYmd, validateEntry } from "../lib/journal";
import { upsertEntry } from "../lib/store";
import { suggestEntry } from "../lib/suggest";
import "../styles/journal.css";

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
}

const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_LABEL: Record<AccountType, string> = {
  asset: "資産",
  liability: "負債",
  equity: "純資産",
  revenue: "収益",
  expense: "費用",
};

function initialLines(entry: JournalEntry | null, accounts: Account[]): DraftLine[] {
  if (entry && entry.lines.length > 0) {
    return entry.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit > 0 ? String(line.debit) : "",
      credit: line.credit > 0 ? String(line.credit) : "",
    }));
  }
  const first = accounts[0]?.id ?? "";
  return [
    { accountId: first, debit: "", credit: "" },
    { accountId: first, debit: "", credit: "" },
  ];
}

function toAmount(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function EntryEditor(props: {
  entry: JournalEntry | null;
  onClose: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const { entry, onClose, onDelete } = props;
  const isNew = entry === null;

  const accounts = useMemo(() => activeAccounts(), []);
  const groups = useMemo(
    () =>
      TYPE_ORDER.map((type) => ({
        type,
        label: TYPE_LABEL[type],
        accounts: accounts.filter((a) => a.type === type),
      })).filter((g) => g.accounts.length > 0),
    [accounts],
  );

  const [date, setDate] = useState(entry?.date ?? todayYmd());
  const [description, setDescription] = useState(entry?.description ?? "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => initialLines(entry, accounts));
  const [errors, setErrors] = useState<string[]>([]);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const pointerDownOnOverlay = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function setDebit(index: number, value: string) {
    updateLine(index, { debit: value, credit: value.trim() ? "" : lines[index]?.credit });
  }

  function setCredit(index: number, value: string) {
    updateLine(index, { credit: value, debit: value.trim() ? "" : lines[index]?.debit });
  }

  function addLine() {
    setLines((prev) => [...prev, { accountId: accounts[0]?.id ?? "", debit: "", credit: "" }]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleAiSuggest() {
    if (!aiText.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const suggestion = await suggestEntry({
        text: aiText,
        today: todayYmd(),
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
      });

      if (suggestion.description !== null) setDescription(suggestion.description);
      if (suggestion.date !== null) setDate(suggestion.date);

      if (suggestion.debitAccountId === null && suggestion.creditAccountId === null) {
        setAiError("科目を推定できませんでした");
      } else {
        const amountText = suggestion.amount !== null ? String(suggestion.amount) : "";
        setLines((prev) => {
          const fallbackDebit = prev[0]?.accountId ?? accounts[0]?.id ?? "";
          const fallbackCredit = prev[1]?.accountId ?? fallbackDebit;
          return [
            { accountId: suggestion.debitAccountId ?? fallbackDebit, debit: amountText, credit: "" },
            { accountId: suggestion.creditAccountId ?? fallbackCredit, debit: "", credit: amountText },
          ];
        });
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  const debitTotal = lines.reduce((sum, l) => sum + toAmount(l.debit), 0);
  const creditTotal = lines.reduce((sum, l) => sum + toAmount(l.credit), 0);
  const diff = debitTotal - creditTotal;

  function handleSave() {
    const candidateLines: JournalLine[] = lines
      .map((l) => ({ accountId: l.accountId, debit: toAmount(l.debit), credit: toAmount(l.credit) }))
      .filter((l) => l.debit > 0 || l.credit > 0);

    const now = nowIso();
    const candidate: JournalEntry = {
      id: entry?.id ?? newEntryId(),
      date,
      description: description.trim(),
      lines: candidateLines,
      source: entry?.source ?? "manual",
      memo: memo.trim() ? memo.trim() : undefined,
      createdAt: entry?.createdAt ?? now,
      updatedAt: now,
    };

    const nextErrors = validateEntry(candidate);
    if (!description.trim()) nextErrors.push("摘要を入力してください");
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    upsertEntry(candidate);
    onClose();
  }

  return (
    <div
      class="ee-overlay"
      onPointerDown={(e) => {
        // テキスト選択のドラッグでオーバーレイ上に mouseup しても閉じないようにする
        pointerDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pointerDownOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="ee-panel"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "新規仕訳" : "仕訳を編集"}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="ee-header">
          <h2 class="ee-title">{isNew ? "新規仕訳" : "仕訳を編集"}</h2>
          <button type="button" class="ee-close" onClick={onClose} title="閉じる" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <div class="ee-body">
          <div class="ee-ai">
            <div class="ee-ai-row">
              <input
                class="ee-ai-input"
                value={aiText}
                placeholder="例: 昨日セブンでコーヒー300円を現金で"
                onInput={(e) => setAiText(e.currentTarget.value)}
                disabled={aiLoading}
              />
              <button
                type="button"
                class="ee-btn ee-btn-ghost ee-ai-btn"
                disabled={!aiText.trim() || aiLoading}
                onClick={handleAiSuggest}
              >
                <Sparkles size={14} /> AIで入力
              </button>
            </div>
            {aiLoading ? <p class="ee-ai-status">AIが考えています…</p> : null}
            {aiError ? <p class="ee-ai-error">{aiError}</p> : null}
          </div>

          <div class="ee-field-row">
            <label class="ee-field">
              <span>日付</span>
              <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
            </label>
            <label class="ee-field ee-field--grow">
              <span>摘要</span>
              <input
                value={description}
                placeholder="例: スーパーで食料品購入"
                onInput={(e) => setDescription(e.currentTarget.value)}
              />
            </label>
          </div>

          <label class="ee-field">
            <span>メモ</span>
            <textarea
              rows={2}
              value={memo}
              placeholder="任意"
              onInput={(e) => setMemo(e.currentTarget.value)}
            />
          </label>

          <div class="ee-lines-head">
            <span>仕訳行</span>
            <button type="button" class="ee-btn ee-btn-ghost" onClick={addLine}>
              <Plus size={14} /> 行を追加
            </button>
          </div>

          <div class="ee-lines">
            {lines.map((line, i) => (
              <div class="ee-line" key={i}>
                <select
                  class="ee-line-account"
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.currentTarget.value })}
                >
                  {groups.map((g) => (
                    <optgroup key={g.type} label={g.label}>
                      {g.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  class="ee-line-amount num"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="借方"
                  value={line.debit}
                  onInput={(e) => setDebit(i, e.currentTarget.value)}
                />
                <input
                  class="ee-line-amount num"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="貸方"
                  value={line.credit}
                  onInput={(e) => setCredit(i, e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="ee-line-remove"
                  disabled={lines.length <= 1}
                  onClick={() => removeLine(i)}
                  title="行を削除"
                  aria-label="行を削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div class="ee-totals">
            <div class="ee-totals-item">
              <span>借方合計</span>
              <span class="num">¥{debitTotal.toLocaleString("ja-JP")}</span>
            </div>
            <div class="ee-totals-item">
              <span>貸方合計</span>
              <span class="num">¥{creditTotal.toLocaleString("ja-JP")}</span>
            </div>
            <div class={`ee-totals-item ee-totals-diff${diff !== 0 ? " ee-totals-diff--bad" : ""}`}>
              <span>差額</span>
              <span class="num">¥{diff.toLocaleString("ja-JP")}</span>
            </div>
          </div>

          {errors.length > 0 ? (
            <ul class="ee-errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div class="ee-footer">
          {onDelete ? (
            <button type="button" class="ee-btn ee-btn-danger" onClick={onDelete}>
              <Trash2 size={15} /> 削除
            </button>
          ) : (
            <span />
          )}
          <div class="ee-footer-right">
            <button type="button" class="ee-btn ee-btn-ghost" onClick={onClose}>
              キャンセル
            </button>
            <button type="button" class="ee-btn ee-btn-primary" onClick={handleSave}>
              <Save size={15} /> 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
