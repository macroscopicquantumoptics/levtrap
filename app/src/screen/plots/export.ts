/**
 * Export a plot: the SVG as drawn (its theme colours written in, so the file
 * stands alone), a PNG of it, and the data as CSV.
 */

const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
] as const;

/** The SVG as a standalone file: computed styles inlined, the background filled. */
export function svgText(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll("*")] as Element[];
  const target = [clone, ...clone.querySelectorAll("*")] as Element[];
  source.forEach((el, i) => {
    const computed = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";");
    target[i].setAttribute("style", style);
    target[i].removeAttribute("class");
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // the page's surface behind the plot, so the file reads the same on its own
  const background = getComputedStyle(svg.closest("[data-plot]") ?? svg).backgroundColor;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("fill", background && background !== "rgba(0, 0, 0, 0)" ? background : "#ffffff");
  clone.insertBefore(rect, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** A PNG of the SVG at `scale` times its size. */
export async function pngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const text = svgText(svg);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("the plot could not be drawn as an image"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(svg.width.baseVal.value * scale);
    canvas.height = Math.round(svg.height.baseVal.value * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no PNG"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One CSV field, quoted when it needs to be. */
const field = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV text from a header and rows. Numbers are written in full (SI). */
export function csvText(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(field).join(",")).join("\n") + "\n";
}

/** Hand a file to the browser to save. */
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
