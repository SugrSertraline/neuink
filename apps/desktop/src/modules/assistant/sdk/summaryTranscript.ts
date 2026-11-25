import type { ModelMessage } from 'ai';

/** Lossless input coverage: chunking belongs to the summarizer, never tail-slice here. */
export function renderMessagesForSummary(messages: readonly ModelMessage[], _legacyLimit?: number): string {
  return messages.map(message => {
    if (typeof message.content === 'string') return message.role + ': ' + message.content;
    const parts = message.content.flatMap(part => {
      if (part.type === 'text') return [part.text];
      if (part.type === 'tool-call') return [
        'Tool call ' + part.toolName + ' (' + part.toolCallId + '): ' + JSON.stringify(part.input)
      ];
      if (part.type === 'tool-result') return [
        'Tool result ' + part.toolName + ' (' + part.toolCallId + ', ' + part.output.type + '): '
          + ('value' in part.output && typeof part.output.value === 'string'
            ? part.output.value : JSON.stringify(part.output))
      ];
      // Provider thinking/signatures are transport data, not conversation facts.
      return [];
    });
    return message.role + ': ' + parts.join('\n');
  }).join('\n\n');
}
