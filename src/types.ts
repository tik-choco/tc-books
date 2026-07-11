// TC Books — shared domain types. Every module and view builds on these;
// the module-level API contracts live in docs/CONTRACTS.md.
//
// Money is always an integer amount of yen. Dates are "YYYY-MM-DD" strings,
// months are "YYYY-MM", timestamps are ISO 8601.

export type MainTab = "home" | "journal" | "ledger" | "reports" | "settings";

/** 勘定科目の5分類。正残高: asset/expense=借方, liability/equity/revenue=貸方 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  /** 安定ID。標準科目は英語ケバブ (例 "cash", "food"), 追加科目はUUID */
  id: string;
  /** 並び順を決める科目コード (例 "101")。表示にも使う */
  code: string;
  /** 勘定科目名 (現金, 食費, 売上高 …) */
  name: string;
  type: AccountType;
  /** 家計簿クイック入力のカテゴリ候補に出す (revenue/expense のみ意味を持つ) */
  quickCategory?: boolean;
  /** 支払い/受取の手段候補に出す (asset/liability のみ意味を持つ) */
  paymentMethod?: boolean;
  /** ユーザー追加の科目 (tc-books:accounts-v1 に保存される) */
  isCustom?: boolean;
  /** アーカイブ済み: 新規入力の候補に出さないが過去仕訳の表示には使う */
  archived?: boolean;
}

/** 仕訳の1行。debit / credit はどちらか一方だけが正の整数、他方は 0 */
export interface JournalLine {
  accountId: string;
  debit: number;
  credit: number;
}

export type EntrySource = "manual" | "quick" | "ocr";

/** 複式簿記の仕訳。常に 借方合計 === 貸方合計 を満たす */
export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  /** 摘要 */
  description: string;
  lines: JournalLine[];
  source: EntrySource;
  memo?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** バックアップ/エクスポートに使う帳簿全体のバンドル (アクティブ帳簿単体のスナップショット) */
export interface BooksBundle {
  v: 1;
  entries: JournalEntry[];
  customAccounts: Account[];
  exportedAt: string; // ISO 8601
}

/** 帳簿の種別。標準勘定科目テンプレートの選択に使う */
export type BookKind = "household" | "circle" | "business";

/** 1つの組織/用途に対応する帳簿。全ドメインデータは帳簿単位で分離される */
export interface Book {
  id: string; // "default" または UUID
  name: string; // 表示名 (例 "家計", "〇〇サークル")
  kind: BookKind;
  createdAt: string; // ISO 8601
}

/** 全帳簿バックアップ (booksBackupPublisher が publish するペイロード v2) */
export interface BookBackup {
  book: Book;
  entries: JournalEntry[];
  customAccounts: Account[];
}

/** バックアップ/エクスポートに使う全帳簿分のバンドル */
export interface MultiBookBundle {
  v: 2;
  books: BookBackup[];
  exportedAt: string; // ISO 8601
}

/** 期間指定 (両端含む)。省略側は無制限 */
export interface DateRange {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

/** 集計結果の1科目分 */
export interface AccountBalance {
  account: Account;
  /** 期間内の借方合計 */
  debit: number;
  /** 期間内の貸方合計 */
  credit: number;
  /** 正残高側から見た残高 (asset/expense: debit-credit, その他: credit-debit) */
  balance: number;
}

/** 領収書OCRの解析結果。取れなかったフィールドは null / 空配列 */
export interface ReceiptScanItem {
  name: string;
  amount: number;
}

export interface ReceiptScan {
  date: string | null; // YYYY-MM-DD
  vendor: string | null;
  total: number | null;
  tax: number | null;
  items: ReceiptScanItem[];
  /** LLMが提案した費用/収益カテゴリの accountId (標準科目のみ) */
  suggestedAccountId: string | null;
  /** LLMの生テキスト (デバッグ/再パース用) */
  raw: string;
  /** Stage1の文字起こし全文 (取得できなければ "") */
  transcript: string;
}

/** 領収書読み取りモーダルの下書きフォーム値（文字列のまま保持） */
export interface ReceiptDraftForm {
  date: string;
  vendor: string;
  amount: string;
  categoryId: string;
  methodId: string;
  memo: string;
}

/** 領収書読み取りの下書き。閉じても再開できるよう自動保存される */
export interface ReceiptDraft {
  id: string;
  /** 復元先ステージ: 画像のみ=preview, スキャン済みフォームあり=result */
  stage: "preview" | "result";
  imageName: string;
  /** 縮小保存された画像 data URL */
  imageDataUrl: string;
  form: ReceiptDraftForm | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
