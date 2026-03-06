/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface:       "rgb(var(--color-surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--color-surface-alt) / <alpha-value>)",
        "surface-muted": "rgb(var(--color-surface-muted) / <alpha-value>)",
        "text-primary":  "rgb(var(--color-text) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-muted":    "rgb(var(--color-text-muted) / <alpha-value>)",
        "border-default": "rgb(var(--color-border) / <alpha-value>)",
        "border-light":   "rgb(var(--color-border-light) / <alpha-value>)",
        "border-heavy":   "rgb(var(--color-border-heavy) / <alpha-value>)",
        accent:          "rgb(var(--color-accent) / <alpha-value>)",
        "accent-hover":  "rgb(var(--color-accent-hover) / <alpha-value>)",
        positive:        "rgb(var(--color-positive) / <alpha-value>)",
        negative:        "rgb(var(--color-negative) / <alpha-value>)",
        warning:         "rgb(var(--color-warning) / <alpha-value>)",
      },
    },
  },
  plugins: [],
}
