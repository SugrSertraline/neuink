export type FeatureSkillIntent =
  | 'metadata_extract'
  | 'note_outline'
  | 'query_rewrite'
  | 'summarize'
  | 'tag_suggest'
  | 'translate';

export type FeatureSkillRisk = 'low' | 'medium' | 'high';

export type FeatureSkillFallbackMode = 'builtin' | 'rule' | 'disabled';

export type FeatureSkillDefinition = {
  category: 'reading' | 'research' | 'writing' | 'report' | 'automation' | 'custom';
  defaultEnabled: boolean;
  description: string;
  fallbackMode: FeatureSkillFallbackMode;
  id: string;
  name: string;
  outputSchemaId: string;
  preferredDepth?: number;
  riskPolicy: {
    autoApplyThreshold?: number;
    defaultRisk: FeatureSkillRisk;
    allowAutoApply: boolean;
    requireConfirmationForHighRisk: boolean;
  };
  taskIntents: FeatureSkillIntent[];
  userEditable: boolean;
};
