import type { JSONSchema7 } from 'ai';

import type { AssistantEntryMetaProposal } from '@/shared/types/assistant';

export function entryMetaProposalInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    anyOf: [{ required: ['title'] }, { required: ['description'] }],
    properties: {
      description: {
        description:
          'Proposed Entry description. Supply this when description is requested; use an empty string only when the user asked to clear it.',
        type: 'string'
      },
      entry_id: {
        description: 'Exact target Entry id from the frozen task plan.',
        type: 'string'
      },
      rationale: {
        description: 'One short reason for the proposed metadata change.',
        type: 'string'
      },
      source_markers: {
        description:
          'Paper evidence markers supporting generated metadata, such as S1 or [S2].',
        items: { type: 'string' },
        type: 'array'
      },
      title: {
        description: 'Proposed non-empty Entry title.',
        type: 'string'
      }
    },
    type: 'object'
  };
}

export function entryMetaProposalSummary(proposal: AssistantEntryMetaProposal) {
  return `Prepared a title/description proposal for ${proposal.entryTitle}.`;
}

export const ENTRY_META_PROPOSAL_TOOL_DESCRIPTION =
  'Create a reviewable title and/or description proposal for an exact Entry target. Read paper context first when the change is paper-derived. This never writes to disk.';
