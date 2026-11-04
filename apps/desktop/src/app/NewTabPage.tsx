export type NewTabDestination = 'create-entry' | 'browser' | 'zotero' | 'mineru' | 'library' | 'daily-dashboard';

const groups: Array<{ title: string; items: Array<{ id: NewTabDestination; title: string; description: string }> }> = [
  { title: '新建', items: [
    { id: 'create-entry', title: '论文条目', description: '添加论文信息、PDF 或解析结果' },
    { id: 'browser', title: '网页标签', description: '打开网页并收集资料' },
  ] },
  { title: '导入', items: [
    { id: 'zotero', title: 'Zotero 文献', description: '从本机 Zotero 资料库选择文献' },
    { id: 'mineru', title: 'MinerU 解析结果', description: '导入已有的论文解析文件' },
  ] },
  { title: '打开', items: [
    { id: 'library', title: '条目库', description: '查看和整理已有论文' },
    { id: 'daily-dashboard', title: '每日看板', description: '查看今天的阅读与任务' },
  ] },
];

export function NewTabPage({ onChoose }: { onChoose: (destination: NewTabDestination) => void }) {
  return <section aria-label="新建标签" className="@container/new-tab h-full min-h-0 overflow-y-auto overscroll-contain bg-card px-5 py-8 text-foreground">
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">打开什么？</h1>
        <p className="text-sm text-muted-foreground">选择后会在当前标签打开。</p>
      </header>
      {groups.map(group => <div key={group.title} className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{group.title}</h2>
        <div className="grid grid-cols-1 gap-2 @min-[650px]/new-tab:grid-cols-2">
          {group.items.map(item => <button key={item.id} type="button" onClick={() => onChoose(item.id)}
            className="flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-md border border-border bg-card px-4 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-sm font-medium">{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.description}</span>
          </button>)}
        </div>
      </div>)}
    </div>
  </section>;
}
