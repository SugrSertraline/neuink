/** One run's display text: keep block boundaries and reconcile final snapshots with deltas. */
export class ReasoningBlocks {
  private blocks = new Map<string, string>();
  private lastKey: string | null = null;

  constructor(private emit: (text: string) => void) {}

  append(key: string, text: string) {
    if (!text) return;
    this.blocks.set(key, (this.blocks.get(key) ?? '') + text);
    const separator = this.lastKey !== null && this.lastKey !== key ? '\n\n' : '';
    this.lastKey = key;
    this.emit(separator + text);
  }

  complete(key: string, text: string) {
    const previous = this.blocks.get(key) ?? '';
    // A repeated/shorter snapshot must not repeat displayed text. A compatible final
    // block can supply a missing suffix; divergent snapshots leave streamed text intact.
    if (text.startsWith(previous)) this.append(key, text.slice(previous.length));
  }
}
