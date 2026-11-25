import type { PaperCard } from '@/shared/ipc/ideationApi';
import researchStudioLicense from './researchstudio/LICENSE?raw';
export { researchStudioLicense };

// Adapted from Microsoft ResearchStudio-Idea, MIT; source snapshot and license
// are bundled under researchstudio/. These are research prompts, not facts.
export const researchStudioRevision = '063f10088af49909e1a4a7ea8d29efe19633f34e';
export const researchStudioUrl = `https://github.com/microsoft/ResearchStudio/tree/${researchStudioRevision}/ResearchStudio-Idea/skills/idea_spark/references`;
export const presetEntryId = 'ideation-preset';
export const userEntryId = 'ideation-user';
type Pattern = { id: string; title: string; body: string; when: string };
const patterns: Pattern[] = [
  { id: 'assumption_audit_and_pivot', title: '检查并改变关键假设', body: '找出方法依赖的假设，尝试放宽它，或构造反例检验它失效时的行为。', when: '方法的结论或可靠性依赖现实中可能不成立的条件。' },
  { id: 'architectural_operator_substitution', title: '替换算子或表示', body: '定位造成成本或复杂度的算子或表示，寻找保留关键性质的替代方式。', when: '某个特定计算环节构成瓶颈。' },
  { id: 'generative_process_redesign', title: '重新设计生成过程', body: '将生成或迭代流程中固定的部分视为可调整变量，探索新的流程。', when: '生成过程的固定组件可能限制效果或效率。' },
  { id: 'controlled_diagnostic_design', title: '设计控制混杂因素的诊断', body: '控制可能产生捷径的因素，对目标能力进行更可靠的比较。', when: '已有指标可能受混杂因素或表面线索影响。' },
  { id: 'unify_into_shared_representation', title: '将异构输入统一表示', body: '将不同类型的输入或任务映射到共享表示，再用共同机制处理。', when: '不同输入由多套各自独立的流程处理。' },
  { id: 'reframe_as_solvable_object', title: '重构为可求解问题', body: '将原问题重新表述为已有工具可处理的优化、选择、博弈或约束问题。', when: '原问题难以直接求解，但可能对应成熟的问题类别。' },
  { id: 'self_supervised_signal_engineering', title: '构造自监督信号', body: '从模型输出、内部状态或数据中构造学习与适应信号。', when: '真实标签缺失或成本较高。' },
  { id: 'structural_prior_encoding', title: '将结构先验融入方法', body: '在表示、模型或约束中直接体现已知结构，减少不符合结构的可能解。', when: '已知结构对问题成立，且现有方法未充分利用。' },
  { id: 'algebraic_equivalence_unification', title: '通过等价关系统一方法', body: '分析不同过程或目标是否具有可证明的等价关系，再考虑统一形式。', when: '多种表面不同的方法可能具有共同基础。' },
  { id: 'heterogeneous_decomposition', title: '区分不同情况分别处理', body: '识别具有不同性质的组成部分，拆分后为各部分设计适当处理。', when: '统一处理方式无法适应明显不同的情况。' },
  { id: 'decompose_and_delegate', title: '拆分并交给不同求解器', body: '将任务拆成子问题，分别交给适合的学习方法、符号方法或外部求解器。', when: '复杂任务中不同部分需要不同类型的能力。' },
  { id: 'relax_discrete_search_to_continuous', title: '将离散搜索连续化', body: '将离散选择转化为可优化的连续形式，并检查所得近似与原问题的关系。', when: '离散搜索空间大且难以直接优化。' },
  { id: 'adapt_via_conditioning', title: '通过条件信息适应变化', body: '通过输入条件或上下文调整模型行为，而不是为每种情况单独训练。', when: '面对多个变化情境且重复训练成本较高。' },
  { id: 'characterize_limit_then_surpass', title: '先刻画限制再突破', body: '明确现有方法的能力边界，分析造成限制的条件，再探索可改变的部分。', when: '需要确定当前方法究竟在哪些条件下失效。' },
  { id: 'targeted_self_supervised_objective', title: '设计针对特定性质的自监督目标', body: '构造与目标性质相关的辅助任务，使训练信号针对需要的能力。', when: '通用自监督目标未充分覆盖目标性质。' }
];
const originals = import.meta.glob('./researchstudio/ideation-sub-patterns/C*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const researchPatterns = patterns.map(pattern => ({ ...pattern, cardId: `research-pattern-${pattern.id.replace(/_/g, '-')}`,
  subpatterns: Object.entries(originals).flatMap(([path, content]) => {
    if (!content.includes(`\`${pattern.id}\``)) return [];
    const code = path.match(/(C\d\d)\.md$/)?.[1];
    const excerpt = content.match(/## Tactical pattern\s+([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
    return code && excerpt ? [{ code, excerpt }] : [];
  }).sort((a, b) => a.code.localeCompare(b.code)) }));
export const researchPatternCards: PaperCard[] = researchPatterns.map(pattern => ({ id: pattern.cardId, entry_id: presetEntryId, kind: 'idea', origin: 'preset', title: pattern.title, body: `${pattern.body}\n适用情形：${pattern.when}` }));
