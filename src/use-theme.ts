import { useState, useCallback, useLayoutEffect } from "react";

export type Theme = "light" | "dark";

function getInitial(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitial);

  // Sync DOM + localStorage whenever theme state changes.
  // useLayoutEffect runs before paint, preventing a visible flash on toggle.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }, []);

  return [theme, toggle];
}
