import { conversationSourceKey, type ConversationSourceLink } from '@/shared/ipc/assistantApi';

/** One marker namespace per run tree; child evidence is immediately visible to its parent. */
export class SourceLedger {
  readonly sources: Map<number, ConversationSourceLink>;
  constructor(initial?: Map<number, ConversationSourceLink>) {
    this.sources = new Map(initial);
  }
  add(source: ConversationSourceLink): number {
    const key = conversationSourceKey(source);
    for (const [marker, existing] of this.sources) {
      if (conversationSourceKey(existing) === key) return marker;
    }
    const marker = Math.max(0, ...this.sources.keys()) + 1;
    this.sources.set(marker, source);
    return marker;
  }
}
