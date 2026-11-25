// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFoldMotion, playFoldMotion } from './foldMotion';

function rectangle(left: number, top: number, width = 30, height = 16): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}) } as DOMRect;
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  document.body.replaceChildren();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fold motion', () => {
  it('moves retained words, fades new and removed words, and cleans up on cancellation', () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, finished: new Promise(() => {}) } as unknown as Animation));
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const root = document.createElement('div');
    root.getBoundingClientRect = () => rectangle(0, 0, 500, 500);
    document.body.append(root);
    const add = (key: string, left: number) => {
      const node = document.createElement('span'); node.dataset.foldToken = key; node.textContent = key;
      node.getBoundingClientRect = () => rectangle(left, 10); root.append(node); return node;
    };
    add('same', 10); add('removed', 50);
    const before = captureFoldMotion(root);
    root.replaceChildren(); add('same', 80); add('added', 120);
    const cleanup = playFoldMotion(root, before);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    cleanup();
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('does not animate ambiguous duplicate token keys', () => {
    const root = document.createElement('div');
    root.getBoundingClientRect = () => rectangle(0, 0, 500, 500);
    document.body.append(root);
    for (let i = 0; i < 2; i++) {
      const node = document.createElement('span'); node.dataset.foldToken = 'duplicate';
      node.getBoundingClientRect = () => rectangle(10 + i * 40, 10); root.append(node);
    }
    expect(captureFoldMotion(root).pieces.size).toBe(0);
  });

  it('animates visible paragraph height so surrounding content follows the transition', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise(() => {}) } as unknown as Animation));
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const root = document.createElement('div');
    root.getBoundingClientRect = () => rectangle(0, 0, 500, 200);
    let height = 120;
    Object.defineProperty(root, 'offsetHeight', { configurable: true, get: () => height });
    const node = document.createElement('span'); node.dataset.foldToken = 'same';
    node.getBoundingClientRect = () => rectangle(10, 10); root.append(node); document.body.append(root);
    const before = captureFoldMotion(root);
    height = 40;
    const cleanup = playFoldMotion(root, before);
    expect(animate).toHaveBeenCalledWith([{ height: '120px' }, { height: '40px' }], expect.objectContaining({ duration: 360 }));
    cleanup();
  });

  it('respects reduced motion while retaining the reading anchor', () => {
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const root = document.createElement('div'), anchor = document.createElement('span');
    root.getBoundingClientRect = () => rectangle(0, 0, 500, 500);
    let top = 20;
    anchor.getBoundingClientRect = () => rectangle(10, top);
    root.append(anchor); document.body.append(root);
    const before = captureFoldMotion(root, anchor);
    top = 45;
    playFoldMotion(root, before, anchor);
    expect(root.scrollTop).toBe(25);
    expect(animate).not.toHaveBeenCalled();
  });
});
