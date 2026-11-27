"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { edgesOf, type Edges } from "./edges.ts";
import styles from "./ScrollRow.module.css";

/**
 * Follow a row that scrolls sideways (#103): whether there is more to see at
 * either end. Measured on scroll, on resize, and when its items change.
 */
export function useScrollEdges(): [(node: HTMLElement | null) => void, Edges, HTMLElement | null] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });
  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const next = edgesOf(node.scrollLeft, node.clientWidth, node.scrollWidth);
      setEdges((e) => (e.start === next.start && e.end === next.end ? e : next));
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(node);
      for (const child of node.children) resize.observe(child);
    };
    const items = new MutationObserver(() => {
      watch();
      measure();
    });
    watch();
    items.observe(node, { childList: true, subtree: true, characterData: true });
    // the browser leaves a focused item where it is while any of it shows, even under the fade:
    // reached with the keyboard, scroll it clear, by the row's scroll padding
    const focus = (e: FocusEvent) => {
      const item = e.target;
      if (item instanceof HTMLElement && item !== node && item.matches(":focus-visible")) {
        item.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    node.addEventListener("scroll", measure, { passive: true });
    node.addEventListener("focusin", focus);
    measure();
    return () => {
      resize.disconnect();
      items.disconnect();
      node.removeEventListener("scroll", measure);
      node.removeEventListener("focusin", focus);
    };
  }, [node]);
  return [setNode, edges, node];
}

export interface ScrollRowProps {
  /** the row itself, the wrapper's first child: give it `ref` */
  children(ref: (node: HTMLElement | null) => void): ReactNode;
  className?: string;
  testId?: string;
}

/**
 * A row that scrolls sideways on a narrow screen: the edge with more past it
 * fades out, and a small arrow there scrolls by most of the row's width
 * (#103). The fade is a mask on the row's own pixels, so it suits both themes
 * and any background. The arrows are for the pointer only: the items in the
 * row stay reachable with Tab, and one focused from the keyboard scrolls clear of the fade.
 */
export function ScrollRow({ children, className, testId }: ScrollRowProps) {
  const [ref, edges, node] = useScrollEdges();
  const by = useCallback(
    (direction: 1 | -1) => {
      if (!node) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollBy({ left: direction * Math.max(80, node.clientWidth * 0.7), behavior: still ? "auto" : "smooth" });
    },
    [node],
  );
  return (
    <div
      className={className ? `${styles.wrap} ${className}` : styles.wrap}
      data-testid={testId}
      data-more-start={edges.start ? "" : undefined}
      data-more-end={edges.end ? "" : undefined}
    >
      {children(ref)}
      {edges.start && (
        <button type="button" className={styles.arrow} data-side="start" tabIndex={-1} aria-hidden="true" title="Scroll back" onClick={() => by(-1)}>
          <Icon name="chevron" size={14} />
        </button>
      )}
      {edges.end && (
        <button type="button" className={styles.arrow} data-side="end" tabIndex={-1} aria-hidden="true" title="Scroll for more" onClick={() => by(1)}>
          <Icon name="chevron" size={14} />
        </button>
      )}
    </div>
  );
}
