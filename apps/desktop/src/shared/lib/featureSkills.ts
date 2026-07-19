import type { AssistantTaskPlan } from '@/shared/types/assistant';
import type { FeatureSkillDefinition, FeatureSkillIntent } from '@/shared/types/featureSkill';

export const DEFAULT_FEATURE_SKILL_IDS = [
  'translation.default',
  'tagger.default',
  'metadata.default',
  'summary.default'
] as const;

export const DEFAULT_FEATURE_SKILLS: FeatureSkillDefinition[] = [
  {
    category: 'reading',
    defaultEnabled: true,
    description: 'Translate generic PDF content while preserving formulas, tables, citations, and source segment ids.',
    fallbackMode: 'builtin',
    id: 'translation.default',
    name: 'Neuink Default Translation',
    outputSchemaId: 'translation-output-v1',
    riskPolicy: {
      allowAutoApply: false,
      defaultRisk: 'medium',
      requireConfirmationForHighRisk: true
    },
    taskIntents: ['translate'],
    userEditable: true
  },
  {
    category: 'research',
    defaultEnabled: true,
    description: 'Suggest auditable tag operations after parsing or from assistant conversation.',
    fallbackMode: 'rule',
    id: 'tagger.default',
    name: 'Neuink Default Tagger',
    outputSchemaId: 'tag-operation-output-v1',
    preferredDepth: 3,
    riskPolicy: {
      allowAutoApply: true,
      autoApplyThreshold: 0.9,
      defaultRisk: 'medium',
      requireConfirmationForHighRisk: true
    },
    taskIntents: ['tag_suggest'],
    userEditable: true
  },
  {
    category: 'research',
    defaultEnabled: true,
    description: 'Extract generic key-value metadata without forcing every PDF into a paper schema.',
    fallbackMode: 'rule',
    id: 'metadata.default',
    name: 'Neuink Default Metadata',
    outputSchemaId: 'field-operation-output-v1',
    riskPolicy: {
      allowAutoApply: false,
      defaultRisk: 'medium',
      requireConfirmationForHighRisk: true
    },
    taskIntents: ['metadata_extract'],
    userEditable: true
  },
  {
    category: 'writing',
    defaultEnabled: true,
    description: 'Summarize generic PDF content and propose reusable keywords or note outlines.',
    fallbackMode: 'builtin',
    id: 'summary.default',
    name: 'Neuink Default Summary',
    outputSchemaId: 'summary-output-v1',
    riskPolicy: {
      allowAutoApply: false,
      defaultRisk: 'low',
      requireConfirmationForHighRisk: true
    },
    taskIntents: ['summarize', 'note_outline'],
    userEditable: true
  }
];

export function featureSkillIdsForAssistantIntent(intent: AssistantTaskPlan['intent']) {
  return featureSkillIdsForFeatureIntent(featureIntentFromAssistantIntent(intent));
}

export function featureSkillIdsForFeatureIntent(intent: FeatureSkillIntent | null) {
  if (!intent) {
    return [];
  }
  return DEFAULT_FEATURE_SKILLS.filter(
    (skill) => skill.defaultEnabled && skill.taskIntents.includes(intent)
  ).map((skill) => skill.id);
}

export function featureIntentFromAssistantIntent(
  intent: AssistantTaskPlan['intent']
): FeatureSkillIntent | null {
  switch (intent) {
    case 'paper_summary':
      return 'summarize';
    case 'tag_attach':
    case 'tag_create':
    case 'tag_detach':
    case 'tag_update':
      return 'tag_suggest';
    default:
      return null;
  }
}
