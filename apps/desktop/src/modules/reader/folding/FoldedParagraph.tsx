import { Component, createRef, type ReactNode } from 'react';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import { captureFoldMotion, playFoldMotion, type FoldMotionSnapshot } from './foldMotion';
import { foldViewsForSource } from './foldViews';
import type { FoldLevel } from './useFoldReader';

type Props = { record: FoldRecord; source: string; level: Exclude<FoldLevel, 'off'>;
  views?: ReturnType<typeof foldViewsForSource>; globalLevel?: FoldLevel };

/** Capture positions before React mutates the text, then animate the new layout. */
export class FoldedParagraph extends Component<Props, object, FoldMotionSnapshot | null> {
  private readonly root = createRef<HTMLDivElement>();
  private stopMotion: (() => void) | null = null;

  getSnapshotBeforeUpdate(previous: Props): FoldMotionSnapshot | null {
    // A toolbar change updates the whole document: skip word measurements and cancel any local motion.
    if (previous.globalLevel !== this.props.globalLevel) {
      this.stopMotion?.(); this.stopMotion = null;
      return null;
    }
    const element = this.root.current;
    if (!element || (previous.level === this.props.level && previous.record === this.props.record && previous.source === this.props.source)) return null;
    const scroll = element.closest<HTMLElement>('.reflow-document-scroll') ?? element;
    const before = captureFoldMotion(element, undefined, scroll);
    this.stopMotion?.();
    this.stopMotion = null;
    return before;
  }

  componentDidUpdate(_previous: Props, _state: object, before: FoldMotionSnapshot | null) {
    const element = this.root.current;
    if (!element || !before) return;
    const scroll = element.closest<HTMLElement>('.reflow-document-scroll') ?? element;
    this.stopMotion = playFoldMotion(element, before, undefined, scroll);
  }

  componentWillUnmount() { this.stopMotion?.(); }

  render() {
    const { record, source, level, views } = this.props;
    const view = (views === undefined ? foldViewsForSource(record, source) : views)?.[level];
    if (!view) return <div ref={this.root} className="whitespace-pre-wrap break-words">{source}</div>;
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const token of view.tokens) {
      parts.push(view.text.slice(cursor, token.start));
      parts.push(<span className="inline-block" data-fold-token={token.key} key={token.key}>{token.text}</span>);
      cursor = token.end;
    }
    parts.push(view.text.slice(cursor));
    return <div ref={this.root} className="whitespace-pre-wrap break-words" aria-label={level === 'full' || level === 'brief' ? '作者原文' : 'AI 生成'}>{parts}</div>;
  }
}
