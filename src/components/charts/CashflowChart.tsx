// CashflowChart: 月ごとの収入/支出グループ棒グラフ (手書きSVG)。
// 純表示コンポーネント — store非依存、propsのみで完結する。
// 配色はブックキーピングの既存セマンティクスに従う: 収入=var(--debit)(緑) / 支出=var(--credit)(青)。
import { useState } from "preact/hooks";
import type { JSX } from "preact";
import type { MonthlyCashflowPoint } from "../../lib/reports";
import "../../styles/charts.css";

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 260;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 12;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 24;
const PLOT_WIDTH = VIEW_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const BAR_GAP = 2; // ペア内(収入/支出)のギャップ
const GROUP_WIDTH_RATIO = 0.7; // グループ幅 = カテゴリ(月)幅の70% (残り30%が月間の隙間)
const BAR_RADIUS = 3;

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** 1-2-5系列のniceなステップ幅を、目安 targetTicks 本のグリッド線になるよう選ぶ */
function niceStep(roughMax: number): number {
  if (roughMax <= 0) return 1;
  const targetTicks = 4;
  const rough = roughMax / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  let stepUnit: number;
  if (normalized <= 1) stepUnit = 1;
  else if (normalized <= 2) stepUnit = 2;
  else if (normalized <= 5) stepUnit = 5;
  else stepUnit = 10;
  return stepUnit * magnitude;
}

/** 軸目盛用の短縮円表記: 1万以上「12万」「1.5万」、千台「5,000」、それ未満はそのまま */
function formatShortYen(amount: number): string {
  if (amount === 0) return "0";
  if (amount >= 10000) {
    const man = Math.round((amount / 10000) * 10) / 10;
    return `${man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)}万`;
  }
  if (amount >= 1000) return amount.toLocaleString("ja-JP");
  return String(amount);
}

/** 上端のみ角丸の棒グラフパス。高さが0以下なら空文字 (=描画しない) */
function roundedTopBarPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const top = y;
  const bottom = y + height;
  const left = x;
  const right = x + width;
  return [
    `M${left},${bottom}`,
    `L${left},${top + r}`,
    `Q${left},${top} ${left + r},${top}`,
    `L${right - r},${top}`,
    `Q${right},${top} ${right},${top + r}`,
    `L${right},${bottom}`,
    "Z",
  ].join(" ");
}

function monthLabel(month: string): string {
  const mo = month.slice(5, 7);
  const parsed = Number(mo);
  return `${Number.isFinite(parsed) ? parsed : mo}月`;
}

export function CashflowChart(props: { points: MonthlyCashflowPoint[] }): JSX.Element {
  const { points } = props;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const isEmpty = points.length === 0 || points.every((p) => p.income === 0 && p.expense === 0);
  if (isEmpty) {
    return (
      <div class="chart-card">
        <p class="chart-empty">この期間の仕訳がありません。</p>
      </div>
    );
  }

  const n = points.length;
  const rawMax = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]));
  const step = niceStep(rawMax);
  const niceMax = Math.ceil(rawMax / step) * step;
  const tickCount = Math.max(1, Math.round(niceMax / step));
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * step);

  const columnWidth = PLOT_WIDTH / n;
  const groupWidth = columnWidth * GROUP_WIDTH_RATIO;
  const barWidth = Math.max(1, (groupWidth - BAR_GAP) / 2);
  const baselineY = MARGIN_TOP + PLOT_HEIGHT;

  const labelStep = Math.max(1, Math.ceil(n / 12));

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const tooltipLeftPercent =
    hoverIndex !== null
      ? Math.min(90, Math.max(10, ((MARGIN_LEFT + (hoverIndex + 0.5) * columnWidth) / VIEW_WIDTH) * 100))
      : 0;

  return (
    <div class="chart-card">
      <div class="chart-legend">
        <span class="chart-legend-item">
          <span class="chart-legend-chip chart-legend-chip--income" />
          収入
        </span>
        <span class="chart-legend-item">
          <span class="chart-legend-chip chart-legend-chip--expense" />
          支出
        </span>
      </div>
      <div class="chart-svg-wrap">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          class="chart-svg"
          role="img"
          aria-label="月別収支グラフ"
        >
          {ticks.map((tickValue) => {
            const y = baselineY - (tickValue / niceMax) * PLOT_HEIGHT;
            return (
              <g key={tickValue}>
                <line
                  x1={MARGIN_LEFT}
                  x2={VIEW_WIDTH - MARGIN_RIGHT}
                  y1={y}
                  y2={y}
                  class="chart-gridline"
                />
                <text x={MARGIN_LEFT - 8} y={y} class="chart-tick-label" text-anchor="end" dominant-baseline="middle">
                  {formatShortYen(tickValue)}
                </text>
              </g>
            );
          })}

          {points.map((point, i) => {
            const columnX = MARGIN_LEFT + i * columnWidth;
            const groupX = columnX + (columnWidth - groupWidth) / 2;
            const incomeHeight = (point.income / niceMax) * PLOT_HEIGHT;
            const expenseHeight = (point.expense / niceMax) * PLOT_HEIGHT;
            const incomePath = roundedTopBarPath(
              groupX,
              baselineY - incomeHeight,
              barWidth,
              incomeHeight,
              BAR_RADIUS,
            );
            const expensePath = roundedTopBarPath(
              groupX + barWidth + BAR_GAP,
              baselineY - expenseHeight,
              barWidth,
              expenseHeight,
              BAR_RADIUS,
            );
            const showLabel = i % labelStep === 0;

            return (
              <g key={point.month}>
                {hoverIndex === i && (
                  <rect
                    x={columnX}
                    y={MARGIN_TOP}
                    width={columnWidth}
                    height={PLOT_HEIGHT}
                    class="chart-col-highlight"
                  />
                )}
                {incomePath && <path d={incomePath} class="chart-bar-income" />}
                {expensePath && <path d={expensePath} class="chart-bar-expense" />}
                {showLabel && (
                  <text
                    x={columnX + columnWidth / 2}
                    y={VIEW_HEIGHT - 6}
                    class="chart-month-label"
                    text-anchor="middle"
                  >
                    {monthLabel(point.month)}
                  </text>
                )}
                <rect
                  x={columnX}
                  y={MARGIN_TOP}
                  width={columnWidth}
                  height={PLOT_HEIGHT}
                  class="chart-hit-rect"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex((prev) => (prev === i ? null : prev))}
                />
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div class="chart-tooltip" style={{ left: `${tooltipLeftPercent}%` }}>
            <div class="chart-tooltip-title">{hovered.month}</div>
            <div class="chart-tooltip-row">
              <span class="chart-legend-chip chart-legend-chip--income" />
              収入 <span class="num">{formatYen(hovered.income)}</span>
            </div>
            <div class="chart-tooltip-row">
              <span class="chart-legend-chip chart-legend-chip--expense" />
              支出 <span class="num">{formatYen(hovered.expense)}</span>
            </div>
            <div class="chart-tooltip-row chart-tooltip-net">
              収支{" "}
              <span class="num">
                {hovered.net >= 0 ? "+" : ""}
                {formatYen(hovered.net)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
