// 領収書の印刷用プレゼンテーション。フックやstoreアクセスは持たず、渡された
// IssuedReceipt をそのまま整形して表示するだけ（印刷は呼び出し側のwindow.print()）。
import type { JSX } from "preact";
import type { IssuedReceipt } from "../types";
import { formatPayerName, formatReceiptNo, formatYen } from "../lib/receipts";

export function ReceiptPrintable(props: { receipt: IssuedReceipt }): JSX.Element {
  const { receipt } = props;

  return (
    <div class="receipt-print-sheet">
      <div class="rps-head">
        <h1 class="rps-title">領収書</h1>
        <div class="rps-meta">
          <div>{formatReceiptNo(receipt.issueNo)}</div>
          <div>発行日 {receipt.issueDate}</div>
        </div>
      </div>

      <div class="rps-payer">{formatPayerName(receipt.payerName)}</div>

      <div class="rps-amount-box">
        <span class="rps-amount-label">金額</span>
        <span class="rps-amount-value">{formatYen(receipt.amount)}</span>
        <span class="rps-amount-tail">−</span>
      </div>

      <div class="rps-note">但し {receipt.note}</div>
      <div class="rps-confirm">上記正に領収いたしました</div>

      <div class="rps-foot">
        <div class="rps-stamp">
          <span class="rps-stamp-label">収入印紙</span>
        </div>
        <div class="rps-issuer">
          <div class="rps-issuer-name">{receipt.issuerName}</div>
        </div>
      </div>
    </div>
  );
}
