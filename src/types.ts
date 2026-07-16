// TC Books — shared domain types. Every module and view builds on these;
// the module-level API contracts live in docs/CONTRACTS.md.
//
// Money is always an integer amount of yen. Dates are "YYYY-MM-DD" strings,
// months are "YYYY-MM", timestamps are ISO 8601.

export type MainTab = "home" | "journal" | "ledger" | "reports" | "receipts" | "settings";

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

/** 仕訳の出所。"receipt" は領収書発行時の「仕訳にも記録」で作成されたもの */
export type EntrySource = "manual" | "quick" | "ocr" | "receipt";

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

/** 領収書発行フォームの入力値。id・連番・作成時刻は発行時に採番される */
export interface ReceiptIssueInput {
  /** 宛名。表示時に "様" を付ける本体部分 (例 "山田太郎")。"上様" もそのまま入る */
  payerName: string;
  /** 税込金額 (整数円) */
  amount: number;
  /** 発行日 */
  issueDate: string; // YYYY-MM-DD
  /** 但し書き (例 "お品代として") */
  note: string;
  /** 発行者名 (自分側の氏名/屋号)。前回発行時の値が保存されプレフィルされる */
  issuerName: string;
}

/** 発行済み領収書。帳簿単位で保存され、履歴から再印刷/削除できる */
export interface IssuedReceipt extends ReceiptIssueInput {
  id: string;
  /** 帳簿内の発行連番 (1始まり)。表示形式は formatReceiptNo() が決める */
  issueNo: number;
  /** 「売上として仕訳にも記録」で作成した仕訳のid (作成しなかった場合は未設定) */
  journalEntryId?: string;
  createdAt: string; // ISO 8601
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
