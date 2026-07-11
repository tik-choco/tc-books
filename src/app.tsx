import { useEffect, useState } from "preact/hooks";
import {
  BookOpenText,
  ChartColumnBig,
  House,
  Moon,
  NotebookPen,
  NotebookText,
  Settings,
  Sun,
} from "lucide-preact";
import type { MainTab } from "./types";
import { onHashChange, readHash, writeHash } from "./lib/hashRoute";
import { useTheme } from "./hooks/useTheme";
import { HomeView } from "./views/HomeView";
import { JournalView } from "./views/JournalView";
import { LedgerView } from "./views/LedgerView";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";
import { Onboarding } from "./components/Onboarding";
import { markOnboardingDone, shouldShowOnboarding, subscribeOnboardingRequests } from "./lib/onboarding";

const TABS: { id: MainTab; label: string; icon: typeof House }[] = [
  { id: "home", label: "家計簿", icon: House },
  { id: "journal", label: "仕訳帳", icon: NotebookPen },
  { id: "ledger", label: "元帳", icon: BookOpenText },
  { id: "reports", label: "レポート", icon: ChartColumnBig },
  { id: "settings", label: "設定", icon: Settings },
];

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<MainTab>(() => readHash().tab ?? "home");

  useEffect(
    () =>
      onHashChange((state) => {
        if (state.tab) setTab(state.tab);
      }),
    [],
  );

  function selectTab(next: MainTab) {
    setTab(next);
    writeHash(next);
  }

  // First-run wizard: shown once on a fresh install, and re-openable from the
  // settings screen. Closing it (any path) marks onboarding done.
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  useEffect(() => subscribeOnboardingRequests(() => setShowOnboarding(true)), []);

  function closeOnboarding() {
    markOnboardingDone();
    setShowOnboarding(false);
  }

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header-brand">
          <NotebookText size={20} />
          TC Books
        </div>
        <nav class="app-tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              class={`app-tab${tab === id ? " app-tab-active" : ""}`}
              onClick={() => selectTab(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div class="app-header-links">
          <button
            class="theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "ダークテーマに切り替え" : "ライトテーマに切り替え"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>
      <main class="app-main">
        {tab === "home" && <HomeView />}
        {tab === "journal" && <JournalView />}
        {tab === "ledger" && <LedgerView />}
        {tab === "reports" && <ReportsView />}
        {tab === "settings" && <SettingsView />}
      </main>
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
    </div>
  );
}
