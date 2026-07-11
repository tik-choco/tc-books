import { beforeEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "../types";
import {
  createBook,
  deleteBook,
  getActiveBook,
  getActiveBookId,
  loadBooks,
  loadEntries,
  loadMultiBookBundle,
  renameBook,
  setActiveBook,
  updateBookKind,
  upsertEntry,
} from "./store";

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    date: "2026-07-01",
    description: "ランチ",
    lines: [
      { accountId: "food", debit: 1000, credit: 0 },
      { accountId: "cash", debit: 0, credit: 1000 },
    ],
    source: "manual",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("legacy migration", () => {
  it("レガシーキーあり+レジストリなし → default帳簿が作られ、データが:defaultへ移行され、レガシーキーが消える", () => {
    localStorage.setItem("tc-books:journal-v1", JSON.stringify({ v: 1, entries: [baseEntry()] }));
    localStorage.setItem("tc-books:accounts-v1", JSON.stringify({ v: 1, accounts: [{ id: "cash", code: "101", name: "現金", type: "asset" }] }));
    localStorage.setItem("tc-books:receipt-drafts-v1", JSON.stringify({ v: 1, drafts: [] }));

    const books = loadBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: "default", name: "家計", kind: "household" });
    expect(getActiveBookId()).toBe("default");

    // legacy keys removed
    expect(localStorage.getItem("tc-books:journal-v1")).toBeNull();
    expect(localStorage.getItem("tc-books:accounts-v1")).toBeNull();
    expect(localStorage.getItem("tc-books:receipt-drafts-v1")).toBeNull();

    // data moved to namespaced default keys
    const entries = loadEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("e1");
    expect(localStorage.getItem("tc-books:journal-v1:default")).not.toBeNull();
  });

  it("レガシーキーが無い場合も default帳簿だけのレジストリが作られる", () => {
    const books = loadBooks();
    expect(books).toEqual([expect.objectContaining({ id: "default", name: "家計", kind: "household" })]);
    expect(getActiveBook().id).toBe("default");
    expect(loadEntries()).toEqual([]);
  });

  it("移行は冪等: 2回呼んでも壊れない", () => {
    localStorage.setItem("tc-books:journal-v1", JSON.stringify({ v: 1, entries: [baseEntry()] }));
    loadBooks();
    loadBooks();
    expect(loadEntries()).toHaveLength(1);
  });
});

describe("book separation", () => {
  it("createBook / setActiveBook 後、loadEntries/upsertEntry が帳簿ごとに分離される", () => {
    upsertEntry(baseEntry({ id: "default-entry" }));
    expect(loadEntries().map((e) => e.id)).toEqual(["default-entry"]);

    const book2 = createBook("サークルA", "circle");
    expect(loadBooks().map((b) => b.id)).toEqual(["default", book2.id]);
    // creating doesn't activate
    expect(getActiveBookId()).toBe("default");

    setActiveBook(book2.id);
    expect(getActiveBookId()).toBe(book2.id);
    expect(loadEntries()).toEqual([]); // new book starts empty

    upsertEntry(baseEntry({ id: "book2-entry" }));
    expect(loadEntries().map((e) => e.id)).toEqual(["book2-entry"]);

    setActiveBook("default");
    expect(loadEntries().map((e) => e.id)).toEqual(["default-entry"]);
  });

  it("setActiveBook: 未知IDはno-op", () => {
    createBook("サークルA", "circle");
    setActiveBook("nonexistent-id");
    expect(getActiveBookId()).toBe("default");
  });

  it("renameBook: 指定帳簿の名前だけ変わる", () => {
    const book2 = createBook("サークルA", "circle");
    renameBook(book2.id, "改名後");
    expect(loadBooks().find((b) => b.id === book2.id)?.name).toBe("改名後");
    expect(loadBooks().find((b) => b.id === "default")?.name).toBe("家計");
  });

  it("updateBookKind: 指定帳簿のkindだけ変わり loadBooks/getActiveBook に反映される", () => {
    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    updateBookKind(book2.id, "business");
    expect(loadBooks().find((b) => b.id === book2.id)?.kind).toBe("business");
    expect(loadBooks().find((b) => b.id === "default")?.kind).toBe("household");
    expect(getActiveBook().kind).toBe("business");
  });

  it("updateBookKind: 未知IDはno-op", () => {
    createBook("サークルA", "circle");
    const before = loadBooks();
    updateBookKind("nonexistent-id", "business");
    expect(loadBooks()).toEqual(before);
  });
});

describe("deleteBook", () => {
  it("最後の1冊は削除拒否 (no-op)", () => {
    deleteBook("default");
    expect(loadBooks()).toHaveLength(1);
    expect(loadBooks()[0].id).toBe("default");
  });

  it("データキーを削除する", () => {
    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    upsertEntry(baseEntry({ id: "book2-entry" }));
    expect(localStorage.getItem(`tc-books:journal-v1:${book2.id}`)).not.toBeNull();

    setActiveBook("default");
    deleteBook(book2.id);

    expect(localStorage.getItem(`tc-books:journal-v1:${book2.id}`)).toBeNull();
    expect(loadBooks().map((b) => b.id)).toEqual(["default"]);
  });

  it("アクティブ帳簿を削除すると残りの先頭がアクティブになる", () => {
    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    expect(getActiveBookId()).toBe(book2.id);

    deleteBook(book2.id);
    expect(getActiveBookId()).toBe("default");
  });

  it("未知IDはno-op", () => {
    createBook("サークルA", "circle");
    const before = loadBooks();
    deleteBook("nonexistent-id");
    expect(loadBooks()).toEqual(before);
  });
});

describe("loadMultiBookBundle", () => {
  it("全帳簿分のentries/customAccountsを含む", () => {
    upsertEntry(baseEntry({ id: "default-entry" }));
    const book2 = createBook("サークルA", "circle");
    setActiveBook(book2.id);
    upsertEntry(baseEntry({ id: "book2-entry" }));

    const bundle = loadMultiBookBundle();
    expect(bundle.v).toBe(2);
    expect(bundle.books).toHaveLength(2);

    const defaultBackup = bundle.books.find((b) => b.book.id === "default");
    const book2Backup = bundle.books.find((b) => b.book.id === book2.id);
    expect(defaultBackup?.entries.map((e) => e.id)).toEqual(["default-entry"]);
    expect(book2Backup?.entries.map((e) => e.id)).toEqual(["book2-entry"]);
    expect(book2Backup?.book.kind).toBe("circle");
  });
});
