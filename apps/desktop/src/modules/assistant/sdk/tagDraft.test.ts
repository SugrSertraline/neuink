import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeEntryTags } from '@/shared/ipc/assistantApi';
import type { AssistantTaskPlan } from '@/shared/types/assistant';
import type { SkillPackage } from '@/shared/types/agentRuntime';

import { generateTagDraftProposals } from './tagDraft';

vi.mock('@/shared/ipc/assistantApi', () => ({ analyzeEntryTags: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it('passes the user language preference to the Tag Skill and returns multiple proposals', async () => {
  vi.mocked(analyzeEntryTags).mockResolvedValue({
    recommendations: [
      { confidence: 0.9, dimension: 'domain', path: '机器学习/智能体', reason: '研究领域', source: 'new' },
      { confidence: 0.8, dimension: 'method', path: '大语言模型/工具调用', reason: '核心方法', source: 'new' }
    ],
    skill_version: 'custom-paper-tagger:2'
  });

  const proposals = await generateTagDraftProposals({
    plan: tagPlan(), question: '阅读论文，生成一些中文 Tag', root: 'C:/workspace',
    skill: skill()
  });

  expect(analyzeEntryTags).toHaveBeenCalledWith({
    entryId: 'entry-1', instruction: '阅读论文，生成一些中文 Tag', root: 'C:/workspace',
    skillId: 'custom-paper-tagger'
  });
  expect(proposals).toMatchObject([
    { name: '机器学习/智能体', rationale: '研究领域', skillVersion: 'custom-paper-tagger:2' },
    { name: '大语言模型/工具调用', rationale: '核心方法' }
  ]);
});

function skill(): SkillPackage {
  return {
    category: 'research', description: 'Custom tag selector', enabled: true, files: [],
    id: 'custom-paper-tagger', installedAt: null, kind: 'installed', metadataOnly: false,
    name: 'Custom Paper Tagger', packagePath: 'C:/skills/tagger', readme: '# Tagger',
    resourcePaths: { assets: [], references: [], scripts: [] },
    scriptExecution: 'disabled', skillMarkdownPath: 'C:/skills/tagger/SKILL.md',
    skillSpecVersion: 'agent-skills', sourceArchivePath: null, suggestedToolIds: [],
    triggers: ['tags'], version: '2'
  };
}

function tagPlan(): AssistantTaskPlan {
  return {
    attachments: [], capabilities: ['read_document', 'propose_tag_change'], confidence: 1,
    deliverables: ['tag_change_proposal'], intent: 'tag_attach', missing: [],
    needsCurrentNote: false, needsDocumentContext: true, needsNoteProposal: false,
    needsSegmentSearch: false, rationale: '', request: '阅读论文，生成一些中文 Tag', steps: [],
    tagChange: { action: 'attach', deriveFromDocument: true, entryIds: ['entry-1'] },
    target: { entryId: 'entry-1', kind: 'chat_only' }
  };
}
