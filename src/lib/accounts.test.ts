import { beforeEach, describe, expect, it } from "vitest";
import type { BookKind } from "../types";
import { createBook, setActiveBook } from "./store";
import { accountById, standardAccountsFor } from "./accounts";

const KINDS: BookKind[] = ["household", "circle", "business"];

beforeEach(() => {
  localStorage.clear();
});

describe("standardAccountsFor", () => {
  for (const kind of KINDS) {
    it(`${kind}: 空でない、code重複なし、id重複なし、opening-balanceを含む`, () => {
      const accounts = standardAccountsFor(kind);
      expect(accounts.length).toBeGreaterThan(0);

      const codes = accounts.map((a) => a.code);
      expect(new Set(codes).size).toBe(codes.length);

      const ids = accounts.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);

      expect(accounts.some((a) => a.id === "opening-balance" && a.type === "equity")).toBe(true);
    });
  }
});

describe("accountById fallback", () => {
  it("アクティブ帳簿(household)に無いbusiness科目でも横断検索でヒットする", () => {
    // デフォルト帳簿は household のはず
    expect(accountById("outsourcing")?.name).toBe("外注費");
    expect(accountById("membership-fee")?.name).toBe("会費収入");
  });

  it("アクティブ帳簿を切り替えても他kindの科目を検索できる", () => {
    const biz = createBook("会社", "business");
    setActiveBook(biz.id);

    // household固有の科目 (food) は business チャートにもカスタムにも無いが
    // 横断フォールバックで見つかる
    expect(accountById("food")?.name).toBe("食費");
    // business自身の科目はそのまま見つかる
    expect(accountById("outsourcing")?.name).toBe("外注費");
  });

  it("存在しないidはundefined", () => {
    expect(accountById("does-not-exist")).toBeUndefined();
  });
});
