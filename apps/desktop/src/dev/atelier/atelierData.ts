export type DemoPaper = {
  id: string; title: string; short: string; subtitle: string; author: string; year: string;
  venue: string; category: string; color: string; art: string; progress: number; pages: number; notes: number; abstract: string;
};

// Fictional bibliographic details for visual exploration only; no workspace data or IPC.
export const papers: DemoPaper[] = [
  { id: '01', title: 'Bridging the Gap between User Intent and LLM', short: 'Understanding\nIntent', subtitle: '从用户意图到需求对齐', author: 'Research collection', year: '2025', venue: '软件工程 · 研究选读', category: '需求对齐', color: 'oxblood', art: 'orbit', progress: 68, pages: 12, notes: 3,
    abstract: '当自然语言成为软件的接口，我们如何让模糊的意图变成可验证的需求？从表达、澄清与证据三个角度，整理人与模型之间的理解过程。' },
  { id: '02', title: 'The Shape of Human–AI Collaboration', short: 'Human &\nMachine', subtitle: '人机协作的边界与默契', author: 'Research collection', year: '2025', venue: '人机交互 · 研究选读', category: '人机协作', color: 'forest', art: 'arch', progress: 34, pages: 18, notes: 5,
    abstract: '将人工判断与自动化能力放在同一个工作流程中，研究协作、反馈与信任如何共同影响最终结果。' },
  { id: '03', title: 'From What to How: Aligning Requirements with Code', short: 'From What\nto How', subtitle: '让需求与实现保持一致', author: 'Research collection', year: '2026', venue: '软件工程 · 研究选读', category: '需求对齐', color: 'sand', art: 'grid', progress: 0, pages: 16, notes: 1,
    abstract: '沿着需求、设计和实现之间的关联追踪证据，观察每一次迭代中的偏移，并让改变的原因可以被理解。' },
  { id: '04', title: 'Making Machine Evidence Human Inspectable', short: 'Visible\nEvidence', subtitle: '让机器的证据可被审视', author: 'Research collection', year: '2026', venue: '人工智能 · 研究选读', category: '人机协作', color: 'navy', art: 'rays', progress: 100, pages: 27, notes: 8,
    abstract: '不仅展示结论，也展示得出结论的材料。通过可追溯的引用、上下文和人工批注，让研究判断回到证据本身。' },
  { id: '05', title: 'Stepwise Requirement Refinement for Language Models', short: 'The Art of\nRefinement', subtitle: '逐步澄清，逐步接近', author: 'Research collection', year: '2026', venue: '软件工程 · 研究选读', category: '需求对齐', color: 'clay', art: 'steps', progress: 12, pages: 21, notes: 2,
    abstract: '将复杂任务拆成可讨论、可验证的小步骤，通过连续反馈减少理解偏差，并保留每一步的决策记录。' },
  { id: '06', title: 'A Field Guide to Reliable Software Agents', short: 'Working\nwith Agents', subtitle: '与智能体一起工作的笔记', author: 'Research collection', year: '2026', venue: '软件工程 · 研究选读', category: '智能体', color: 'slate', art: 'orbit', progress: 0, pages: 24, notes: 0,
    abstract: '从真实工作中的失败与恢复出发，梳理智能体的验证、反馈与协作机制，为长期任务建立稳定的工作方式。' },
];

export const initialNotes = [
  { id: 'n1', title: '需求究竟在什么时候被理解？', tag: '需求对齐', sources: 'Understanding Intent · From What to How', date: '今天', text: '一个暂时的判断：需求对齐不是一次性的确认，而是在实现和验证中反复建立的共同理解。\n\n接下来要对比：论文如何区分“表达完整”和“真正理解”？' },
  { id: 'n2', title: '把证据留在结论旁边', tag: '人机协作', sources: 'Visible Evidence · Human & Machine', date: '昨天', text: '不要只记录结论，也要留下支持它和反对它的证据。\n\n同一个问题，在不同论文中可能采用完全不同的评价方法。' },
  { id: 'n3', title: '阅读中还没有答案的问题', tag: '智能体', sources: 'Working with Agents', date: '09 / 12', text: '长任务的可靠性来自哪里？\n\n检查点、可恢复状态与人工介入分别解决什么问题？' },
];
