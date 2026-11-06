import { Component, createRef, type ReactNode } from 'react';
import { longestCommonFoldPairs, normalizeFoldToken, tokenizeFoldText, type FoldToken } from './foldAlignment';
import { captureFoldMotion, playFoldMotion, type FoldMotionSnapshot } from './foldMotion';
import type { FoldLevel } from './useFoldReader';

type Token = FoldToken & { key: string };
type Props = { text: string; globalLevel?: FoldLevel };
type State = { text: string; tokens: Token[]; nextId: number; globalLevel?: FoldLevel };

/** Align cached Chinese levels against each other without treating them as source evidence. */
export class FoldTranslatedParagraph extends Component<Props, State, FoldMotionSnapshot | null> {
  state: State = { text: '', tokens: [], nextId: 0 };
  private readonly root = createRef<HTMLDivElement>();
  private stopMotion: (() => void) | null = null;

  static getDerivedStateFromProps(props: Props, previous: State): State | null {
    const globalChanged = props.globalLevel !== previous.globalLevel;
    if (props.text === previous.text) return globalChanged ? { ...previous, globalLevel: props.globalLevel } : null;
    const tokens = tokenizeFoldText(props.text);
    // Bulk changes do not need the character alignment used only for local transitions.
    const pairs = globalChanged ? [] : longestCommonFoldPairs(tokens.map(token => normalizeFoldToken(token.text)), previous.tokens.map(token => normalizeFoldToken(token.text)));
    const previousKeys = new Map(pairs.map(([next, old]) => [next, previous.tokens[old].key]));
    let nextId = previous.nextId;
    return { text: props.text, tokens: tokens.map((token, index) => ({ ...token, key: previousKeys.get(index) ?? `translation:${nextId++}` })), nextId, globalLevel: props.globalLevel };
  }

  getSnapshotBeforeUpdate(props: Props, previous: State): FoldMotionSnapshot | null {
    if (props.globalLevel !== this.props.globalLevel) {
      this.stopMotion?.(); this.stopMotion = null;
      return null;
    }
    const element = this.root.current;
    if (!element || previous.text === this.state.text) return null;
    const scroll = element.closest<HTMLElement>('.reflow-document-scroll') ?? element;
    const before = captureFoldMotion(element, undefined, scroll);
    this.stopMotion?.(); this.stopMotion = null;
    return before;
  }
  componentDidUpdate(_props: Props, _state: State, before: FoldMotionSnapshot | null) {
    const element = this.root.current;
    if (!element || !before) return;
    this.stopMotion = playFoldMotion(element, before, undefined, element.closest<HTMLElement>('.reflow-document-scroll') ?? element);
  }
  componentWillUnmount() { this.stopMotion?.(); }

  render() {
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const token of this.state.tokens) {
      parts.push(this.state.text.slice(cursor, token.start));
      parts.push(<span key={token.key} className="inline-block" data-fold-token={token.key}>{token.text}</span>);
      cursor = token.end;
    }
    parts.push(this.state.text.slice(cursor));
    return <div ref={this.root} className="whitespace-pre-wrap break-words" aria-label="中文译文">{parts}</div>;
  }
}
