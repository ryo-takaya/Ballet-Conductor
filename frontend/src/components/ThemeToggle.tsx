"use client";

import { useSyncExternalStore } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

const listeners = new Set<() => void>();

// まだ選んでいないときは、端末の設定に合わせた方を選択済みにする
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);

  const next: Theme = theme === "light" ? "dark" : "light";

  return (
    <>
      {/* スマホなど幅が狭いときは、アプリ名と同じ行に収まるように 1 つのボタンにする */}
      <button
        type="button"
        className={styles.compact}
        onClick={() => applyTheme(next)}
        aria-label={next === "dark" ? "ダークに切り替える" : "ライトに切り替える"}
        title={next === "dark" ? "ダークに切り替える" : "ライトに切り替える"}
      >
        {theme === "light" ? "☀" : "☾"}
      </button>
      <div className={styles.toggle} role="radiogroup" aria-label="表示テーマ">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          className={`${styles.option} ${theme === o.value ? styles.active : ""}`}
          onClick={() => applyTheme(o.value)}
        >
          {o.label}
        </button>
      ))}
      </div>
    </>
  );
}
