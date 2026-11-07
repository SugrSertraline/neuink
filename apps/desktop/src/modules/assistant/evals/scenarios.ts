import type { AssistantContextSnapshot, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { BrowserTabSnapshot, BrowserTabTarget } from '@/shared/ipc/browserApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import type { AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import type { AssistantNoteProposal, AssistantTaskPlan } from '@/shared/types/assistant';
import type { ApplicationActions } from '../runtime/applicationActions';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { ENTRIES } from './fixtures';
import { listsRecentPapers } from './scenarioChecks';
import type { EvalRun, Scenario } from './types';

const SCOPE: ScopeSnapshot = {
  entry_ids: [ENTRIES.attention.id, ENTRIES.diffusion.id, ENTRIES.scanned.id],
  entry_titles: [ENTRIES.attention.title, ENTRIES.diffusion.title, ENTRIES.scanned.title],
  tag_ids: [],
  tag_names: []
};

const ENTRIES_META = Object.values(ENTRIES).map(entry => ({
  description: `Synthetic entry ${entry.title}`,
  id: entry.id,
  title: entry.title,
  updatedAt: '2026-01-01T00:00:00.000Z'
}));

function settings(mutate?: (value: AgentRuntimeSettings) => void): AgentRuntimeSettings {
  const value = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  mutate?.(value);
  return value;
}

function planFor(request: string, patch: Partial<AssistantTaskPlan>): AssistantTaskPlan {
  return { ...buildDirectExecution(settings(), request).plan, ...patch };
}

function appearanceFixture(): { changes: string[]; actions: ApplicationActions } {
  const changes: string[] = [];
  return {
    changes,
    actions: {
      setAppearance(next) {
        changes.push(next);
        return { previous: 'standard', current: next, persisted: true };
      }
    }
  };
}

const BROWSER_TARGET: BrowserTabTarget = {
  id: 'tab-eval',
  title: 'Browser article (synthetic)',
  url: 'https://example.org/browser-article',
  navigationId: 'nav-eval'
};

const BROWSER_SNAPSHOT: BrowserTabSnapshot = {
  title: 'Browser article (synthetic)',
  url: 'https://example.org/browser-article',
  text:
    'The page describes a three-stage pipeline. Stage one retrieves candidate passages. ' +
    'Stage two reranks them. Stage three generates an answer with inline citations.',
  selection: '',
  truncated: false,
  capturedAt: '2026-01-01T00:00:00.000Z',
  limitations: [],
  contentType: 'webpage',
  extractor: 'readability',
  navigationId: 'nav-eval'
};

const approvedAppearance = appearanceFixture();
const unavailableAppearance = appearanceFixture();

const SCANNED_PDF = {
  revision: 'abcdef12',
  pageCount: 8,
  pages: [
    { page_idx: 0, text: 'Title page. Scanned Longitudinal Study.', truncated: false },
    {
      page_idx: 1,
      text:
        'Methods. The longitudinal cohort enrolled 42 participants and followed them ' +
        'for twelve months.',
      truncated: false
    },
    {
      page_idx: 2,
      text: 'Results. Retention was 91% at twelve months.',
      truncated: false
    },
    { page_idx: 3, text: 'Discussion.', truncated: false },
    { page_idx: 4, text: 'Appendix A. Supplementary tables.', truncated: false },
    { page_idx: 5, text: 'Appendix B. Sensitivity analysis.', truncated: false },
    { page_idx: 6, text: 'Appendix C. Follow-up protocol.', truncated: false },
    { page_idx: 7, text: 'References.', truncated: false }
  ]
};

function scopeCheck(input: Record<string, unknown>, allowed = SCOPE.entry_ids) {
  const requested = input.scope_entry_ids;
  if (requested === undefined) return true;
  return (
    Array.isArray(requested) &&
    requested.every(value => typeof value === 'string' && allowed.includes(value))
  );
}

function hasToolCall(run: EvalRun, names: string[]) {
  return run.calls.some(call => names.includes(call.name));
}

function proposals(run: EvalRun) {
  return run.noteProposals as AssistantNoteProposal[];
}

const AUTHORITATIVE_NOTE = {
  title: '实验记录',
  markdown: [
    '# 实验记录',
    '',
    '- 主实验：big model 在 WMT 2014 英德任务上达到 28.4 BLEU。',
    '- 消融实验：移除位置编码使 BLEU 下降 1.2。',
    '- 对比实验：Diffusion 模型在 ImageNet 256x256 上取得 3.85 FID。',
    ''
  ].join('\n'),
  links: []
};

const NOTE_CONTEXT: AssistantContextSnapshot = {
  active_entry: {
    entry_id: ENTRIES.attention.id,
    entry_title: ENTRIES.attention.title,
    has_pdf: true,
    parse_status: 'parsed'
  },
  active_note: {
    entry_id: ENTRIES.attention.id,
    entry_title: ENTRIES.attention.title,
    note_id: 'note-experiments',
    note_title: AUTHORITATIVE_NOTE.title,
    markdown: AUTHORITATIVE_NOTE.markdown,
    markdown_char_count: AUTHORITATIVE_NOTE.markdown.length,
    source_link_count: 0,
    truncated: false
  },
  document: null,
  pinned_segments: [],
  warnings: []
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'local-lookup',
    title: 'Local paper lookup selects workspace evidence, not the open web',
    category: 'tool-selection',
    prompt:
      'Attention 那篇论文里，big model 在 WMT 2014 英德翻译任务上的 BLEU 是多少？请按论文证据回答。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title }
    },
    expect: {
      anyOf: [['search_segments', 'read_entry_assistant_context']],
      forbidden: ['search_web', 'search_papers', 'read_webpage'],
      arguments: [
        {
          tool: 'search_segments',
          description: 'search query is non-empty',
          check: input => typeof input.query === 'string' && input.query.trim().length > 0
        },
        {
          tool: 'search_segments',
          description: 'search stays inside the frozen scope',
          check: input => scopeCheck(input)
        }
      ],
      answerIncludes: ['28.4'],
      answerMatches: /\[S\d+]/,
      noDuplicateCalls: true,
      maxToolCalls: 6
    }
  },
  {
    id: 'search-then-read',
    title: 'Snippet is insufficient, so the agent reads the full segment before answering',
    category: 'chaining',
    prompt:
      '找到 Attention 论文里关于“移除位置编码”的消融段落，引用原文说明 BLEU 具体下降了多少。只给结论不够，要读到细节。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title }
    },
    expect: {
      required: ['search_segments', 'read_segment_content'],
      ordered: ['search_segments', 'read_segment_content'],
      arguments: [
        {
          tool: 'read_segment_content',
          description: 'reads the ablation segment returned by search at least once',
          match: 'any',
          check: input => input.segment_uid === 'attn-ablation'
        }
      ],
      answerIncludes: ['1.2'],
      answerMatches: /\[S\d+]/,
      // Extra exploration after the answer is already available is insufficient to fail a
      // chaining scenario; restraint is covered by `no-tool` and `diagram`.
      maxToolCalls: 10
    }
  },
  {
    id: 'entry-scope',
    title: 'Named paper constrains reads to that Entry',
    category: 'arguments',
    prompt:
      '只针对《Diffusion Models Beat GANs on Image Synthesis》这篇论文，报告它在 ImageNet 256x256 上的 FID。不要混入其他论文。',
    setup: {
      scope: {
        entry_ids: [ENTRIES.diffusion.id],
        entry_titles: [ENTRIES.diffusion.title],
        tag_ids: [],
        tag_names: []
      },
      currentEntry: { id: ENTRIES.diffusion.id, title: ENTRIES.diffusion.title }
    },
    expect: {
      anyOf: [['read_entry_assistant_context', 'search_segments']],
      forbidden: ['search_web', 'search_papers', 'read_webpage'],
      arguments: [
        {
          tool: 'read_entry_assistant_context',
          description: 'reads the requested Entry',
          check: input => input.entry_id === ENTRIES.diffusion.id
        },
        {
          tool: 'search_segments',
          description: 'never widens the requested Entry scope',
          check: input => scopeCheck(input, [ENTRIES.diffusion.id])
        }
      ],
      answerIncludes: ['3.85'],
      answerMatches: /\[S\d+]/,
      maxToolCalls: 5
    }
  },
  {
    id: 'external-search',
    title: 'Literature discovery uses an external search tool',
    category: 'tool-selection',
    prompt:
      '检索公开论文，列出 3 篇 2023 年及以后关于 retrieval augmented generation 的论文，并给出来源链接。',
    expect: {
      anyOf: [['search_papers', 'search_sciverse_evidence']],
      forbidden: ['search_segments', 'read_entry_assistant_context', 'read_pdf_pages'],
      arguments: [
        {
          tool: 'search_papers',
          description: 'uses the declared limit field within 1–10',
          check: input =>
            input.limit === undefined ||
            (Number.isInteger(input.limit) && Number(input.limit) >= 1 && Number(input.limit) <= 10)
        },
        {
          tool: 'search_papers',
          description: 'sends a non-empty query',
          check: input => typeof input.query === 'string' && input.query.trim().length > 0
        }
      ],
      answerMatches:
        /Retrieval-Augmented Generation|Efficient Retrieval|Faithfulness|arxiv\.org|doi\.org|neuink-papers/i,
      extra: [{ description: 'lists three distinct retrieved papers from 2023 or later',
        check: run => listsRecentPapers(run, 3, 2023) }],
      maxToolCalls: 5
    }
  },
  {
    id: 'web-read',
    title: 'Explicit public URL is read with read_webpage and cited',
    category: 'tool-selection',
    prompt:
      '读一下这篇公开网页 https://example.org/transformer-survey ，总结它的三条要点，并用返回的链接标注来源。',
    expect: {
      required: ['read_webpage'],
      forbidden: ['search_segments', 'search_papers', 'read_entry_assistant_context'],
      arguments: [
        {
          tool: 'read_webpage',
          description: 'reads the exact URL the user supplied',
          check: input => input.url === 'https://example.org/transformer-survey'
        }
      ],
      answerIncludes: ['example.org/transformer-survey'],
      maxToolCalls: 4
    }
  },
  {
    id: 'no-tool',
    title: 'Self-contained rewrite does not trigger tool calls',
    category: 'restraint',
    prompt: '把下面这句话改写得更正式，只输出改写结果：我们需要更多实验。',
    expect: {
      maxToolCalls: 0,
      answerIncludes: ['实验'],
      answerMatches: /.+/
    }
  },
  {
    id: 'web-failure',
    title: 'Failed page read is reported honestly, without duplicate retries',
    category: 'recovery',
    prompt:
      '读一下 https://example.org/blocked-page ，告诉我它讲了什么。',
    setup: {
      fixtures: {
        research: {
          read_webpage: () => {
            throw new Error('远程服务返回 HTTP 403');
          }
        }
      }
    },
    expect: {
      attempted: ['read_webpage'],
      answerMatches: /无法|未能|失败|拒绝|403|不可用|cannot|unable|blocked/i,
      answerExcludes: ['已成功读取', '已成功打开', 'successfully read', 'successfully opened'],
      extra: [
        {
          description: 'never repeats the exact same failed URL',
          check: run => {
            const attempts = run.calls.filter(
              call =>
                call.name === 'read_webpage' &&
                (call.input as Record<string, unknown>).url === 'https://example.org/blocked-page'
            );
            return attempts.length <= 1;
          }
        }
      ],
      maxToolCalls: 6
    }
  },
  {
    id: 'disabled-web',
    title: 'Disabled tools are neither called nor claimed',
    category: 'availability',
    prompt:
      '请打开 https://example.org/private-page 这个网页并总结内容。',
    setup: {
      runtimeSettings: settings(value => {
        value.mainAssistant.enabledToolIds = value.mainAssistant.enabledToolIds.filter(
          id => id !== 'search_web' && id !== 'read_webpage'
        );
      })
    },
    expect: {
      forbidden: ['search_web', 'read_webpage'],
      forbiddenDeclared: ['search_web', 'read_webpage'],
      answerMatches: /无法|不可用|未启用|不能|unavailable|not available|cannot/i,
      maxToolCalls: 3
    }
  },
  {
    id: 'note-proposal',
    title: 'Note writing goes through a reviewable proposal with inline citations',
    category: 'writes',
    prompt:
      '把 Attention 论文里 big model 在 WMT 2014 英德任务上 28.4 BLEU 的结论整理成一条新笔记，并在结论旁标注出处。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title },
      availableEntries: ENTRIES_META
    },
    expect: {
      required: ['note_propose_create'],
      answerExcludes: ['已保存', '已写入笔记', 'saved the note', 'wrote the note'],
      proposal: {
        min: 1,
        max: 1,
        action: 'create',
        markdownIncludes: ['28.4']
      },
      extra: [
        {
          description: 'proposal carries at least one evidence source',
          check: run => proposals(run).every(proposal => proposal.sources.length > 0)
        },
        {
          description: 'proposal content cites the local marker inline',
          check: run => proposals(run).every(proposal => /\[S\d+]/.test(proposal.markdown))
        }
      ],
      maxToolCalls: 6
    }
  },
  {
    id: 'diagram',
    title: 'Mind-map request uses present_diagram with structured nodes',
    category: 'structured-output',
    prompt:
      '用思维导图展示 Transformer 的三个核心组件：多头注意力、位置编码、前馈网络。',
    expect: {
      required: ['present_diagram'],
      arguments: [
        {
          tool: 'present_diagram',
          description: 'creates a mind map containing all three requested components',
          check: input => {
            if (input.kind !== 'mindmap' || !Array.isArray(input.nodes)) return false;
            const labels = input.nodes
              .map(node => (node && typeof node === 'object' ? String((node as { label?: unknown }).label ?? '') : ''))
              .join(' ');
            return /注意力|attention/i.test(labels) && /位置|position/i.test(labels) && /前馈|feed/i.test(labels);
          }
        }
      ],
      answerNotMatches: /```mermaid|graph\s+(TD|LR|BT|RL)\b/i,
      maxToolCalls: 3
    }
  },
  {
    id: 'current-note',
    title: 'Selected note is read through read_current_note',
    category: 'tool-selection',
    prompt: '总结我当前打开的笔记《实验记录》里的三个主要发现。',
    setup: {
      currentNote: {
        entryId: ENTRIES.attention.id,
        entryTitle: ENTRIES.attention.title,
        noteId: 'note-experiments',
        noteTitle: AUTHORITATIVE_NOTE.title
      },
      contextSnapshot: NOTE_CONTEXT,
      fixtures: {
        notes: {
          [`${ENTRIES.attention.id}:note-experiments`]: AUTHORITATIVE_NOTE
        }
      }
    },
    expect: {
      required: ['read_current_note'],
      forbidden: ['search_segments', 'read_pdf_pages', 'search_web', 'search_papers'],
      answerIncludes: ['28.4', '1.2', '3.85'],
      maxToolCalls: 3
    }
  },
  {
    id: 'pdf-text-layer',
    title: 'Unparsed PDF is read through the bounded text-layer tool',
    category: 'tool-selection',
    prompt:
      '这篇 PDF 还没有解析。直接读取第 2 页的文字层，告诉我这一页报告的样本量是多少。',
    setup: {
      scope: {
        entry_ids: [ENTRIES.scanned.id],
        entry_titles: [ENTRIES.scanned.title],
        tag_ids: [],
        tag_names: []
      },
      currentEntry: { id: ENTRIES.scanned.id, title: ENTRIES.scanned.title },
      fixtures: {
        pdf: { [ENTRIES.scanned.id]: SCANNED_PDF }
      }
    },
    expect: {
      required: ['read_pdf_pages'],
      forbidden: ['search_web', 'search_papers'],
      arguments: [
        {
          tool: 'read_pdf_pages',
          description: 'starts at the requested page and respects the 5-page limit',
          check: input =>
            input.start_page === 2 &&
            (input.page_count === undefined ||
              (Number.isInteger(input.page_count) &&
                Number(input.page_count) >= 1 &&
                Number(input.page_count) <= 5))
        }
      ],
      answerIncludes: ['42'],
      answerMatches: /\[S\d+]/,
      maxToolCalls: 4
    }
  },
  {
    id: 'sciverse-evidence',
    title: 'External Sciverse evidence keeps returned citation markers',
    category: 'citations',
    prompt:
      '用 Sciverse 检索 retrieval augmented generation 的可引用证据，并保留检索结果里的引用标记。',
    expect: {
      required: ['search_sciverse_evidence'],
      forbidden: ['search_segments', 'search_papers'],
      arguments: [
        {
          tool: 'search_sciverse_evidence',
          description: 'sends a non-empty query',
          check: input => typeof input.query === 'string' && input.query.trim().length > 0
        }
      ],
      answerIncludes: ['18%'],
      answerMatches: /\[S\d+]/,
      maxToolCalls: 4
    }
  },
  {
    id: 'read-note',
    title: 'Explicit note ids are read through read_note',
    category: 'tool-selection',
    prompt:
      '读取 Entry paper-attn 下的笔记 note-methods，概括里面记录的两个实验结论。',
    setup: {
      fixtures: {
        notes: {
          [`${ENTRIES.attention.id}:note-methods`]: {
            title: '方法笔记',
            markdown:
              '# 方法笔记\n\n- 主实验的 big model 达到 28.4 BLEU。\n- 移除位置编码使 BLEU 下降 1.2。\n',
            links: []
          }
        }
      }
    },
    expect: {
      required: ['read_note'],
      forbidden: ['read_current_note', 'search_segments', 'read_pdf_pages'],
      arguments: [
        {
          tool: 'read_note',
          description: 'reads the explicitly referenced Entry and note ids',
          check: input => input.entry_id === 'paper-attn' && input.note_id === 'note-methods'
        }
      ],
      answerIncludes: ['28.4', '1.2'],
      maxToolCalls: 3
    }
  },
  {
    id: 'subagent-delegation',
    title: 'Bounded evidence delegation reaches the enabled subagent',
    category: 'delegation',
    slow: true,
    prompt:
      '让证据子代理去核对 Diffusion 论文在 ImageNet 256x256 上的 FID，然后把核对结果告诉我。',
    setup: {
      runtimeSettings: settings(value => {
        value.subagents = value.subagents.map(agent =>
          agent.id === 'evidence-agent' ? { ...agent, enabled: true } : agent
        );
      }),
      currentEntry: { id: ENTRIES.diffusion.id, title: ENTRIES.diffusion.title }
    },
    expect: {
      required: ['task_run_subagent'],
      arguments: [
        {
          tool: 'task_run_subagent',
          description: 'delegates to the enabled evidence agent with an instruction',
          check: input =>
            input.agent_id === 'evidence-agent' &&
            typeof input.instruction === 'string' &&
            input.instruction.trim().length > 0
        }
      ],
      extra: [
        {
          description: 'the child independently reads workspace evidence',
          check: run =>
            run.calls.some(
              call =>
                call.phase === 'subagent' &&
                (call.name === 'search_segments' || call.name === 'read_entry_assistant_context')
            )
        }
      ],
      answerIncludes: ['3.85'],
      maxToolCalls: 8
    }
  },
  {
    id: 'compare-two-papers',
    title: 'Two-paper comparison gathers both sources and keeps both citations',
    category: 'multi-source',
    prompt:
      '分别从《Attention Is All You Need》和《Diffusion Models Beat GANs on Image Synthesis》取出各自的代表性结果' +
      '（BLEU 与 FID），用表格对比，并分别标注出处。',
    expect: {
      anyOf: [['search_segments', 'read_entry_assistant_context']],
      answerIncludes: ['28.4', '3.85'],
      extra: [
        {
          description: 'answer cites at least two distinct local markers',
          check: run =>
            new Set([...run.answer.matchAll(/\[S(\d+)]/g)].map(match => match[1])).size >= 2
        },
        {
          description: 'did not silently touch only one paper',
          check: run => {
            const touched = new Set<string>();
            for (const call of run.calls) {
              const input = (call.input ?? {}) as Record<string, unknown>;
              if (typeof input.entry_id === 'string') touched.add(input.entry_id);
              if (Array.isArray(input.scope_entry_ids)) {
                for (const id of input.scope_entry_ids) {
                  if (typeof id === 'string') touched.add(id);
                }
              }
            }
            return (
              touched.size === 0 ||
              (touched.has(ENTRIES.attention.id) && touched.has(ENTRIES.diffusion.id))
            );
          }
        }
      ],
      noDuplicateCalls: true,
      maxToolCalls: 8
    }
  },
  {
    id: 'conflicting-evidence',
    title: 'Body text and appendix disagreement is surfaced, not averaged away',
    category: 'multi-source',
    prompt:
      '《Attention Is All You Need》的正文和附录对 WMT 2014 英德 BLEU 的报告是否一致？' +
      '请给出两个数字和各自出处，并说明为什么不一致。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title }
    },
    expect: {
      anyOf: [['search_segments', 'read_entry_assistant_context']],
      answerIncludes: ['28.4', '27.3'],
      answerMatches: /不一致|差异|不同|附录|appendix|tokeni/i,
      extra: [
        {
          description: 'keeps two distinct citations instead of merging them',
          check: run =>
            new Set([...run.answer.matchAll(/\[S(\d+)]/g)].map(match => match[1])).size >= 2
        }
      ],
      maxToolCalls: 8
    }
  },
  {
    id: 'empty-search-honesty',
    title: 'Empty search results do not become fabricated evidence',
    category: 'recovery',
    prompt:
      '仅核查当前选中的本地论文，不要联网或使用 Sciverse。这篇论文有没有报告在 SQuAD 2.0 上的精确匹配（EM）分数？如果没有可用证据，请说明无法核实，不要编造分数。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title },
      fixtures: {
        invoke: {
          search_segments: input => ({
            query: String(input.query ?? ''),
            mode: 'hybrid',
            index_generation: 1,
            total_hit_count: 0,
            entries: []
          }),
          read_entry_assistant_context: () => ({
            entry_id: ENTRIES.attention.id, entry_title: ENTRIES.attention.title,
            has_pdf: false, parsed_segment_count: 0, markdown: '', sources: []
          })
        },
        pdf: { [ENTRIES.attention.id]: { ...SCANNED_PDF,
          pages: SCANNED_PDF.pages.map(page => ({ ...page, text: '' })) } }
      }
    },
    expect: {
      anyOf: [['search_segments', 'read_entry_assistant_context', 'search_pdf_text', 'read_pdf_pages']],
      forbidden: [
        'search_web',
        'search_papers',
        'read_webpage',
        'search_sciverse_evidence',
        'read_sciverse_content'
      ],
      noDuplicateCalls: true,
      answerMatches: /未找到|没有找到|无法|不足以|证据不足|无相关|no (?:relevant )?evidence|not found|cannot/i,
      answerNotMatches: /\[S\d+]/,
      maxToolCalls: 6
    }
  },
  {
    id: 'scope-refusal',
    title: 'Out-of-scope paper is refused instead of silently widening the scope',
    category: 'boundary',
    prompt:
      '仅使用当前选中的本地论文，不要联网或扩大范围。报告《Diffusion Models Beat GANs on Image Synthesis》在 ImageNet 256x256 上的 FID；如果它不在所选范围，请明确说明。',
    setup: {
      scope: {
        entry_ids: [ENTRIES.attention.id],
        entry_titles: [ENTRIES.attention.title],
        tag_ids: [],
        tag_names: []
      },
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title }
    },
    expect: {
      forbidden: ['search_web', 'search_papers', 'read_webpage', 'search_sciverse_evidence', 'read_sciverse_content'],
      arguments: [
        {
          tool: 'read_entry_assistant_context',
          description: 'never reads an Entry outside the frozen scope',
          check: input => input.entry_id === ENTRIES.attention.id
        },
        {
          tool: 'search_segments',
          description: 'never passes Entry ids outside the frozen scope',
          check: input => scopeCheck(input, [ENTRIES.attention.id])
        }
      ],
      answerExcludes: ['3.85'],
      answerMatches: /不在|未包含|范围|选择|添加|scope|not (?:in|available)/i,
      maxToolCalls: 4
    }
  },
  {
    id: 'pdf-out-of-range',
    title: 'Out-of-range PDF page becomes an honest page-count limitation',
    category: 'recovery',
    prompt: '这篇 PDF 只有 8 页，请读取第 99 页并总结。',
    setup: {
      scope: {
        entry_ids: [ENTRIES.scanned.id],
        entry_titles: [ENTRIES.scanned.title],
        tag_ids: [],
        tag_names: []
      },
      currentEntry: { id: ENTRIES.scanned.id, title: ENTRIES.scanned.title },
      fixtures: { pdf: { [ENTRIES.scanned.id]: SCANNED_PDF } }
    },
    expect: {
      answerMatches: /8\s*页|共 ?8|only 8|页数|页码|page count/i,
      answerExcludes: ['第 99 页的内容是'],
      maxToolCalls: 4
    }
  },
  {
    id: 'pdf-out-of-range-tool',
    title: 'PDF tool rejects an invalid page when the total is not supplied',
    category: 'recovery',
    prompt: '请实际检查这篇 PDF 的第 99 页，能读取就总结，页码无效则说明实际总页数。',
    setup: {
      scope: { entry_ids: [ENTRIES.scanned.id], entry_titles: [ENTRIES.scanned.title], tag_ids: [], tag_names: [] },
      currentEntry: { id: ENTRIES.scanned.id, title: ENTRIES.scanned.title },
      fixtures: { pdf: { [ENTRIES.scanned.id]: SCANNED_PDF } }
    },
    expect: {
      attempted: ['read_pdf_pages'],
      arguments: [{ tool: 'read_pdf_pages', description: 'checks the requested page',
        match: 'any',
        check: input => input.start_page === 99 }],
      answerMatches: /8\s*页|共 ?8|only 8|页数|页码|page count/i,
      answerExcludes: ['第 99 页的内容是'],
      maxToolCalls: 3
    }
  },
  {
    id: 'sciverse-search-then-read',
    title: 'Sciverse evidence is followed by a bounded document read',
    category: 'chaining',
    prompt:
      '先用 Sciverse 找到关于 retrieval augmented generation 的证据，再读取同一文档的上下文，' +
      '把忠实度提升和延迟代价都写出来，并保留引用标记。',
    setup: {
      fixtures: {
        invoke: {
          search_sciverse_evidence: () => ({
            hits: [
              {
                chunk: 'Retrieval-augmented generation improved answer faithfulness by 18%.',
                chunk_id: 'chunk-1',
                doc_id: 'scv-rag-001',
                offset: 0,
                page_no: 3,
                title: 'A Controlled Study of Retrieval-Augmented Generation',
                abstract: 'We compare retrieval-augmented generation with parametric-only baselines.',
                author: ['Fay Example'],
                publication_published_year: 2024,
                publication_venue_name_unified: 'Synthetic NLP Conference',
                source_type: 'journal_article',
                score: 0.93
              }
            ],
            counts: { returned: 1, total: 1 },
            query: 'retrieval augmented generation'
          }),
          read_sciverse_content: () => ({
            chars_returned: 140,
            doc_id: 'scv-rag-001',
            more: false,
            next_offset: null,
            text: 'The same study reports a 40 ms retrieval latency overhead per query.'
          })
        }
      }
    },
    expect: {
      required: ['search_sciverse_evidence', 'read_sciverse_content'],
      ordered: ['search_sciverse_evidence', 'read_sciverse_content'],
      arguments: [
        {
          tool: 'read_sciverse_content',
          description: 'reads the doc_id returned by the search',
          check: input => input.doc_id === 'scv-rag-001'
        }
      ],
      answerIncludes: ['18%', '40 ms'],
      answerMatches: /\[S\d+]/,
      maxToolCalls: 4
    }
  },
  {
    id: 'tag-proposal',
    title: 'Tag change is a reviewable proposal, not an applied write',
    category: 'writes',
    prompt: '给《Attention Is All You Need》加上 transformer 标签。',
    setup: { availableEntries: ENTRIES_META },
    expect: {
      required: ['tag_propose_change'],
      arguments: [
        {
          tool: 'tag_propose_change',
          description: 'attaches the tag to the named Entry and names the tag',
          check: input =>
            input.action === 'attach' &&
            Array.isArray(input.entry_ids) &&
            input.entry_ids.includes(ENTRIES.attention.id) &&
            (typeof input.name === 'string' || typeof input.tag_id === 'string')
        }
      ],
      answerExcludes: ['已添加', '已应用', '已修改'],
      extra: [
        {
          description: 'exactly one pending tag proposal is produced',
          check: run => run.tagProposals.length === 1
        }
      ],
      maxToolCalls: 3
    }
  },
  {
    id: 'entry-meta-proposal',
    title: 'Entry metadata edit is grounded in evidence and left pending',
    category: 'writes',
    prompt:
      '根据论文内容，把《Attention Is All You Need》这个条目的简介字段改成一句新简介，生成待审阅的元数据修改提案，并给出依据；不要只在聊天中给出文案。',
    setup: {
      currentEntry: { id: ENTRIES.attention.id, title: ENTRIES.attention.title },
      availableEntries: ENTRIES_META,
      plan: planFor('为 Attention 论文写一句新简介', {
        target: { kind: 'entry_meta', entryId: ENTRIES.attention.id },
        entryMetaChange: { entryId: ENTRIES.attention.id, fields: ['description'] },
        citationPolicy: 'required',
        capabilities: ['read_document', 'propose_entry_meta_change'],
        needsDocumentContext: true
      })
    },
    expect: {
      required: ['entry_propose_meta_patch'],
      arguments: [
        {
          tool: 'entry_propose_meta_patch',
          description: 'proposes a non-empty description',
          check: input =>
            typeof input.description === 'string' && input.description.trim().length > 0
        }
      ],
      answerExcludes: ['已更新', '已保存'],
      extra: [
        {
          description: 'creates one pending metadata proposal with a source',
          check: run =>
            run.entryMetaProposals.length === 1 &&
            run.entryMetaProposals[0].sources.length > 0
        }
      ],
      maxToolCalls: 5
    }
  },
  {
    id: 'appearance-change',
    title: 'Approved appearance change uses the enum tool once',
    category: 'host-tools',
    prompt: '把界面切换成液态玻璃（liquid-glass）风格。',
    setup: {
      applicationActions: approvedAppearance.actions,
      approval: 'approve',
      beforeRun: () => {
        approvedAppearance.changes.length = 0;
      }
    },
    expect: {
      required: ['app_set_appearance'],
      arguments: [
        {
          tool: 'app_set_appearance',
          description: 'requests the exact liquid-glass enum',
          check: input => input.appearance === 'liquid-glass'
        }
      ],
      answerMatches: /液态玻璃|liquid-glass|已切换|changed/i,
      extra: [
        {
          description: 'applies the change exactly once',
          check: () =>
            approvedAppearance.changes.length === 1 &&
            approvedAppearance.changes[0] === 'liquid-glass'
        }
      ],
      maxToolCalls: 2
    }
  },
  {
    id: 'appearance-unavailable',
    title: 'Unavailable approval does not become a fake appearance change',
    category: 'host-tools',
    prompt: '把界面切换成工作室（atelier）风格。',
    setup: {
      applicationActions: unavailableAppearance.actions,
      beforeRun: () => {
        unavailableAppearance.changes.length = 0;
      }
    },
    expect: {
      attempted: ['app_set_appearance'],
      answerMatches: /需要确认|确认|未更改|无法|approval|confirmation/i,
      answerExcludes: ['已切换', '已更改'],
      extra: [
        {
          description: 'never applies an unapproved appearance change',
          check: () => unavailableAppearance.changes.length === 0
        }
      ],
      maxToolCalls: 2
    }
  },
  {
    id: 'import-approval',
    title: 'Approved paper import uses returned ids and reports only the receipt',
    category: 'host-tools',
    prompt: '搜索并下载第一篇关于 retrieval augmented generation 的论文，导入当前文库。',
    setup: {
      approval: 'approve',
      fixtures: {
        research: {
          import_papers: () => ({
            results: [{ id: '2401.00001', status: 'imported', entry_id: ENTRIES.attention.id }]
          })
        }
      }
    },
    expect: {
      required: ['import_papers'],
      arguments: [
        {
          tool: 'import_papers',
          description: 'uses the raw returned id, never a research: presentation ref',
          check: input =>
            Array.isArray(input.paper_ids) &&
            input.paper_ids.includes('2401.00001') &&
            !input.paper_ids.some(id => String(id).startsWith('research:'))
        }
      ],
      answerMatches: /导入|入库|下载|imported|added/i,
      answerExcludes: ['已解析', '已读全文'],
      maxToolCalls: 4
    }
  },
  {
    id: 'import-unavailable',
    title: 'Missing approval is explained instead of claiming a download',
    category: 'host-tools',
    prompt:
      '搜索并下载第一篇关于 retrieval augmented generation 的论文，导入当前文库。' +
      '如果无法完成，请说明原因并给出来源链接。',
    expect: {
      extra: [
        {
          description: 'either requests approval or explains the missing approval',
          check: run =>
            run.calls.some(call => call.name === 'import_papers') ||
            /确认|approval|确定|需要/i.test(run.answer)
        }
      ],
      answerExcludes: ['已导入', '已下载并导入', '已成功导入'],
      maxToolCalls: 4
    }
  },
  {
    id: 'browser-tab-read',
    title: 'Frozen browser tab is read without substituting a URL fetch',
    category: 'host-tools',
    prompt:
      '总结我当前浏览器标签页里的正文，并引用它返回的来源链接。',
    setup: {
      browserTabTarget: BROWSER_TARGET,
      browserTab: BROWSER_SNAPSHOT
    },
    expect: {
      required: ['read_browser_tab'],
      forbidden: ['read_webpage', 'search_web'],
      answerIncludes: ['example.org/browser-article'],
      answerMatches: /三阶段|three-stage|pipeline|rerank|检索/i,
      maxToolCalls: 3
    }
  }
];

export { SCOPE, ENTRIES_META, settings, hasToolCall };
