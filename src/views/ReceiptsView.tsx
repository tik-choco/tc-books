// 領収書発行ビュー: 発行履歴テーブル + 新規発行フォーム(モーダル) + 印刷プレビュー。
// データは store.ts を直読みし、subscribeBooks で他タブ等の変更を即座に反映する
// （props無し・自己完結、docs/CONTRACTS.md の Views 節を参照）。
// 印刷はPDFライブラリを使わず window.print() + @media print CSSに委譲する
// （既存のReceiptImport＝受け取った領収書のOCR取り込みとは別物）。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { ImageDown, Plus, Printer, ReceiptJapaneseYen, Trash2, X } from "lucide-preact";
import type { IssuedReceipt, ReceiptIssueInput } from "../types";
import {
  deleteIssuedReceipt,
  loadIssuedReceipts,
  loadReceiptIssuerName,
  nextReceiptIssueNo,
  saveReceiptIssuerName,
  subscribeBooks,
  upsertEntry,
  upsertIssuedReceipt,
} from "../lib/store";
import {
  buildIssuedReceipt,
  buildReceiptJournalEntry,
  formatPayerName,
  formatReceiptNo,
  formatYen,
  validateReceiptInput,
} from "../lib/receipts";
import { downloadBlob, receiptPngFileName, receiptSheetToPngBlob } from "../lib/receiptImage";
import { paymentMethods, quickIncomeCategories } from "../lib/accounts";
import { todayYmd, validateEntry } from "../lib/journal";
import { ReceiptPrintable } from "../components/ReceiptPrintable";
import "../styles/receipts.css";

type ModalState = { kind: "form" } | { kind: "preview"; receipt: IssuedReceipt } | null;

function triggerPrint() {
  document.body.classList.add("receipt-printing");
  function onAfterPrint() {
    document.body.classList.remove("receipt-printing");
    window.removeEventListener("afterprint", onAfterPrint);
  }
  window.addEventListener("afterprint", onAfterPrint);
  window.print();
  // フォールバック: afterprint を発火しないブラウザ向けに、
  // (ブロッキングである前提の) print() が戻った直後にも解除しておく。
  document.body.classList.remove("receipt-printing");
}

export function ReceiptsView(): JSX.Element {
  const [receipts, setReceipts] = useState<IssuedReceipt[]>(() => loadIssuedReceipts());
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => subscribeBooks(() => setReceipts(loadIssuedReceipts())), []);

  function openForm() {
    setModal({ kind: "form" });
  }

  function openPreview(receipt: IssuedReceipt) {
    setModal({ kind: "preview", receipt });
  }

  function closeModal() {
    setModal(null);
  }

  function handleDelete(receipt: IssuedReceipt) {
    const ok = confirm(
      `この領収書を削除しますか?\n${formatReceiptNo(receipt.issueNo)} ${formatPayerName(receipt.payerName)}\n※紐づく仕訳がある場合、仕訳は削除されません`,
    );
    if (!ok) return;
    deleteIssuedReceipt(receipt.id);
  }

  function handleIssued(receipt: IssuedReceipt) {
    setModal({ kind: "preview", receipt });
  }

  return (
    <div class="rv-view">
      <div class="rv-inner">
        <div class="rv-toolbar">
          <div class="rv-heading">
            <span class="rv-title">領収書発行</span>
            <span class="rv-subtitle">受け取った金銭に対して、相手に渡す領収書を発行します</span>
          </div>
          <div class="rv-actions">
            <button type="button" class="rv-btn rv-btn-primary" onClick={openForm}>
              <Plus size={15} /> 新規発行
            </button>
          </div>
        </div>

        {receipts.length === 0 ? (
          <div class="rv-empty">
            <ReceiptJapaneseYen size={28} />
            <p class="rv-empty-title">まだ発行した領収書がありません</p>
            <p class="rv-empty-sub">上の「新規発行」から領収書を作成できます。</p>
          </div>
        ) : (
          <div class="rv-table-wrap">
            <table class="rv-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>発行日</th>
                  <th>宛名</th>
                  <th>金額</th>
                  <th>但し書き</th>
                  <th>仕訳</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td class="rv-no">{formatReceiptNo(r.issueNo)}</td>
                    <td class="rv-date">{r.issueDate}</td>
                    <td>{formatPayerName(r.payerName)}</td>
                    <td class="num">{formatYen(r.amount)}</td>
                    <td class="rv-note-cell">{r.note}</td>
                    <td>
                      {r.journalEntryId ? (
                        <span class="rv-badge">仕訳済</span>
                      ) : (
                        <span class="rv-badge rv-badge--none">—</span>
                      )}
                    </td>
                    <td>
                      <div class="rv-row-actions">
                        <button
                          type="button"
                          class="rv-icon-btn"
                          onClick={() => openPreview(r)}
                          title="印刷"
                          aria-label="印刷"
                        >
                          <Printer size={15} />
                        </button>
                        <button
                          type="button"
                          class="rv-icon-btn rv-icon-btn--danger"
                          onClick={() => handleDelete(r)}
                          title="削除"
                          aria-label="削除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.kind === "form" ? <ReceiptIssueForm onClose={closeModal} onIssued={handleIssued} /> : null}
      {modal?.kind === "preview" ? <ReceiptPreviewModal receipt={modal.receipt} onClose={closeModal} /> : null}
    </div>
  );
}

function ReceiptIssueForm(props: { onClose: () => void; onIssued: (receipt: IssuedReceipt) => void }): JSX.Element {
  const { onClose, onIssued } = props;

  const methods = useMemo(() => paymentMethods(), []);
  const incomeCategories = useMemo(() => quickIncomeCategories(), []);

  const [payerName, setPayerName] = useState("");
  const [amount, setAmount] = useState("");
  const [issueDate, setIssueDate] = useState(todayYmd());
  const [note, setNote] = useState("お品代として");
  const [issuerName, setIssuerName] = useState(() => loadReceiptIssuerName());
  const [recordJournal, setRecordJournal] = useState(false);
  const [methodId, setMethodId] = useState(
    () => methods.find((a) => a.id === "cash")?.id ?? methods[0]?.id ?? "",
  );
  const [revenueId, setRevenueId] = useState(
    () => incomeCategories.find((a) => a.id === "sales")?.id ?? incomeCategories[0]?.id ?? "",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const pointerDownOnOverlay = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleSubmit() {
    const input: ReceiptIssueInput = {
      payerName: payerName.trim(),
      amount: Math.trunc(Number(amount)) || 0,
      issueDate,
      note: note.trim(),
      issuerName: issuerName.trim(),
    };

    const inputErrors = validateReceiptInput(input);
    if (inputErrors.length > 0) {
      setErrors(inputErrors);
      return;
    }

    const issueNo = nextReceiptIssueNo();
    let receipt = buildIssuedReceipt(input, issueNo);

    if (recordJournal) {
      const entry = buildReceiptJournalEntry(receipt, methodId, revenueId);
      const entryErrors = validateEntry(entry);
      if (entryErrors.length > 0) {
        setErrors(entryErrors);
        return;
      }
      upsertEntry(entry);
      receipt = { ...receipt, journalEntryId: entry.id };
    }

    upsertIssuedReceipt(receipt);
    saveReceiptIssuerName(input.issuerName);
    onIssued(receipt);
  }

  return (
    <div
      class="rv-overlay"
      onPointerDown={(e) => {
        // テキスト選択のドラッグでオーバーレイ上に mouseup しても閉じないようにする
        pointerDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pointerDownOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div class="rv-panel" role="dialog" aria-modal="true" aria-label="新規発行" onClick={(e) => e.stopPropagation()}>
        <div class="rv-modal-header">
          <h2 class="rv-modal-title">領収書を発行</h2>
          <button type="button" class="rv-close" onClick={onClose} title="閉じる" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <div class="rv-modal-body">
          <div class="rv-payer-row">
            <label class="rv-field">
              <span>宛名</span>
              <input
                value={payerName}
                placeholder="例: 山田太郎"
                onInput={(e) => setPayerName(e.currentTarget.value)}
              />
            </label>
            <button type="button" class="rv-inline-btn" onClick={() => setPayerName("上様")}>
              上様
            </button>
          </div>

          <div class="rv-field-row">
            <label class="rv-field">
              <span>金額</span>
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                placeholder="0"
                onInput={(e) => setAmount(e.currentTarget.value)}
              />
            </label>
            <label class="rv-field">
              <span>発行日</span>
              <input type="date" value={issueDate} onInput={(e) => setIssueDate(e.currentTarget.value)} />
            </label>
          </div>

          <label class="rv-field">
            <span>但し書き</span>
            <input value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </label>

          <label class="rv-field">
            <span>発行者名</span>
            <input
              value={issuerName}
              placeholder="例: 山田花子 / 〇〇サークル"
              onInput={(e) => setIssuerName(e.currentTarget.value)}
            />
          </label>

          <label class="rv-checkbox-field">
            <input
              type="checkbox"
              checked={recordJournal}
              onChange={(e) => setRecordJournal(e.currentTarget.checked)}
            />
            <span>売上として仕訳にも記録する</span>
          </label>

          {recordJournal ? (
            <div class="rv-journal-fields">
              <div class="rv-field-row">
                <label class="rv-field rv-field--grow">
                  <span>受取手段</span>
                  <select value={methodId} onChange={(e) => setMethodId(e.currentTarget.value)}>
                    {methods.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="rv-field rv-field--grow">
                  <span>収益科目</span>
                  <select value={revenueId} onChange={(e) => setRevenueId(e.currentTarget.value)}>
                    {incomeCategories.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {errors.length > 0 ? (
            <ul class="rv-errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div class="rv-modal-footer">
          <button type="button" class="rv-btn rv-btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" class="rv-btn rv-btn-primary" onClick={handleSubmit}>
            発行する
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptPreviewModal(props: { receipt: IssuedReceipt; onClose: () => void }): JSX.Element {
  const { receipt, onClose } = props;
  const pointerDownOnOverlay = useRef(false);
  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSavePng() {
    if (saving) return;
    const sheet = sheetWrapRef.current?.querySelector<HTMLElement>(".receipt-print-sheet");
    if (!sheet) return;
    setSaving(true);
    try {
      const blob = await receiptSheetToPngBlob(sheet);
      downloadBlob(blob, receiptPngFileName(receipt));
    } catch (e) {
      alert(
        "画像の保存に失敗しました。「印刷」からPDF保存もできます。\n" +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      class="rv-overlay"
      onPointerDown={(e) => {
        // テキスト選択のドラッグでオーバーレイ上に mouseup しても閉じないようにする
        pointerDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pointerDownOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="rv-panel rv-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-label="印刷プレビュー"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="rv-modal-header">
          <h2 class="rv-modal-title">印刷プレビュー</h2>
          <button type="button" class="rv-close" onClick={onClose} title="閉じる" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <div class="rv-modal-body rv-preview-body">
          <div ref={sheetWrapRef}>
            <ReceiptPrintable receipt={receipt} />
          </div>
        </div>

        <div class="rv-modal-footer">
          <button type="button" class="rv-btn rv-btn-ghost" onClick={onClose}>
            閉じる
          </button>
          <button type="button" class="rv-btn rv-btn-ghost" disabled={saving} onClick={handleSavePng}>
            <ImageDown size={15} /> {saving ? "保存中…" : "PNG保存"}
          </button>
          <button type="button" class="rv-btn rv-btn-primary" onClick={triggerPrint}>
            <Printer size={15} /> 印刷
          </button>
        </div>
      </div>
    </div>
  );
}
