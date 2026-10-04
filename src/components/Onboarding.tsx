// First-run wizard shown by app.tsx as a modal overlay: welcome -> LLM
// connection (optional, used for receipt OCR) -> feature tour. Every step is
// skippable and closing at any point counts as "done" (the flag is owned by
// the caller via `onClose`) — the settings screen can re-open it any time.
// Ported from tc-town's src/components/Onboarding.tsx, trimmed to tc-books'
// simpler shape (no character creation step, no OptionsPicker dependency).

import { useState } from "preact/hooks";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChartColumnBig,
  Check,
  Cloud,
  House,
  NotebookPen,
  Sparkles,
  X,
} from "lucide-preact";
import { BooksAiSettings } from "./BooksAiSettings";
import { aiMessages } from "../lib/llmMessages";
import "../styles/onboarding.css";

const STEP_COUNT = 3;

export function Onboarding(props: { onClose: () => void }) {
  const [step, setStep] = useState(0);

  return (
    <div class="ob-overlay">
      <div class="ob-card" role="dialog" aria-modal="true" aria-label="はじめてのセットアップ">
        <button class="ob-close" type="button" onClick={props.onClose} title="閉じる" aria-label="閉じる">
          <X size={18} />
        </button>

        {step === 0 && (
          <div class="ob-body">
            <div class="ob-hero">
              <Sparkles size={36} />
            </div>
            <h2 class="ob-title">TC Books へようこそ！</h2>
            <p class="ob-text">
              TC Books は複式簿記ベースの家計簿アプリです。クイック入力やレシート読み取りでかんたんに記帳でき、
              仕訳帳・元帳・レポートで家計の流れを把握できます。データはすべて端末内(ブラウザ)に保存されます。
            </p>
            <p class="ob-text">
              準備は任意で1つだけ：レシート読み取り(OCR)に使う<strong>LLMの接続設定</strong>です。
              LLMを設定しなくても手入力ですべての機能が使えますし、あとから設定画面でいつでも変更できます。
            </p>
          </div>
        )}

        {step === 1 && (
          <div class="ob-body">
            <p class="ob-text">{aiMessages().setupTip}</p>
            <BooksAiSettings />
          </div>
        )}

        {step === 2 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Check size={22} />
              <h2 class="ob-title">準備完了です！</h2>
            </div>
            <ul class="ob-feature-list">
              <li>
                <House size={16} />
                <span>
                  <strong>家計簿</strong> — クイック入力とレシート読み取りでかんたん記帳
                </span>
              </li>
              <li>
                <NotebookPen size={16} />
                <span>
                  <strong>仕訳帳</strong> — 複式簿記の仕訳を一覧・編集
                </span>
              </li>
              <li>
                <BookOpenText size={16} />
                <span>
                  <strong>元帳</strong> — 勘定科目ごとの明細と残高
                </span>
              </li>
              <li>
                <ChartColumnBig size={16} />
                <span>
                  <strong>レポート</strong> — 月次の収支・資産の推移をグラフで確認
                </span>
              </li>
              <li>
                <Cloud size={16} />
                <span>
                  <strong>バックアップ</strong> — 暗号化して自動でtc-storageへ保存
                </span>
              </li>
            </ul>
            <p class="ob-text ob-text-subtle">記帳データはすべて端末内に保存されます。それでは、楽しんでください！</p>
          </div>
        )}

        <footer class="ob-footer">
          <div class="ob-dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} class={"ob-dot" + (i === step ? " is-active" : "")} />
            ))}
          </div>
          <div class="ob-footer-actions">
            {step > 0 && (
              <button class="ob-btn" type="button" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} />
                戻る
              </button>
            )}
            {step === 0 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={() => setStep(1)}>
                はじめる
                <ArrowRight size={16} />
              </button>
            )}
            {step === 1 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={() => setStep(2)}>
                {aiMessages().next}
                <ArrowRight size={16} />
              </button>
            )}
            {step === 2 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={props.onClose}>
                <Check size={16} />
                完了
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
