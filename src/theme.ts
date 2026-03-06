export type Theme = "light" | "dark";

/** Read theme from the DOM — the inline script in index.html already applied
 *  the correct class before the app mounts. */
export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function toggleTheme(): void {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  try { localStorage.setItem("theme", next); } catch {}
}
