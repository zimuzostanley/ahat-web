export function fmtSize(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GiB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return n.toLocaleString();
}

export function fmtHex(id: number): string {
  return "0x" + id.toString(16).padStart(8, "0");
}

export function deltaBgClass(deltaKb: number): string {
  if (deltaKb === 0) return "";
  const abs = Math.abs(deltaKb);
  if (deltaKb > 0) {
    if (abs >= 50_000) return "bg-red-200 dark:bg-red-900";
    if (abs >= 10_000) return "bg-red-100 dark:bg-red-900/50";
    if (abs >= 1_000) return "bg-red-50 dark:bg-red-950";
    return "";
  }
  if (abs >= 50_000) return "bg-green-200 dark:bg-green-900";
  if (abs >= 10_000) return "bg-green-100 dark:bg-green-900/50";
  if (abs >= 1_000) return "bg-green-50 dark:bg-green-950";
  return "";
}

export function fmtDelta(deltaKb: number): string {
  if (deltaKb === 0) return "";
  const sign = deltaKb > 0 ? "+" : "\u2212";
  return `${sign}${fmtSize(Math.abs(deltaKb) * 1024)}`;
}

/** Format a byte-level delta (like Java ahat's %+,d format). */
export function fmtSizeDelta(bytes: number): string {
  if (bytes === 0) return "";
  const sign = bytes > 0 ? "+" : "\u2212";
  return `${sign}${fmtSize(Math.abs(bytes))}`;
}

export function deltaBgClassBytes(bytes: number): string {
  return deltaBgClass(bytes / 1024);
}
