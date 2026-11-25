import { hasDsmlClose, matchDsmlSlice } from './modelToolCallMarkup';

const CONTROL_TAGS = new Set(['tools', 'tool', 'tool_call', 'tool_calls', 'tool_use', 'function_call', 'function_calls']);

/** Hide model-generated tool-control markup while keeping Markdown code examples intact. */
export function visibleAssistantAnswer(answer: string): string {
  if (!answer.includes('<')) return answer;
  let fenced = false;
  let hiddenBlock = false;
  let changed = false;
  const lines = answer.split('\n');
  const visible: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      if (!hiddenBlock) visible.push(line);
      continue;
    }
    if (fenced) {
      if (!hiddenBlock) visible.push(line);
      continue;
    }
    const tag = controlTagInLine(line);
    if (hiddenBlock) {
      changed = true;
      if (tag?.closing && tag.complete) hiddenBlock = false;
      continue;
    }
    if (!tag) {
      visible.push(line);
      continue;
    }
    changed = true;
    if (tag.prefix.trim()) visible.push(tag.prefix.trimEnd());
    if (!tag.closing && tag.complete && !tag.closedLater) hiddenBlock = true;
  }
  return changed ? visible.join('\n').trimEnd() : answer;
}

export function hasAssistantToolMarkup(answer: string) {
  return visibleAssistantAnswer(answer) !== answer;
}

function controlTagInLine(line: string): { prefix: string; closing: boolean; complete: boolean; closedLater: boolean } | null {
  for (let start = line.indexOf('<'); start >= 0; start = line.indexOf('<', start + 1)) {
    if (((line.slice(0, start).match(/(?<!\\)`/g) ?? []).length % 2) !== 0) continue;
    const slice = line.slice(start);
    const ascii = /^<(\/)?([a-z_]+)(?:\s[^<>]*)?(>)?/i.exec(slice);
    if (ascii) {
      const name = ascii[2].toLowerCase();
      const complete = Boolean(ascii[3]);
      if (CONTROL_TAGS.has(name) || (name.length >= 2 && !complete && [...CONTROL_TAGS].some(tag => tag.startsWith(name)))) {
        return { prefix: line.slice(0, start), closing: Boolean(ascii[1]), complete,
          closedLater: complete && slice.slice(ascii[0].length).toLowerCase().includes(`</${name}>`) };
      }
    }
    const dsml = matchDsmlSlice(slice);
    if (!dsml) continue;
    return { prefix: line.slice(0, start), closing: dsml.closing, complete: dsml.complete,
      closedLater: dsml.complete && hasDsmlClose(slice.slice(dsml.raw.length)) };
  }
  return null;
}
