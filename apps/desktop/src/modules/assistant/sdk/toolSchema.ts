import { type AssistantToolDescriptor } from '@/shared/ipc/assistantApi';
import { type AgentExecutionSelection } from '@/shared/types/agentRuntime';
import { type JSONSchema7, type ToolSet } from 'ai';
import { ENTRY_CONTEXT_MAX_CHARS } from './entryContext';
import { isPlainObject } from './toolValues';

export function noteProposalInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      action: {
        description:
          'Proposal action. Use create for a new note, prepend for adding content to the beginning, append for adding content to the end, patch for exact local edits, delete for removing requested content, and replace only for replacing an entire note body.',
        enum: ['create', 'prepend', 'append', 'delete', 'patch', 'replace'],
        type: 'string'
      },
      entry_id: {
        description:
          'Target Entry id. Omit only when a target Entry was explicitly selected or confirmed.',
        type: 'string'
      },
      markdown: {
        description:
          'Markdown body to create, prepend, append, or replace. Put each evidence marker [S#] inline beside the sentence, paragraph or list item it supports. Never collect citations at the end or on separate lines. For patch, this can be a summary; patch_operations are authoritative and their inserted/replacement text must contain the inline citations.',
        type: 'string'
      },
      note_id: {
        description:
          'Target note id for prepend/append/replace. Omit only when an explicit selected note is the target.',
        type: 'string'
      },
      note_title: {
        description: 'Existing note title for prepend/append/replace, if known.',
        type: 'string'
      },
      page_idx: {
        description:
          'Zero-based page index for a target Segment Note. Usually omit this when segment_uid comes from pinned context.',
        type: 'number'
      },
      patch_operations: {
        description:
          'Line-precise Markdown edits for action=patch or delete. Prefer replace_lines, delete_lines, and insert_lines using 1-based logical Markdown lines plus expected_text copied from read_note or read_current_note.',
        items: {
          additionalProperties: false,
          properties: {
            anchor_text: {
              description: 'Exact Markdown anchor text for insert_before or insert_after.',
              type: 'string'
            },
            end_line: {
              description: 'Inclusive 1-based ending logical Markdown line for replace_lines or delete_lines.',
              minimum: 1,
              type: 'number'
            },
            expected_text: {
              description: 'Exact text currently present in the addressed line or line range.',
              type: 'string'
            },
            line: {
              description: '1-based logical Markdown line for insert_lines.',
              minimum: 1,
              type: 'number'
            },
            new_text: {
              description: 'Replacement Markdown for replace_exact.',
              type: 'string'
            },
            old_text: {
              description: 'Exact Markdown text to replace. Must match exactly once.',
              type: 'string'
            },
            position: {
              description: 'Whether insert_lines inserts before or after the addressed line.',
              enum: ['before', 'after'],
              type: 'string'
            },
            start_line: {
              description: 'Inclusive 1-based starting logical Markdown line for replace_lines or delete_lines.',
              minimum: 1,
              type: 'number'
            },
            text: {
              description: 'Markdown text to insert or append.',
              type: 'string'
            },
            type: {
              enum: [
                'replace_lines', 'delete_lines', 'insert_lines',
                'replace_exact', 'insert_after', 'insert_before', 'append'
              ],
              type: 'string'
            }
          },
          required: ['type'],
          type: 'object'
        },
        type: 'array'
      },
      rationale: {
        description: 'Short reason why this note change is useful.',
        type: 'string'
      },
      segment_uid: {
        description:
          'Target segment uid when target is segment_note. Omit to use the first pinned Segment context when available.',
        type: 'string'
      },
      source_markers: {
        description:
          'Only evidence markers actually cited inline in the note content, such as S1 or [S2]. This metadata does not insert citations. For patches, cite in the inserted/replacement text, not just the preview.',
        items: {
          type: 'string'
        },
        type: 'array'
      },
      title: {
        description: 'Title for the new note, or replacement title for prepend/append/replace.',
        type: 'string'
      },
      target: {
        description:
          'Target note type. Use markdown_note for normal Markdown notes. Use segment_note when the user asks to add to or update the note attached to the selected/pinned PDF segment.',
        enum: ['markdown_note', 'segment_note'],
        type: 'string'
      }
    },
    required: ['action'],
    type: 'object'
  } as JSONSchema7;
}

export function readCurrentNoteInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {},
    type: 'object'
  } as JSONSchema7;
}

export function tagProposalInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      action: { enum: ['attach', 'create', 'detach', 'rename'], type: 'string' },
      entry_ids: { items: { type: 'string' }, type: 'array' },
      name: { type: 'string' },
      new_name: { type: 'string' },
      rationale: { type: 'string' },
      tag_id: { type: 'string' }
    },
    required: ['action'],
    type: 'object'
  } as JSONSchema7;
}

export function runSubagentInputSchema(
  activeExecution?: AgentExecutionSelection | null
): JSONSchema7 {
  const allowedAgentIds =
    activeExecution?.agent.allowedSubagentIds.length
      ? activeExecution.agent.allowedSubagentIds
      : undefined;
  return {
    additionalProperties: false,
    properties: {
      agent_id: {
        enum: allowedAgentIds,
        type: 'string'
      },
      instruction: {
        description: 'Specific delegated task instruction for the subagent.',
        type: 'string'
      },
      question: {
        description: 'Optional natural-language user question for the subagent.',
        type: 'string'
      }
    },
    required: ['agent_id', 'instruction'],
    type: 'object'
  } as JSONSchema7;
}

export function modelToolName(toolId: string) {
  const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized || 'tool';
}

export function assertModelToolNameAvailable(
  tools: ToolSet,
  internalToolId: string,
  exposedToolName: string
) {
  if (Object.prototype.hasOwnProperty.call(tools, exposedToolName)) {
    throw new Error(
      `Assistant tools collide after name normalization: ${internalToolId} -> ${exposedToolName}.`
    );
  }
}

export function assertValidModelToolNames(tools: ToolSet) {
  const invalidName = Object.keys(tools).find(
    (name) => !/^[a-zA-Z0-9_-]+$/.test(name)
  );
  if (invalidName) {
    throw new Error(`Invalid model tool function name: ${invalidName}.`);
  }
}

export function proposalToolDescription(toolName: string) {
  if (toolName === 'note.propose_create') {
    return 'Create a reviewable proposal for a new Markdown note. This never writes to disk.';
  }
  if (toolName === 'segment_note.propose_patch') {
    return 'Create a reviewable prepend, append, patch, delete, or replacement proposal for the confirmed Segment Note target.';
  }
  return 'Create a reviewable prepend, append, patch, delete, or replacement proposal for the confirmed Markdown note target.';
}

export function modelInputSchema(descriptor: AssistantToolDescriptor): JSONSchema7 {
  const schema = cloneJsonSchema(descriptor.parameters_schema);
  const objectSchema = schema as JSONSchema7 & {
    properties?: Record<string, JSONSchema7>;
    required?: string[];
  };

  if (objectSchema.type !== 'object') {
    return schema;
  }

  objectSchema.properties = objectSchema.properties ?? {};
  delete objectSchema.properties.root;

  if (descriptor.name === 'read_segment_content') {
    objectSchema.required = ['entry_id', 'segment_uid'];
  } else if (descriptor.name === 'read_entry_assistant_context') {
    objectSchema.required = ['entry_id'];
    objectSchema.properties.offset = { type: 'integer', minimum: 0, description: 'Start at 0. For continuation, copy the exact next_read returned by this tool.' };
    objectSchema.properties.limit = { type: 'integer', minimum: 100, maximum: ENTRY_CONTEXT_MAX_CHARS, description: 'Maximum characters per parsed-text chunk; defaults to 8000.' };
    objectSchema.properties.revision = { type: 'string', pattern: '^[a-f0-9]{8}$', description: 'For offset > 0, copy revision from next_read so changed content cannot be silently mixed.' };
  } else {
    objectSchema.required = (objectSchema.required ?? []).filter((key: string) => key !== 'root');
  }

  describeProperty(objectSchema, 'query', 'Search phrase or question. Use a concise query relevant to this tool.');
  describeProperty(objectSchema, 'mode', 'Search mode. Prefer hybrid for content lookup; use keyword for exact terms.');
  describeProperty(objectSchema, 'scope_entry_ids', 'Optional Entry ids. Omit this to use the current Neuink scope.');
  describeProperty(objectSchema, 'top_k', 'Optional maximum number of segment hits to return.');
  describeProperty(objectSchema, 'entry_id', 'Required Entry id for explicit Entry or segment reads.');
  describeProperty(objectSchema, 'segment_uid', 'Segment uid returned by search_segments.');
  describeProperty(objectSchema, 'doc_id', 'Sciverse document id returned by search_sciverse_evidence.');
  describeProperty(objectSchema, 'offset', 'Optional Unicode character offset for Sciverse content.');
  describeProperty(objectSchema, 'limit', descriptor.name === 'search_papers'
    ? 'Maximum number of papers, an integer from 1 to 10. Use limit, not top_k.'
    : 'Maximum content characters to read.');
  describeProperty(objectSchema, 'title', 'Optional Sciverse paper title from the search result.');
  describeProperty(objectSchema, 'chunk_id', 'Optional Sciverse chunk id from the search result.');
  describeProperty(objectSchema, 'page_no', 'Optional Sciverse page number from the search result.');

  return objectSchema;
}

export function cloneJsonSchema(schema: unknown): JSONSchema7 {
  if (!isPlainObject(schema)) {
    return {
      additionalProperties: true,
      properties: {},
      type: 'object'
    } as JSONSchema7;
  }

  return JSON.parse(JSON.stringify(schema)) as JSONSchema7;
}

export function describeProperty(
  schema: JSONSchema7 & { properties?: Record<string, JSONSchema7> },
  property: string,
  description: string
) {
  const existing = schema.properties?.[property];
  if (existing && isPlainObject(existing) && !existing.description) {
    existing.description = description;
  }
}

export function toolDescription(descriptor: AssistantToolDescriptor) {
  if (descriptor.name === 'search_segments') {
    return `${descriptor.description} Use this for find/locate questions and questions about experiments, methods, datasets, results, tables, figures, or conclusions.`;
  }
  if (descriptor.name === 'read_segment_content') {
    return `${descriptor.description} Use this after search_segments when a snippet is not enough.`;
  }
  if (descriptor.name === 'read_entry_assistant_context') {
    return `${descriptor.description} Use this only for an explicitly selected, named, or confirmed Entry. Omit limit for the default 8000 characters; if supplied, limit must be between 100 and ${ENTRY_CONTEXT_MAX_CHARS}. Parsed text is returned in bounded chunks: when more is true, call this tool again with the returned next_read arguments. Read all chunks when full reading is requested; otherwise state partial coverage. Never read CLI tool-result files with native Read/shell to obtain the rest. If no parsed segments exist, the host reads up to the first 3 PDF text-layer pages automatically. Continue with read_pdf_pages / search_pdf_text; respect next_page and incomplete/OCR warnings.`;
  }
  if (descriptor.name === 'search_sciverse_evidence') {
    return `${descriptor.description} Preserve every returned marker and source identifier in the answer.`;
  }
  if (descriptor.name === 'read_sciverse_content') {
    return `${descriptor.description} Use bounded reads and continue with next_offset only when more context is necessary.`;
  }
  return descriptor.description;
}
