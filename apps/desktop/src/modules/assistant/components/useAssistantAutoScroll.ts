import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 24;

export function useAssistantAutoScroll({
  contentVersion,
  conversationId
}: {
  contentVersion: string;
  conversationId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setStickToBottom = useCallback((next: boolean) => {
    stickToBottomRef.current = next;
    setIsAtBottom((current) => current === next ? current : next);
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroll = () => {
      const container = containerRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
      lastScrollTopRef.current = container.scrollTop;
      endRef.current?.scrollIntoView({ block: 'end' });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
  }, []);

  const forceNextScroll = useCallback(() => {
    setStickToBottom(true);
    scrollToBottom();
  }, [scrollToBottom, setStickToBottom]);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const scrollingUp = element.scrollTop < lastScrollTopRef.current - 1;
    if (scrollingUp) {
      setStickToBottom(false);
    } else if (distance <= BOTTOM_THRESHOLD_PX) {
      setStickToBottom(true);
    }
    lastScrollTopRef.current = element.scrollTop;
  }, [setStickToBottom]);

  useLayoutEffect(() => {
    setStickToBottom(true);
    scrollToBottom();
  }, [conversationId, scrollToBottom, setStickToBottom]);

  useLayoutEffect(() => {
    if (stickToBottomRef.current) scrollToBottom();
  }, [contentVersion, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return { containerRef, contentRef, endRef, forceNextScroll, handleScroll, isAtBottom };
}
