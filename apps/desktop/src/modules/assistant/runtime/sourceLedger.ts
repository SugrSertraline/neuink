import { conversationSourceSnapshotKey, type ConversationSourceLink } from '@/shared/ipc/assistantApi';

/** Stable conversation markers; child evidence is immediately visible to its parent. */
export class SourceLedger {
  readonly sources: Map<number, ConversationSourceLink>;
  constructor(initial?: Map<number, ConversationSourceLink>) {
    this.sources = new Map(initial);
  }
  add(source: ConversationSourceLink): number {
    const key = conversationSourceSnapshotKey(source);
    for (const [marker, existing] of this.sources) {
      // A changed snapshot must never silently inherit a historical marker.
      if (conversationSourceSnapshotKey(existing) === key) return marker;
    }
    const marker = Math.max(0, ...this.sources.keys()) + 1;
    this.sources.set(marker, source);
    return marker;
  }
}
