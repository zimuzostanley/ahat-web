export function downloadBlob(name: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBuffer(name: string, buffer: ArrayBuffer): void {
  downloadBlob(name.endsWith(".hprof") ? name : name + ".hprof", buffer);
}
