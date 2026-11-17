/** Files out of the page: CSV text, and handing a file to the browser to save. */

const field = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV text from a header and rows. Numbers are written in full (SI). */
export function csvText(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(field).join(",")).join("\n") + "\n";
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
