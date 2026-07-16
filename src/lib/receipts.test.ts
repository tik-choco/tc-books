import { beforeEach, describe, expect, it } from "vitest";
import type { IssuedReceipt, ReceiptIssueInput } from "../types";
import {
  buildIssuedReceipt,
  buildReceiptJournalEntry,
  formatPayerName,
  formatReceiptNo,
  formatYen,
  newReceiptId,
  validateReceiptInput,
} from "./receipts";
import {
  createBook,
  deleteBook,
  deleteIssuedReceipt,
  loadIssuedReceipts,
  loadReceiptIssuerName,
  nextReceiptIssueNo,
  saveReceiptIssuerName,
  setActiveBook,
  upsertIssuedReceipt,
} from "./store";

function baseInput(overrides: Partial<ReceiptIssueInput> = {}): ReceiptIssueInput {
  return {
    payerName: "山田太郎",
    amount: 5000,
    issueDate: "2026-07-16",
    note: "お品代として",
    issuerName: "発行者花子",
    ...overrides,
  };
}

function baseReceipt(overrides: Partial<IssuedReceipt> = {}): IssuedReceipt {
  return {
    ...baseInput(),
    id: "r1",
    issueNo: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("formatReceiptNo", () => {
  it("4桁ゼロ埋め", () => {
    expect(formatReceiptNo(1)).toBe("No. 0001");
    expect(formatReceiptNo(42)).toBe("No. 0042");
    expect(formatReceiptNo(123)).toBe("No. 0123");
  });

  it("5桁以上はそのまま", () => {
    expect(formatReceiptNo(12345)).toBe("No. 12345");
  });
});

describe("formatYen", () => {
  it("3桁区切りで¥をつける", () => {
    expect(formatYen(12345)).toBe("¥12,345");
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(1000000)).toBe("¥1,000,000");
  });
});

describe("formatPayerName", () => {
  it("通常の名前には「 様」を付与", () => {
    expect(formatPayerName("山田太郎")).toBe("山田太郎 様");
  });

  it("末尾が「様」ならそのまま", () => {
    expect(formatPayerName("上様")).toBe("上様");
  });
});

describe("validateReceiptInput", () => {
  it("正常な入力はエラーなし", () => {
    expect(validateReceiptInput(baseInput())).toEqual([]);
  });

  it("宛名が空/空白のみだとエラー", () => {
    expect(validateReceiptInput(baseInput({ payerName: "" })).some((e) => e.includes("宛名"))).toBe(true);
    expect(validateReceiptInput(baseInput({ payerName: "   " })).some((e) => e.includes("宛名"))).toBe(true);
  });

  it("金額が0以下または非整数だとエラー", () => {
    expect(validateReceiptInput(baseInput({ amount: 0 })).some((e) => e.includes("金額"))).toBe(true);
    expect(validateReceiptInput(baseInput({ amount: -100 })).some((e) => e.includes("金額"))).toBe(true);
    expect(validateReceiptInput(baseInput({ amount: 100.5 })).some((e) => e.includes("金額"))).toBe(true);
  });

  it("発行日がYYYY-MM-DD形式でないとエラー", () => {
    expect(validateReceiptInput(baseInput({ issueDate: "2026/07/16" })).some((e) => e.includes("発行日"))).toBe(true);
  });

  it("但し書きが空だとエラー", () => {
    expect(validateReceiptInput(baseInput({ note: "" })).some((e) => e.includes("但し書き"))).toBe(true);
  });

  it("発行者名が空だとエラー", () => {
    expect(validateReceiptInput(baseInput({ issuerName: "" })).some((e) => e.includes("発行者名"))).toBe(true);
  });
});

describe("buildIssuedReceipt", () => {
  it("入力値をコピーしid/issueNo/createdAtを採番する", () => {
    const input = baseInput();
    const receipt = buildIssuedReceipt(input, 7);
    expect(receipt.payerName).toBe(input.payerName);
    expect(receipt.amount).toBe(input.amount);
    expect(receipt.issueDate).toBe(input.issueDate);
    expect(receipt.note).toBe(input.note);
    expect(receipt.issuerName).toBe(input.issuerName);
    expect(receipt.issueNo).toBe(7);
    expect(typeof receipt.id).toBe("string");
    expect(receipt.id.length).toBeGreaterThan(0);
    expect(() => new Date(receipt.createdAt).toISOString()).not.toThrow();
  });

  it("金額はtruncされる", () => {
    const receipt = buildIssuedReceipt(baseInput({ amount: 1000.9 }), 1);
    expect(receipt.amount).toBe(1000);
  });

  it("newReceiptIdはユニークな文字列を返す", () => {
    expect(newReceiptId()).not.toBe(newReceiptId());
  });
});

describe("buildReceiptJournalEntry", () => {
  it("借方=受取手段、貸方=収益科目のバランスした仕訳を返す", () => {
    const receipt = baseReceipt({ amount: 3000, issueDate: "2026-07-10", issueNo: 5, payerName: "上様" });
    const entry = buildReceiptJournalEntry(receipt, "cash", "sales");
    expect(entry.lines).toEqual([
      { accountId: "cash", debit: 3000, credit: 0 },
      { accountId: "sales", debit: 0, credit: 3000 },
    ]);
    expect(entry.date).toBe("2026-07-10");
    expect(entry.source).toBe("receipt");
    expect(entry.description).toContain("No. 0005");
    expect(entry.description).toContain("上様");
  });
});

describe("store: 発行済み領収書", () => {
  it("upsert/load: issueNo降順で返る", () => {
    upsertIssuedReceipt(baseReceipt({ id: "r1", issueNo: 1 }));
    upsertIssuedReceipt(baseReceipt({ id: "r2", issueNo: 3 }));
    upsertIssuedReceipt(baseReceipt({ id: "r3", issueNo: 2 }));
    expect(loadIssuedReceipts().map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("upsert: id一致で置換", () => {
    upsertIssuedReceipt(baseReceipt({ id: "r1", issueNo: 1, payerName: "山田太郎" }));
    upsertIssuedReceipt(baseReceipt({ id: "r1", issueNo: 1, payerName: "田中花子" }));
    const receipts = loadIssuedReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].payerName).toBe("田中花子");
  });

  it("delete: 指定idのみ削除", () => {
    upsertIssuedReceipt(baseReceipt({ id: "r1", issueNo: 1 }));
    upsertIssuedReceipt(baseReceipt({ id: "r2", issueNo: 2 }));
    deleteIssuedReceipt("r1");
    expect(loadIssuedReceipts().map((r) => r.id)).toEqual(["r2"]);
  });

  it("nextReceiptIssueNo: 空なら1、既存があればmax+1", () => {
    expect(nextReceiptIssueNo()).toBe(1);
    upsertIssuedReceipt(baseReceipt({ id: "r1", issueNo: 1 }));
    upsertIssuedReceipt(baseReceipt({ id: "r2", issueNo: 5 }));
    expect(nextReceiptIssueNo()).toBe(6);
  });

  it("帳簿ごとに分離される (receipts + issuer name)", () => {
    upsertIssuedReceipt(baseReceipt({ id: "default-r", issueNo: 1 }));
    saveReceiptIssuerName("デフォルト発行者");
    expect(loadIssuedReceipts().map((r) => r.id)).toEqual(["default-r"]);
    expect(loadReceiptIssuerName()).toBe("デフォルト発行者");

    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    expect(loadIssuedReceipts()).toEqual([]);
    expect(loadReceiptIssuerName()).toBe("");

    upsertIssuedReceipt(baseReceipt({ id: "book2-r", issueNo: 1 }));
    saveReceiptIssuerName("サークル発行者");
    expect(loadIssuedReceipts().map((r) => r.id)).toEqual(["book2-r"]);
    expect(loadReceiptIssuerName()).toBe("サークル発行者");

    setActiveBook("default");
    expect(loadIssuedReceipts().map((r) => r.id)).toEqual(["default-r"]);
    expect(loadReceiptIssuerName()).toBe("デフォルト発行者");
  });

  it("deleteBook: 削除した帳簿のreceipts/issuer-nameキーも消える", () => {
    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    upsertIssuedReceipt(baseReceipt({ id: "book2-r", issueNo: 1 }));
    saveReceiptIssuerName("サークル発行者");
    expect(localStorage.getItem(`tc-books:issued-receipts-v1:${book2.id}`)).not.toBeNull();
    expect(localStorage.getItem(`tc-books:receipt-issuer-v1:${book2.id}`)).not.toBeNull();

    setActiveBook("default");
    deleteBook(book2.id);

    expect(localStorage.getItem(`tc-books:issued-receipts-v1:${book2.id}`)).toBeNull();
    expect(localStorage.getItem(`tc-books:receipt-issuer-v1:${book2.id}`)).toBeNull();
  });

  it("不正なJSONはloadIssuedReceiptsが[]を返す (throwしない)", () => {
    localStorage.setItem("tc-books:issued-receipts-v1:default", "{not valid json");
    expect(() => loadIssuedReceipts()).not.toThrow();
    expect(loadIssuedReceipts()).toEqual([]);
  });

  it("形の壊れたレコードはスキップされる (throwしない)", () => {
    localStorage.setItem(
      "tc-books:issued-receipts-v1:default",
      JSON.stringify({
        v: 1,
        receipts: [
          null,
          "not-an-object",
          { id: "", issueNo: 1 }, // id空
          { id: "bad-issueno", issueNo: 0 }, // issueNo < 1
          { id: "bad-issueno-2", issueNo: -3 },
          { id: "ok1", issueNo: 2.9 }, // truncして2
        ],
      }),
    );
    const receipts = loadIssuedReceipts();
    expect(receipts.map((r) => r.id)).toEqual(["ok1"]);
    expect(receipts[0].issueNo).toBe(2);
    expect(receipts[0].amount).toBe(0);
    expect(receipts[0].payerName).toBe("");
  });

  it("journalEntryIdは非空文字列のときのみ保持される", () => {
    localStorage.setItem(
      "tc-books:issued-receipts-v1:default",
      JSON.stringify({
        v: 1,
        receipts: [
          { id: "with-je", issueNo: 1, journalEntryId: "e1" },
          { id: "without-je", issueNo: 2, journalEntryId: "" },
          { id: "bad-je-type", issueNo: 3, journalEntryId: 42 },
        ],
      }),
    );
    const receipts = loadIssuedReceipts();
    expect(receipts.find((r) => r.id === "with-je")?.journalEntryId).toBe("e1");
    expect(receipts.find((r) => r.id === "without-je")?.journalEntryId).toBeUndefined();
    expect(receipts.find((r) => r.id === "bad-je-type")?.journalEntryId).toBeUndefined();
  });

  it("loadReceiptIssuerName: 保存が無ければ空文字、不正な形も空文字", () => {
    expect(loadReceiptIssuerName()).toBe("");
    localStorage.setItem("tc-books:receipt-issuer-v1:default", "{not valid json");
    expect(loadReceiptIssuerName()).toBe("");
    localStorage.setItem("tc-books:receipt-issuer-v1:default", JSON.stringify({ v: 1, name: 42 }));
    expect(loadReceiptIssuerName()).toBe("");
  });

  it("saveReceiptIssuerName/loadReceiptIssuerName: roundtrip", () => {
    saveReceiptIssuerName("屋号 テスト商店");
    expect(loadReceiptIssuerName()).toBe("屋号 テスト商店");
  });
});
