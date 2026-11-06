/*
 * Adapted from TextFold textfold/web/reader.js, revision
 * 5fc941dc4560ee2809c0f278da28457292c7f739, snapshot/buildMotion/morph.
 * Copyright 2026 Xia Chen. Licensed under the Apache License, Version 2.0.
 * Modified for NeuInk: a bounded, cancellable transition inside a scroll owner;
 * keyed nodes need not retain DOM identity. No continuous gesture zoom.
 */

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Piece = { node: HTMLElement; rect: Rect; font: string; color: string };
export type FoldMotionSnapshot = { pieces: Map<string, Piece>; anchorTop: number | null; height: number };
const MAX_PIECES = 600;
const DURATION = 360;

function visible(rect: Rect, bounds: Rect): boolean {
  return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
}

function boundsOf(root: HTMLElement): Rect {
  const rect = root.getBoundingClientRect();
  return { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
    right: Math.min(window.innerWidth, rect.right), bottom: Math.min(window.innerHeight, rect.bottom),
    width: rect.width, height: rect.height };
}

/** Called before the reader changes levels. Keys must identify the same token across levels. */
export function captureFoldMotion(root: HTMLElement, anchor?: HTMLElement | null, clipRoot: HTMLElement = root): FoldMotionSnapshot {
  const pieces = new Map<string, Piece>();
  const ambiguous = new Set<string>();
  const bounds = boundsOf(clipRoot);
  const candidates = root.querySelectorAll<HTMLElement>('[data-fold-token]');
  for (const node of candidates) {
    const key = node.dataset.foldToken;
    if (!key || ambiguous.has(key)) continue;
    const rect = node.getBoundingClientRect();
    if (!visible(rect, bounds)) continue;
    if (pieces.has(key)) { pieces.delete(key); ambiguous.add(key); continue; }
    if (pieces.size >= MAX_PIECES) break;
    const style = getComputedStyle(node);
    pieces.set(key, { node, rect, font: style.font, color: style.color });
  }
  return { pieces, anchorTop: anchor?.isConnected ? anchor.getBoundingClientRect().top : null, height: root.offsetHeight };
}

/** Call after rendering the next level; cancel when a new transition starts or the view unmounts. */
export function playFoldMotion(root: HTMLElement, before: FoldMotionSnapshot, anchor?: HTMLElement | null, clipRoot: HTMLElement = root): () => void {
  if (before.anchorTop !== null && anchor?.isConnected) root.scrollTop += anchor.getBoundingClientRect().top - before.anchorTop;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof Element.prototype.animate !== 'function') return () => {};
  const after = captureFoldMotion(root, anchor, clipRoot);
  const animations: Animation[] = [];
  const ghosts: HTMLElement[] = [];
  // Only animate visible paragraphs; offsetHeight uses layout pixels even at UI zoom.
  if ((before.pieces.size || after.pieces.size) && before.height > 0 && after.height > 0 && Math.abs(before.height - after.height) > 1) {
    animations.push(root.animate([{ height: `${before.height}px` }, { height: `${after.height}px` }],
      { duration: DURATION, easing: 'cubic-bezier(.2,.8,.2,1)' }));
  }
  for (const [key, current] of after.pieces) {
    const previous = before.pieces.get(key);
    if (!previous) {
      animations.push(current.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION * 0.55, delay: DURATION * 0.4, easing: 'ease-out', fill: 'backwards' }));
      continue;
    }
    const dx = previous.rect.left - current.rect.left, dy = previous.rect.top - current.rect.top;
    const scale = current.rect.height ? previous.rect.height / current.rect.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.01) continue;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    animations.push(current.node.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${safeScale})` }, { transform: 'none' }],
      { duration: DURATION, easing: 'cubic-bezier(.2,.8,.2,1)' }));
  }
  const bounds = boundsOf(clipRoot);
  for (const [key, piece] of before.pieces) {
    if (after.pieces.has(key) || !visible(piece.rect, bounds)) continue;
    const ghost = piece.node.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id'); ghost.removeAttribute('data-fold-token'); ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '200', overflow: 'hidden',
      left: `${piece.rect.left}px`, top: `${piece.rect.top}px`, width: `${piece.rect.width}px`, height: `${piece.rect.height}px`,
      font: piece.font, color: piece.color, transform: 'none',
      clipPath: `inset(${Math.max(0, bounds.top - piece.rect.top)}px ${Math.max(0, piece.rect.right - bounds.right)}px ${Math.max(0, piece.rect.bottom - bounds.bottom)}px ${Math.max(0, bounds.left - piece.rect.left)}px)`
    });
    document.body.append(ghost); ghosts.push(ghost);
    animations.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION * 0.45, easing: 'ease-in', fill: 'forwards' }));
  }
  const cleanup = () => { animations.forEach(animation => animation.cancel()); ghosts.forEach(ghost => ghost.remove()); };
  void Promise.allSettled(animations.map(animation => animation.finished)).then(cleanup);
  return cleanup;
}
