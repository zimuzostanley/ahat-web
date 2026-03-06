import { useState, useCallback, useLayoutEffect } from "react";

export type Theme = "light" | "dark";

/** Read initial theme from the DOM — the inline script in index.html already
 *  applied the correct class before React mounts, so trust the DOM as the
 *  source of truth rather than re-reading localStorage / matchMedia. */
function getInitial(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("theme", theme); } catch {}
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitial);

  // Safety net: sync DOM on mount (in case React state and DOM diverged).
  useLayoutEffect(() => { apply(theme); }, [theme]);

  const toggle = useCallback(() => {
    // Read directly from DOM to avoid any React state desync.
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    apply(next);
    setTheme(next);
  }, []);

  return [theme, toggle];
}
