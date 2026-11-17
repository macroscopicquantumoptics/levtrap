/**
 * The theme's colours for the 3D scene, read from the CSS tokens
 * (app/src/app/globals.css) so the drawing and the page never disagree.
 */
import { useMemo, useSyncExternalStore } from "react";
import { Color } from "three";
import { currentTheme, subscribeTheme, type Theme } from "../../lib/theme.ts";

const TOKENS = ["light", "glass", "metal", "metal-face", "metal-edge", "metal-rf", "particle", "select", "scene", "scene-ink", "axis-x", "axis-y", "axis-z", "field"] as const;
export type Token = (typeof TOKENS)[number];

export interface Palette {
  theme: Theme;
  /** a token's colour; "var(--x)" and plain CSS colours are both accepted */
  color(value: Token | string): Color;
}

function read(theme: Theme): Palette {
  const style = getComputedStyle(document.documentElement);
  const cache = new Map<string, Color>();
  const resolve = (value: string): string => {
    const m = /^var\(--([\w-]+)\)$/.exec(value.trim());
    if (m) return resolve(style.getPropertyValue(`--${m[1]}`) || "#888888");
    return value.trim();
  };
  return {
    theme,
    color(value) {
      const css = (TOKENS as readonly string[]).includes(value) ? `var(--${value})` : value;
      let c = cache.get(css);
      if (!c) {
        c = new Color();
        try {
          c.setStyle(resolve(css));
        } catch {
          c.set("#888888");
        }
        cache.set(css, c);
      }
      return c;
    },
  };
}

/** The palette, read again when the theme changes. */
export function usePalette(): Palette {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as const);
  return useMemo(() => read(theme), [theme]);
}
