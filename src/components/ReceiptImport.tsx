// TC Books — receipt OCR import button + modal (worker: ocr)
//
// Self-contained: owns its own open/close state, file picking/drop, the
// scan call, and the resulting quick-entry form. Consumers just drop
// <ReceiptImportButton onCreated={...} /> wherever the "quick add" affordance
// belongs (HomeView, JournalView).
//
// Also owns two extra behaviors:
//  - the result stage shows the receipt image side-by-side with the form
//    (click the image to zoom) so fields can be checked against the receipt.
//  - in-progress work is auto-saved as a "draft" (compressed image + form)
//    so closing the modal mid-input doesn't lose it; the pick stage lists
//    drafts to resume or delete.
//
// Scanning starts automatically the moment an image is loaded (fresh pick,
// drop, or resuming a "preview"-stage draft) — there's no manual "start"
// step in the happy path. The "preview" stage is kept around only as the
// scan-error fallback (image + error + 選び直す/読み取る). An AbortController
// ref + a monotonically increasing scan-sequence ref guard against stale
// scans: starting a new scan (or resetting/closing) aborts any in-flight
// one, and late-arriving results/errors from an aborted scan are ignored by
// comparing the sequence number captured at scan start. AbortError is
// treated as silent cancellation, never surfaced as scanError.

import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Check, CircleAlert, ImagePlus, LoaderCircle, RefreshCw, ScanLine, Trash2, X } from "lucide-preact";
import type { ImageInput } from "../lib/image";
import { compressImageDataUrl, readImageFile } from "../lib/image";
import { scanReceipt } from "../lib/ocr";
import type { ReceiptDraft, ReceiptDraftForm, ReceiptScan } from "../types";
import { paymentMethods, quickExpenseCategories } from "../lib/accounts";
import { buildQuickEntry, todayYmd, validateEntry } from "../lib/journal";
import { deleteReceiptDraft, loadReceiptDrafts, upsertEntry, upsertReceiptDraft } from "../lib/store";
import type { JournalEntry } from "../types";
import "../styles/ocr.css";

type Stage = "pick" | "preview" | "scanning" | "result" | "done";

type FormState = ReceiptDraftForm;

/** 現在進行中の下書きの識別情報。imageDataUrlは圧縮済みのものを都度使い回す */
interface DraftHandle {
  id: string;
  imageName: string;
  compressedDataUrl: string;
  createdAt: string;
}

const DRAFT_SAVE_DEBOUNCE_MS = 500;

function summarizeItems(scan: ReceiptScan): string {
  if (scan.items.length === 0) return "";
  return scan.items.map((item) => `${item.name} ${item.amount}円`).join("、");
}

function defaultMethodId(): string {
  const methods = paymentMethods();
  const cash = methods.find((account) => account.id === "cash");
  return cash?.id ?? methods[0]?.id ?? "";
}

function formFromScan(scan: ReceiptScan): FormState {
  const categories = quickExpenseCategories();
  const category = scan.suggestedAccountId && categories.some((c) => c.id === scan.suggestedAccountId)
    ? scan.suggestedAccountId
    : (categories[0]?.id ?? "");

  return {
    date: scan.date ?? todayYmd(),
    vendor: scan.vendor ?? "",
    amount: scan.total !== null ? String(scan.total) : "",
    categoryId: category,
    methodId: defaultMethodId(),
    memo: summarizeItems(scan),
  };
}

export function ReceiptImportButton(props: {
  label?: string;
  onCreated?: (entry: JournalEntry) => void;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("pick");
  const [image, setImage] = useState<ImageInput | null>(null);
  const [progressText, setProgressText] = useState("");
  const [ocrStage, setOcrStage] = useState<"transcribe" | "extract">("transcribe");
  const [scanError, setScanError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // オーバーレイでの mousedown がオーバーレイ自身から始まったかどうか
  const pointerDownOnOverlay = useRef(false);
  const draftRef = useRef<DraftHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<FormState | null>(null);
  // 実行中スキャンの中断用。新規スキャン開始・リセット・閉じる操作で abort する
  const abortRef = useRef<AbortController | null>(null);
  // 単調増加のスキャン世代カウンタ。中断/古いスキャンの結果が後から届いても
  // 現在の世代と一致しなければ無視する (stale result 対策)
  const scanSeqRef = useRef(0);

  function refreshDrafts() {
    setDrafts(loadReceiptDrafts());
  }

  function clearSaveTimer() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  function persistDraft(draftStage: ReceiptDraft["stage"], formValue: FormState | null) {
    const draft = draftRef.current;
    if (!draft) return;
    upsertReceiptDraft({
      id: draft.id,
      stage: draftStage,
      imageName: draft.imageName,
      imageDataUrl: draft.compressedDataUrl,
      form: formValue,
      createdAt: draft.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  /** 保留中のデバウンス保存があれば即座に反映し、タイマーを止める */
  function flushPendingSave() {
    if (saveTimerRef.current === null) return;
    clearSaveTimer();
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) persistDraft("result", pending);
  }

  function resetToPick() {
    // 実行中のスキャンがあれば中断し、以降届く結果/エラーを無視する
    abortRef.current?.abort();
    abortRef.current = null;
    scanSeqRef.current += 1;
    flushPendingSave();
    setStage("pick");
    setImage(null);
    setProgressText("");
    setOcrStage("transcribe");
    setScanError(null);
    setValidationErrors([]);
    setForm(null);
    setIsDragOver(false);
    setIsImageZoomed(false);
    setDraftId(null);
    draftRef.current = null;
    refreshDrafts();
  }

  function openModal() {
    resetToPick();
    setIsOpen(true);
  }

  function closeModal() {
    flushPendingSave();
    setIsOpen(false);
    resetToPick();
  }

  async function handleFile(file: File) {
    setScanError(null);
    try {
      const loaded = await readImageFile(file);
      setImage(loaded);

      // 画像が読み込めたら即座にスキャンを開始する (下書き保存を待たない)
      void startScan(loaded.dataUrl);

      // 下書き (圧縮画像 + stage "preview") の作成はスキャンと並行して行う。
      // スキャンの方が (LLMの往復があるぶん) 十分遅いので、ここでの await は
      // スキャン完了より先に draftRef.current / upsert を済ませる
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const compressedDataUrl = await compressImageDataUrl(loaded.dataUrl);
      draftRef.current = { id, imageName: loaded.name, compressedDataUrl, createdAt: now };
      setDraftId(id);
      upsertReceiptDraft({
        id,
        stage: "preview",
        imageName: loaded.name,
        imageDataUrl: compressedDataUrl,
        form: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      setScanError((error as Error).message);
    }
  }

  function resumeDraft(draft: ReceiptDraft) {
    draftRef.current = {
      id: draft.id,
      imageName: draft.imageName,
      compressedDataUrl: draft.imageDataUrl,
      createdAt: draft.createdAt,
    };
    setDraftId(draft.id);
    setImage({ name: draft.imageName, dataUrl: draft.imageDataUrl, size: 0 });
    setForm(draft.form);
    setScanError(null);
    setValidationErrors([]);
    setIsImageZoomed(false);
    if (draft.stage === "preview") {
      // プレビュー止まりの下書きは再開時も即スキャンを開始する
      void startScan(draft.imageDataUrl);
    } else {
      setStage(draft.stage);
    }
  }

  function handleDeleteDraft(id: string) {
    deleteReceiptDraft(id);
    refreshDrafts();
  }

  function onPickFile(event: JSX.TargetedEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) void handleFile(file);
    event.currentTarget.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) void handleFile(file);
  }

  async function startScan(dataUrl: string) {
    // 前のスキャンが実行中なら中断してから新しい世代を始める
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = (scanSeqRef.current += 1);

    setStage("scanning");
    setProgressText("");
    setOcrStage("transcribe");
    setScanError(null);

    try {
      const scan = await scanReceipt(dataUrl, {
        onDelta: (full) => {
          if (scanSeqRef.current !== seq) return;
          setProgressText(full);
        },
        onStage: (nextStage) => {
          if (scanSeqRef.current !== seq) return;
          setOcrStage(nextStage);
          setProgressText("");
        },
        signal: controller.signal,
      });
      if (scanSeqRef.current !== seq) return; // 中断済み/世代が進んだ結果は無視
      const nextForm = formFromScan(scan);
      setForm(nextForm);
      setStage("result");
      persistDraft("result", nextForm);
    } catch (error) {
      if (scanSeqRef.current !== seq) return;
      if ((error as Error).name === "AbortError") return; // ユーザーによる中断は無音で無視
      setScanError((error as Error).message);
      setStage("preview");
    }
  }

  /** プレビュー段 (スキャンエラー後) の「読み取る」リトライボタン */
  function runScan() {
    if (!image) return;
    void startScan(image.dataUrl);
  }

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      clearSaveTimer();
      pendingSaveRef.current = next;
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        pendingSaveRef.current = null;
        persistDraft("result", next);
      }, DRAFT_SAVE_DEBOUNCE_MS);
      return next;
    });
  }

  function submitEntry() {
    if (!form) return;
    const amount = Math.round(Number(form.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setValidationErrors(["金額は1円以上の数値を入力してください。"]);
      return;
    }
    if (!form.categoryId) {
      setValidationErrors(["カテゴリを選択してください。"]);
      return;
    }
    if (!form.methodId) {
      setValidationErrors(["支払方法を選択してください。"]);
      return;
    }

    const entry = buildQuickEntry({
      kind: "expense",
      date: form.date,
      amount,
      categoryAccountId: form.categoryId,
      methodAccountId: form.methodId,
      description: form.vendor.trim() || "領収書",
      source: "ocr",
    });
    if (form.memo.trim()) entry.memo = form.memo.trim();

    const errors = validateEntry(entry);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    upsertEntry(entry);
    props.onCreated?.(entry);

    clearSaveTimer();
    pendingSaveRef.current = null;
    if (draftId) deleteReceiptDraft(draftId);
    draftRef.current = null;
    setDraftId(null);
    setStage("done");
  }

  if (!isOpen) {
    return (
      <button type="button" class="ocr-trigger" onClick={openModal}>
        <ScanLine size={16} />
        {props.label ?? "領収書を読み取り"}
      </button>
    );
  }

  const categories = quickExpenseCategories();
  const methods = paymentMethods();

  return (
    <div
      class="ocr-overlay"
      onPointerDown={(event) => {
        pointerDownOnOverlay.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // テキスト選択のドラッグでオーバーレイ上に mouseup しても閉じないようにする
        if (pointerDownOnOverlay.current && event.target === event.currentTarget) closeModal();
      }}
    >
      <div
        class={`ocr-modal${stage === "result" ? " ocr-modal-wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="ocr-modal-header">
          <h3>領収書を読み取り</h3>
          <button type="button" class="ocr-icon-btn" onClick={closeModal} aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <div class="ocr-modal-body">
          {stage === "pick" && (
            <>
              <div
                class={`ocr-dropzone${isDragOver ? " ocr-dropzone-active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={28} />
                <p>画像をドラッグ&ドロップ、またはクリックして選択</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  class="ocr-file-input"
                  onChange={onPickFile}
                />
              </div>

              {drafts.length > 0 && (
                <div class="ocr-draft-list">
                  <h4 class="ocr-draft-list-title">保存された下書き</h4>
                  <ul>
                    {drafts.map((draft) => (
                      <li key={draft.id} class="ocr-draft-item">
                        <img src={draft.imageDataUrl} alt={draft.imageName} class="ocr-draft-thumb" />
                        <div class="ocr-draft-info">
                          <p class="ocr-draft-primary">
                            {draft.form?.vendor || draft.imageName || "領収書"}
                          </p>
                          <p class="ocr-draft-secondary">
                            {draft.form?.amount ? `${draft.form.amount}円 ・ ` : ""}
                            {new Date(draft.updatedAt).toLocaleString("ja-JP")}
                          </p>
                        </div>
                        <div class="ocr-draft-actions">
                          <button type="button" class="ocr-secondary-btn" onClick={() => resumeDraft(draft)}>
                            再開
                          </button>
                          <button
                            type="button"
                            class="ocr-icon-btn"
                            aria-label="下書きを削除"
                            onClick={() => handleDeleteDraft(draft.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {(stage === "preview" || stage === "scanning") && image && (
            <div class="ocr-preview">
              <img src={image.dataUrl} alt={image.name} class="ocr-preview-img" />
              {stage === "scanning" ? (
                <div class="ocr-scanning">
                  <p class="ocr-scanning-status">
                    <LoaderCircle size={16} class="ocr-spin" />
                    {ocrStage === "extract" ? "解析中…" : "文字起こし中…"}
                  </p>
                  {progressText && <pre class="ocr-progress-text">{progressText}</pre>}
                  <div class="ocr-preview-actions">
                    <button type="button" class="ocr-secondary-btn" onClick={resetToPick}>
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div class="ocr-preview-actions">
                  <button type="button" class="ocr-secondary-btn" onClick={resetToPick}>
                    選び直す
                  </button>
                  <button type="button" class="ocr-primary-btn" onClick={runScan}>
                    <ScanLine size={16} />
                    読み取る
                  </button>
                </div>
              )}
            </div>
          )}

          {stage === "result" && form && image && (
            <div class="ocr-result-columns">
              <div class="ocr-result-image-pane">
                <div
                  class={`ocr-result-image${isImageZoomed ? " ocr-result-image-zoomed" : ""}`}
                  onClick={() => setIsImageZoomed((zoomed) => !zoomed)}
                >
                  <img src={image.dataUrl} alt={image.name} />
                </div>
                <p class="ocr-result-image-hint">クリックで拡大</p>
              </div>
              <div class="ocr-result-form">
                <label class="ocr-field">
                  <span>日付</span>
                  <input
                    type="date"
                    value={form.date}
                    onInput={(event) => updateForm({ date: event.currentTarget.value })}
                  />
                </label>
                <label class="ocr-field">
                  <span>店名</span>
                  <input
                    type="text"
                    value={form.vendor}
                    placeholder="店名"
                    onInput={(event) => updateForm({ vendor: event.currentTarget.value })}
                  />
                </label>
                <label class="ocr-field">
                  <span>金額</span>
                  <input
                    type="number"
                    class="num"
                    value={form.amount}
                    min="0"
                    step="1"
                    onInput={(event) => updateForm({ amount: event.currentTarget.value })}
                  />
                </label>
                <label class="ocr-field">
                  <span>カテゴリ</span>
                  <select
                    value={form.categoryId}
                    onChange={(event) => updateForm({ categoryId: event.currentTarget.value })}
                  >
                    {categories.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="ocr-field">
                  <span>支払方法</span>
                  <select
                    value={form.methodId}
                    onChange={(event) => updateForm({ methodId: event.currentTarget.value })}
                  >
                    {methods.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="ocr-field">
                  <span>メモ</span>
                  <textarea
                    value={form.memo}
                    rows={2}
                    onInput={(event) => updateForm({ memo: event.currentTarget.value })}
                  />
                </label>

                {validationErrors.length > 0 && (
                  <div class="ocr-error">
                    <CircleAlert size={16} />
                    <ul>
                      {validationErrors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div class="ocr-result-actions">
                  <button type="button" class="ocr-secondary-btn" onClick={resetToPick}>
                    選び直す
                  </button>
                  <button type="button" class="ocr-primary-btn" onClick={submitEntry}>
                    仕訳を登録
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === "done" && (
            <div class="ocr-done">
              <p class="ocr-done-message">
                <Check size={18} />
                仕訳を登録しました。
              </p>
              <div class="ocr-result-actions">
                <button type="button" class="ocr-secondary-btn" onClick={closeModal}>
                  閉じる
                </button>
                <button type="button" class="ocr-primary-btn" onClick={resetToPick}>
                  <RefreshCw size={16} />
                  続けて読み取る
                </button>
              </div>
            </div>
          )}

          {scanError && (
            <div class="ocr-error">
              <CircleAlert size={16} />
              <span>{scanError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
