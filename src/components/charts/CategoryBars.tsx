// CategoryBars: カテゴリ別内訳の横棒リスト (HTML、SVG不使用)。
// 純表示コンポーネント — store非依存、propsのみで完結する。
import type { JSX } from "preact";
import type { CategoryAmount } from "../../lib/reports";
import "../../styles/charts.css";

const DEFAULT_MAX_ROWS = 10;

interface DisplayRow {
  key: string;
  name: string;
  amount: number;
}

export function CategoryBars(props: {
  items: CategoryAmount[]; // 金額降順前提
  variant: "income" | "expense"; // income=var(--debit) / expense=var(--credit)
  maxRows?: number; // 省略時10。超過分は「その他」1行に合算
}): JSX.Element {
  const { items, variant, maxRows = DEFAULT_MAX_ROWS } = props;

  const positive = items.filter((item) => item.amount > 0);

  if (positive.length === 0) {
    return (
      <div class="chart-card">
        <p class="chart-empty">この期間のデータがありません。</p>
      </div>
    );
  }

  const visibleCount = Math.max(1, maxRows);
  let rows: DisplayRow[];
  if (positive.length <= visibleCount) {
    rows = positive.map((item) => ({ key: item.account.id, name: item.account.name, amount: item.amount }));
  } else {
    const head = positive.slice(0, visibleCount - 1);
    const rest = positive.slice(visibleCount - 1);
    const otherAmount = rest.reduce((total, item) => total + item.amount, 0);
    rows = [
      ...head.map((item) => ({ key: item.account.id, name: item.account.name, amount: item.amount })),
      { key: "__other__", name: "その他", amount: otherAmount },
    ];
  }

  const maxAmount = Math.max(...rows.map((row) => row.amount));
  const variantClass = variant === "income" ? "chart-cat-bar--income" : "chart-cat-bar--expense";

  return (
    <div class="chart-card">
      <ul class="chart-cat-list">
        {rows.map((row) => {
          const widthPercent = maxAmount > 0 ? (row.amount / maxAmount) * 100 : 0;
          return (
            <li key={row.key} class="chart-cat-row">
              <div class="chart-cat-row-head">
                <span class="chart-cat-name">{row.name}</span>
                <span class="num chart-cat-amount">¥{row.amount.toLocaleString("ja-JP")}</span>
              </div>
              <div class={`chart-cat-track ${variantClass}`}>
                <div class="chart-cat-fill" style={{ width: `${widthPercent}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
