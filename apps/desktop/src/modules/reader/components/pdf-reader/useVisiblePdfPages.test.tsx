// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVisiblePdfPages } from './useVisiblePdfPages';

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  options?: IntersectionObserverInit;
};

const observers: ObserverRecord[] = [];
const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  observers.length = 0;
  globalThis.IntersectionObserver = class IntersectionObserverMock {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    disconnect = vi.fn();
    observe = vi.fn();
    takeRecords = vi.fn(() => []);
    unobserve = vi.fn();

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      observers.push({
        callback,
        disconnect: this.disconnect,
        observe: this.observe,
        options
      });
    }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.IntersectionObserver = originalIntersectionObserver;
});

describe('useVisiblePdfPages', () => {
  it.each([1, 1.25])('excludes the floating toolbar from page tracking at %sx UI scale', (scale) => {
    const root = document.createElement('div');
    root.style.scrollPaddingTop = '125px';
    Object.defineProperty(root, 'offsetHeight', { value: 640 });
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 640 * scale } as DOMRect);
    const pages = [0, 1, 2].map(index => {
      const page = document.createElement('section'); page.dataset.pdfPageIndex = String(index); root.append(page); return page;
    });
    const scrollRef = { current: root };
    const hook = renderHook(() => useVisiblePdfPages({ pageCount: 3, scrollRef }));
    const observer = observers[0];
    // Model the actual browser intersection: the preceding page ends exactly at the toolbar inset.
    const margin = parseFloat(observer.options?.rootMargin ?? '0');
    act(() => observer.callback(pages.slice(1).map((target, index) => {
      const height = index === 0 ? Math.max(0, 125 * scale + margin) : 500 * scale;
      return { target, isIntersecting: height > 0, time: 0, rootBounds: null,
        boundingClientRect: new DOMRect(0, 0, 1000, 1700 * scale),
        intersectionRect: new DOMRect(0, 0, 1000, height), intersectionRatio: height / (1700 * scale) };
    }), {} as IntersectionObserver));
    expect([...hook.result.current.visiblePageIndexes]).toEqual([2]);
    expect(observer.options?.rootMargin).toBe(`${-125 * scale}px 0px 0px 0px`);
  });

  it('updates the visible viewport after the toolbar wraps and releases geometry observers', () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe = vi.fn(); disconnect = disconnect;
    });
    const frame = document.createElement('div'); frame.dataset.readerFrame = '';
    const toolbar = document.createElement('div'); toolbar.dataset.material = 'reader-toolbar';
    const root = document.createElement('div'); frame.append(toolbar, root);
    document.body.append(frame);
    root.style.scrollPaddingTop = '80px';
    const scrollRef = { current: root };
    const hook = renderHook(() => useVisiblePdfPages({ pageCount: 1, scrollRef }));
    const initial = observers[0];
    root.style.scrollPaddingTop = '140px';
    act(() => resize());
    expect(initial.disconnect).toHaveBeenCalled();
    expect(observers[observers.length - 1]?.options?.rootMargin).toBe('-140px 0px 0px 0px');
    hook.unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(observers[observers.length - 1]?.disconnect).toHaveBeenCalled();
    frame.remove();
  });

  it('does not report a previous page when only its bottom margin remains visible', () => {
    const root = document.createElement('div');
    const pages = [0, 1].map(index => { const page = document.createElement('section'); page.dataset.pdfPageIndex = String(index); root.append(page); return page; });
    const hook = renderHook(() => useVisiblePdfPages({ pageCount:2, scrollRef:{current:root} }));
    act(() => observers[0].callback(pages.map((target, index) => ({target,isIntersecting:true,
      boundingClientRect:{height:850}, intersectionRect:{height:index === 0 ? 12 : 450},
    } as unknown as IntersectionObserverEntry)), {} as IntersectionObserver));
    expect([...hook.result.current.visiblePageIndexes]).toEqual([1]);
  });
  it('tracks visible and nearby pages without measuring every page on scroll', () => {
    const root = document.createElement('div');
    const pageElements = Array.from({ length: 7 }, (_, pageIdx) => {
      const element = document.createElement('section');
      element.dataset.pdfPageIndex = String(pageIdx);
      root.append(element);
      return element;
    });
    const rectSpies = pageElements.map((element) =>
      vi.spyOn(element, 'getBoundingClientRect')
    );
    const scrollRef = { current: root };
    const hook = renderHook(() =>
      useVisiblePdfPages({ pageCount: pageElements.length, scrollRef })
    );

    const visibleObserver = observers.find((item) => !item.options?.rootMargin)!;
    const nearbyObserver = observers.find((item) => Boolean(item.options?.rootMargin))!;
    expect(visibleObserver.observe).toHaveBeenCalledTimes(7);
    expect(nearbyObserver.observe).toHaveBeenCalledTimes(7);

    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => pageElements[4]
    });
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    act(() => root.dispatchEvent(new Event('scroll')));
    expect([...hook.result.current.visiblePageIndexes]).toEqual([4]);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint
    });

    act(() => {
      nearbyObserver.callback(
        [intersectionEntry(pageElements[4], true)],
        {} as IntersectionObserver
      );
      visibleObserver.callback(
        [
          intersectionEntry(pageElements[0], false),
          intersectionEntry(pageElements[4], true)
        ],
        {} as IntersectionObserver
      );
    });

    expect([...hook.result.current.visiblePageIndexes]).toEqual([4]);
    expect([...hook.result.current.renderPageIndexes].sort()).toEqual([3, 4, 5]);

    act(() => root.dispatchEvent(new Event('scroll')));
    for (const spy of rectSpies) expect(spy).not.toHaveBeenCalled();
  });
});

function intersectionEntry(target: Element, isIntersecting: boolean) {
  return { isIntersecting, target } as IntersectionObserverEntry;
}
