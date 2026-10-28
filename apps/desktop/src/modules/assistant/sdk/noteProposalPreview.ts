import { type AssistantContextSnapshot } from '@/shared/ipc/assistantApi';
import {
  type AssistantMarkdownPatchOperation,
  type AssistantNoteProposalAction
} from '@/shared/types/assistant';
import { ToolPreconditionError } from './toolFailurePolicy';
import {
  asObject,
  noteSnapshotKey,
  requiredEnum,
  requiredPositiveLine,
  requiredString,
  requiredStringAllowEmpty
} from './toolValues';

export function proposalBeforeMarkdown({
  action,
  contextSnapshot,
  entryId,
  noteId,
  readNoteSnapshots,
  targetKind
}: {
  action: AssistantNoteProposalAction;
  contextSnapshot?: AssistantContextSnapshot | null;
  entryId: string;
  noteId: string | null;
  readNoteSnapshots: Map<string, { markdown: string; title: string }>;
  targetKind: 'markdown_note' | 'segment_note';
}) {
  if (targetKind !== 'markdown_note' || action === 'create' || !noteId) {
    return action === 'create' ? '' : null;
  }

  const explicitlyRead = readNoteSnapshots.get(noteSnapshotKey(entryId, noteId));
  if (explicitlyRead) return explicitlyRead.markdown;

  const activeNote = contextSnapshot?.active_note;
  if (!activeNote || activeNote.entry_id !== entryId || activeNote.note_id !== noteId) {
    return null;
  }

  return activeNote.markdown;
}

export function proposalAfterMarkdown({
  action,
  beforeMarkdown,
  markdown,
  patchOperations,
  targetKind
}: {
  action: AssistantNoteProposalAction;
  beforeMarkdown: string | null;
  markdown: string;
  patchOperations?: AssistantMarkdownPatchOperation[];
  targetKind: 'markdown_note' | 'segment_note';
}) {
  if (targetKind !== 'markdown_note') {
    return markdown;
  }

  if ((action === 'patch' || action === 'delete') && beforeMarkdown !== null && patchOperations) {
    try {
      return applyMarkdownPatchPreview(beforeMarkdown, patchOperations);
    } catch {
      return null;
    }
  }

  if (action === 'append' && beforeMarkdown !== null) {
    return appendMarkdownPreview(beforeMarkdown, markdown);
  }

  if (action === 'prepend' && beforeMarkdown !== null) {
    return prependMarkdownPreview(beforeMarkdown, markdown);
  }

  return markdown;
}

export function appendMarkdownPreview(currentMarkdown: string, markdownToAppend: string) {
  const current = currentMarkdown.trimEnd();
  const next = markdownToAppend.trim();
  if (!current) {
    return ensureTrailingNewlinePreview(next);
  }
  if (!next) {
    return ensureTrailingNewlinePreview(current);
  }
  return ensureTrailingNewlinePreview(`${current}\n\n${next}`);
}

export function prependMarkdownPreview(currentMarkdown: string, markdownToPrepend: string) {
  const current = currentMarkdown.trim();
  const previous = markdownToPrepend.trim();
  if (!previous) {
    return ensureTrailingNewlinePreview(current);
  }
  if (!current) {
    return ensureTrailingNewlinePreview(previous);
  }
  return ensureTrailingNewlinePreview(`${previous}\n\n${current}`);
}

export function ensureTrailingNewlinePreview(markdown: string) {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : '';
}

export function applyMarkdownPatchPreview(
  markdown: string,
  operations: AssistantMarkdownPatchOperation[]
) {
  let nextMarkdown = markdown;

  for (const operation of operations) {
    if (operation.type === 'append') {
      nextMarkdown = appendMarkdownPreview(nextMarkdown, operation.text);
      continue;
    }

    if (operation.type === 'replace_exact') {
      if (countOccurrences(nextMarkdown, operation.oldText) !== 1) {
        throw new ToolPreconditionError('patch_content_mismatch');
      }
      nextMarkdown = nextMarkdown.replace(operation.oldText, operation.newText);
      continue;
    }

    if (
      operation.type === 'replace_lines' ||
      operation.type === 'delete_lines' ||
      operation.type === 'insert_lines'
    ) {
      nextMarkdown = applyLinePatchPreview(nextMarkdown, operation);
      continue;
    }

    const matchCount = countOccurrences(nextMarkdown, operation.anchorText);
    if (matchCount !== 1) {
      throw new ToolPreconditionError('patch_content_mismatch');
    }

    const index = nextMarkdown.indexOf(operation.anchorText);
    nextMarkdown =
      operation.type === 'insert_before'
        ? `${nextMarkdown.slice(0, index)}${operation.text}${nextMarkdown.slice(index)}`
        : `${nextMarkdown.slice(0, index + operation.anchorText.length)}${operation.text}${nextMarkdown.slice(index + operation.anchorText.length)}`;
  }

  return ensureTrailingNewlinePreview(nextMarkdown);
}

function applyLinePatchPreview(
  markdown: string,
  operation: Extract<
    AssistantMarkdownPatchOperation,
    { type: 'delete_lines' | 'insert_lines' | 'replace_lines' }
  >
) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  if (operation.type === 'insert_lines') {
    if (operation.line > lines.length) {
      throw new ToolPreconditionError('patch_content_mismatch');
    }
    const currentLine = lines[operation.line - 1] ?? '';
    if (currentLine !== operation.expectedText) {
      throw new ToolPreconditionError('patch_content_mismatch');
    }
    const insertion = operation.text.replace(/\r\n/g, '\n').split('\n');
    const index = operation.position === 'before' ? operation.line - 1 : operation.line;
    lines.splice(index, 0, ...insertion);
    return lines.join('\n');
  }

  if (operation.endLine < operation.startLine || operation.endLine > lines.length) {
    throw new ToolPreconditionError('patch_content_mismatch');
  }
  const currentText = lines.slice(operation.startLine - 1, operation.endLine).join('\n');
  if (currentText !== operation.expectedText.replace(/\r\n/g, '\n')) {
    throw new ToolPreconditionError('patch_content_mismatch');
  }
  const replacement = operation.type === 'replace_lines'
    ? operation.newText.replace(/\r\n/g, '\n').split('\n')
    : [];
  lines.splice(operation.startLine - 1, operation.endLine - operation.startLine + 1, ...replacement);
  return lines.join('\n');
}

export function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const nextIndex = haystack.indexOf(needle, index);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    index = nextIndex + needle.length;
  }
  return count;
}

export function markdownPatchOperations(value: unknown): AssistantMarkdownPatchOperation[] {
  if (!Array.isArray(value)) {
    throw new Error('patch_operations is required for patch proposals.');
  }

  const operations = value.map((item, index) => {
    const object = asObject(item);
    const type = object.type;

    if (type === 'replace_exact') {
      return {
        newText: requiredStringAllowEmpty(object.new_text, `patch_operations[${index}].new_text`),
        oldText: requiredString(object.old_text, `patch_operations[${index}].old_text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'insert_after' || type === 'insert_before') {
      return {
        anchorText: requiredString(object.anchor_text, `patch_operations[${index}].anchor_text`),
        text: requiredStringAllowEmpty(object.text, `patch_operations[${index}].text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'append') {
      return {
        text: requiredStringAllowEmpty(object.text, `patch_operations[${index}].text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'replace_lines') {
      return {
        endLine: requiredPositiveLine(object.end_line, `patch_operations[${index}].end_line`),
        expectedText: requiredStringAllowEmpty(
          object.expected_text,
          `patch_operations[${index}].expected_text`
        ),
        newText: requiredStringAllowEmpty(object.new_text, `patch_operations[${index}].new_text`),
        startLine: requiredPositiveLine(object.start_line, `patch_operations[${index}].start_line`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'delete_lines') {
      return {
        endLine: requiredPositiveLine(object.end_line, `patch_operations[${index}].end_line`),
        expectedText: requiredStringAllowEmpty(
          object.expected_text,
          `patch_operations[${index}].expected_text`
        ),
        startLine: requiredPositiveLine(object.start_line, `patch_operations[${index}].start_line`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'insert_lines') {
      return {
        expectedText: requiredStringAllowEmpty(
          object.expected_text,
          `patch_operations[${index}].expected_text`
        ),
        line: requiredPositiveLine(object.line, `patch_operations[${index}].line`),
        position: requiredEnum(
          object.position,
          `patch_operations[${index}].position`,
          ['before', 'after']
        ),
        text: requiredStringAllowEmpty(object.text, `patch_operations[${index}].text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    throw new Error(`Unsupported patch operation type at patch_operations[${index}].`);
  });

  if (operations.length === 0) {
    throw new Error('patch_operations must contain at least one operation.');
  }

  return operations;
}

export function patchOperationsPreview(operations: AssistantMarkdownPatchOperation[]) {
  return operations
    .map((operation) => {
      if (operation.type === 'replace_exact') {
        return operation.newText;
      }
      if (operation.type === 'append') {
        return operation.text;
      }
      if (operation.type === 'replace_lines') return operation.newText;
      if (operation.type === 'delete_lines') return '';
      return operation.text;
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}
