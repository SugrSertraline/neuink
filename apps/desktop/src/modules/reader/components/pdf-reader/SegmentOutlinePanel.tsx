import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SourceSegment } from '@/shared/types/domain';

import {
  buildSegmentOutline,
  outlineAncestorUids,
  resolveActiveHeadingUid,
  type SegmentOutlineNode
} from './segmentOutline';

export function SegmentOutlinePanel({
  activeSegmentUid,
  focusSegmentUid,
  open,
  segments,
  onClose,
  onJumpToSegment
}: {
  activeSegmentUid: string | null;
  focusSegmentUid: string | null;
  open: boolean;
  segments: SourceSegment[];
  onClose: () => void;
  onJumpToSegment: (segmentUid: string) => void;
}) {
  const outline = useMemo(() => buildSegmentOutline(segments), [segments]);
  const activeHeadingUid = useMemo(
    () => resolveActiveHeadingUid(segments, activeSegmentUid),
    [activeSegmentUid, segments]
  );
  const [collapsedUids, setCollapsedUids] = useState<Set<string>>(() => new Set());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const allParentUids = useMemo(() => collectParentUids(outline), [outline]);

  useEffect(() => {
    if (!activeHeadingUid) return;
    const ancestors = outlineAncestorUids(outline, activeHeadingUid);
    setCollapsedUids((current) => {
      const next = new Set(current);
      let changed = false;
      for (const uid of ancestors) {
        changed = next.delete(uid) || changed;
      }
      return changed ? next : current;
    });
  }, [activeHeadingUid, outline]);

  useEffect(() => {
    if (!open) return;
    const targetUid = focusSegmentUid ?? activeHeadingUid;
    if (!targetUid) return;
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[data-outline-uid]') ?? []
      ).find((element) => element.dataset.outlineUid === targetUid);
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeHeadingUid, focusSegmentUid, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <section
      ref={panelRef}
      aria-label="详细目录"
      className="absolute inset-y-0 left-full z-30 flex w-72 flex-col border-r bg-card shadow-2xl"
      data-segment-outline-panel="true"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">详细目录</h2>
          <p className="text-[11px] text-muted-foreground">{countNodes(outline)} 个标题</p>
        </div>
        <Button
          aria-label="全部展开"
          size="icon-sm"
          title="全部展开"
          variant="ghost"
          onClick={() => setCollapsedUids(new Set())}
        >
          <ChevronsUpDown size={15} />
        </Button>
        <Button
          aria-label="全部收起"
          size="icon-sm"
          title="全部收起"
          variant="ghost"
          onClick={() => setCollapsedUids(new Set(allParentUids))}
        >
          <ChevronsDownUp size={15} />
        </Button>
        <Button
          aria-label="关闭详细目录"
          size="icon-sm"
          title="关闭目录"
          variant="ghost"
          onClick={onClose}
        >
          <X size={15} />
        </Button>
      </header>

      {outline.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1">
          <nav aria-label="PDF 标题目录" className="py-2 pr-2">
            <OutlineItems
              activeHeadingUid={activeHeadingUid}
              collapsedUids={collapsedUids}
              nodes={outline}
              onJumpToSegment={onJumpToSegment}
              onToggle={(uid) => {
                setCollapsedUids((current) => {
                  const next = new Set(current);
                  if (next.has(uid)) next.delete(uid);
                  else next.add(uid);
                  return next;
                });
              }}
            />
          </nav>
        </ScrollArea>
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-sm font-medium">未识别到文档目录</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              当前 PDF 没有可用的标题层级，仍可使用左侧轨道浏览全文位置。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function OutlineItems({
  activeHeadingUid,
  collapsedUids,
  depth = 0,
  nodes,
  onJumpToSegment,
  onToggle
}: {
  activeHeadingUid: string | null;
  collapsedUids: ReadonlySet<string>;
  depth?: number;
  nodes: SegmentOutlineNode[];
  onJumpToSegment: (segmentUid: string) => void;
  onToggle: (uid: string) => void;
}) {
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const collapsed = collapsedUids.has(node.segment.uid);
    const active = node.segment.uid === activeHeadingUid;
    return (
      <div key={node.segment.uid}>
        <div
          className={cn(
            'group flex min-h-8 items-center rounded-r-md pr-2 text-xs transition-colors',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-foreground/78 hover:bg-muted/70 hover:text-foreground'
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {hasChildren ? (
            <button
              aria-label={collapsed ? `展开 ${node.title}` : `收起 ${node.title}`}
              className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
              type="button"
              onClick={() => onToggle(node.segment.uid)}
            >
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          )}
          <button
            aria-current={active ? 'location' : undefined}
            className={cn(
              'min-w-0 flex-1 py-2 text-left leading-4',
              node.level <= 1 && 'font-semibold',
              active && 'font-semibold'
            )}
            data-outline-uid={node.segment.uid}
            title={node.title}
            type="button"
            onClick={() => onJumpToSegment(node.segment.uid)}
          >
            <span className="line-clamp-2">{node.title}</span>
          </button>
          <span className="ml-2 shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {node.segment.page_idx + 1}
          </span>
        </div>
        {hasChildren && !collapsed ? (
          <OutlineItems
            activeHeadingUid={activeHeadingUid}
            collapsedUids={collapsedUids}
            depth={depth + 1}
            nodes={node.children}
            onJumpToSegment={onJumpToSegment}
            onToggle={onToggle}
          />
        ) : null}
      </div>
    );
  });
}

function collectParentUids(nodes: SegmentOutlineNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length > 0 ? [node.segment.uid] : []),
    ...collectParentUids(node.children)
  ]);
}

function countNodes(nodes: SegmentOutlineNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}
