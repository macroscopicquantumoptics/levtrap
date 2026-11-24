import type { PartKind } from "../model.ts";

export type IconName =
  | "menu"
  | "undo"
  | "redo"
  | "eye"
  | "help"
  | "sun"
  | "moon"
  | "plus"
  | "close"
  | "chevron"
  | "trash"
  | "copy"
  | "check"
  | "table"
  | "play"
  | "pause"
  | PartKind;

/** 16 px line icons, drawn here so the app ships no icon font. */
const PATHS: Record<IconName, string> = {
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  undo: "M6 3.5 3 6.5l3 3M3.2 6.5H9a4 4 0 0 1 0 8H6.5",
  redo: "M10 3.5l3 3-3 3M12.8 6.5H7a4 4 0 0 0 0 8h2.5",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  help: "M6.2 6.1a1.9 1.9 0 1 1 2.9 1.6c-.7.5-1.1.9-1.1 1.8M8 11.6v.4",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
  moon: "M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z",
  plus: "M8 3v10M3 8h10",
  close: "M4 4l8 8M12 4l-8 8",
  chevron: "M4 6.5 8 10l4-3.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4",
  copy: "M6 6h7v7H6zM3 10V3h7",
  check: "M3.5 8.5l3 3 6-7",
  table: "M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.5 3.5v9",
  play: "M5 3.2v9.6L12.6 8Z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  particle: "M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  beam: "M2 3.5c3 0 4.5 3 6 4.5 1.5-1.5 3-4.5 6-4.5M2 12.5c3 0 4.5-3 6-4.5 1.5 1.5 3 4.5 6 4.5",
  lens: "M8 2c2 2.2 2 9.8 0 12-2-2.200-2-9.800 0-12Z",
  paul: "M2 4h12M2 12h12M3.500 7.200h9M3.500 8.800h9",
  gravity: "M8 2.500v10M4.500 9 8 12.500 11.500 9",
  environment: "M4 4.500h.010M9 3.500h.010M12 7h.010M3 9.500h.010M7.500 8h.010M11 11.500h.010M6 12.500h.010",
};

const FILLED: Partial<Record<IconName, true>> = { particle: true, play: true };
const DOTTED: Partial<Record<IconName, true>> = { environment: true };

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={FILLED[name] ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={DOTTED[name] ? 2.2 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
