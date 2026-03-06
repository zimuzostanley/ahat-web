import { useState, useCallback } from "react";

export type Theme = "light" | "dark";

function getInitial(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("theme", theme); } catch {}
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitial);
  const toggle = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, []);
  return [theme, toggle];
}
