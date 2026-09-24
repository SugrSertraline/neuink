import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, ChevronRight, Clock3, Folder, Info, LayoutGrid, List, Maximize2, Minimize2, NotebookPen, Search, Settings2, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { papers, initialNotes, type DemoPaper } from './atelierData';
import { TactileIcon, IconSpecimens } from './AtelierIcons';
import { useDemoAppearance } from './useDemoAppearance';
import '../../styles/globals.css';
import './atelier.css';

type Section = 'papers' | 'notes';
function Cover({ paper, miniature = false }: { paper: DemoPaper; miniature?: boolean }) {
  return <span className={`atelier-book ${miniature ? 'miniature' : ''}`} data-cover={paper.color} aria-hidden="true">
    <span className="book-pages" /><span className="book-front">
      <span className="book-edition">NEUINK / RESEARCH SERIES</span>
      <span className="book-title">{paper.short}</span>
      <span className={`book-art art-${paper.art}`}><i /><i /><i /><i /><i /></span>
      <span className="book-subtitle">{paper.subtitle}</span>
      <span className="book-imprint"><span>VOL. {paper.id}</span><span>{paper.year}</span></span>
      {paper.progress > 0 && paper.progress < 100 ? <span className="book-ribbon" /> : null}
    </span>
  </span>;
}
function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild><Button className="atelier-tool" size="icon-sm" variant="ghost" aria-label={label} onClick={onClick}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function AtelierShowcase() {
  const { skin, setSkin } = useDemoAppearance();
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [section, setSection] = useState<Section>('papers');
  const [display, setDisplay] = useState<'shelf' | 'list'>(() => skin === 'atelier' ? 'shelf' : 'list');
  const [category, setCategory] = useState('软件工程');
  const [selected, setSelected] = useState(papers[0]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [reader, setReader] = useState<DemoPaper | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [noteId, setNoteId] = useState(initialNotes[0].id);
  const [draft, setDraft] = useState(initialNotes[0].text);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [onlyReading, setOnlyReading] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const note = notes.find(item => item.id === noteId)!;
  const secret = search.trim().toLowerCase() === 'theme';
  const found = papers.filter(paper => `${paper.title} ${paper.subtitle} ${paper.category}`.toLowerCase().includes(search.toLowerCase()));
  const filtered = papers.filter(paper => (category === '软件工程' || category === '全部条目' || paper.category === category)
    && `${paper.title} ${paper.subtitle}`.toLowerCase().includes(query.toLowerCase()) && (!onlyReading || (paper.progress > 0 && paper.progress < 100)));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearch(''); setCommandOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice('请在浏览器独立窗口中打开此样稿');
    }
  };
  const switchSkin = () => {
    if (!secret) return;
    const next = skin === 'classic' ? 'atelier' : 'classic';
    const remembered = setSkin(next);
    setDisplay(next === 'atelier' ? 'shelf' : 'list'); setSearch(''); setCommandOpen(false);
    setNotice(remembered ? (next === 'atelier' ? '欢迎回来，书房风格已记住' : '已退出拟物风格') : '已切换风格；浏览器未允许记住此选择');
  };
  const openNote = (id: string) => { const next = notes.find(item => item.id === id)!; setNoteId(id); setDraft(next.text); setNoteOpen(true); };
  const saveNote = () => { setNotes(items => items.map(item => item.id === noteId ? { ...item, text: draft } : item)); setNotice('已保存在本次 Demo 中'); };
  const openSearch = () => { setSearch(''); setCommandOpen(true); };
  const modeLabel = skin === 'atelier' ? '书房' : '条目库';
  return <div className="atelier-theme atelier-demo" data-skin={skin}>
    <header className="atelier-chrome">
      <div className="atelier-wordmark"><span className="brand-stamp">N</span><b>NeuInk</b><span className="chrome-divider" /><span>{modeLabel}</span></div>
      <Button ref={searchButton} variant="plain" className="atelier-global-search" onClick={openSearch}><Search size={15} /><span>搜索条目、标签、笔记…</span><kbd>Ctrl K</kbd></Button>
      <div className="atelier-window-actions"><IconButton label={fullscreen ? '退出全屏' : '全屏预览'} onClick={() => { void toggleFullscreen(); }}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton><IconButton label="设计说明" onClick={() => setGuideOpen(true)}><Info size={16} /></IconButton><span className="atelier-avatar">S</span></div>
    </header>
    <div className="atelier-workspace">
      <aside className="atelier-navigation">
        <div className="atelier-owner"><span className="owner-label">MY COLLECTION</span><strong>我的研究室</strong></div>
        <nav aria-label="资料导航">
          <Button variant="plain" className="atelier-nav-item" aria-pressed={section === 'papers'} onClick={() => setSection('papers')}><TactileIcon kind="library" /><span>论文收藏</span><small>06</small></Button>
          <Button variant="plain" className="atelier-nav-item" aria-pressed={section === 'notes'} onClick={() => setSection('notes')}><TactileIcon kind="notes" /><span>标签笔记</span><small>03</small></Button>
          <Button variant="plain" className="atelier-nav-item" onClick={openSearch}><TactileIcon kind="search" /><span>搜索资料</span></Button>
        </nav>
        <div className="atelier-nav-heading"><span>研究主题</span><TactileIcon kind="tags" /></div>
        <nav className="atelier-tags" aria-label="研究主题">
          {['软件工程', '需求对齐', '人机协作', '智能体'].map((tag, index) => <Button key={tag} variant="plain" className={`atelier-tag-item ${index ? 'nested' : ''}`} aria-current={category === tag ? 'page' : undefined} onClick={() => { setCategory(tag); setSection('papers'); setQuery(''); }}>
            {index ? <span className="tag-dot" /> : <Folder size={14} />}<span>{tag}</span><small>{index ? papers.filter(p => p.category === tag).length : 6}</small>
          </Button>)}
        </nav>
        <div className="atelier-sidebar-bottom"><span className="mini-bookmark"><Bookmark size={14} /></span><div><b>慢慢读，认真想。</b><p>让每一个想法有所归属。</p></div></div>
        <Button variant="plain" className="atelier-material-link" onClick={() => setGuideOpen(true)}><Settings2 size={14} />样稿说明</Button>
      </aside>
      <main className="atelier-main">
        <div className="atelier-tab-strip"><span><BookOpen size={13} />{modeLabel}<span className="tab-indicator" /></span><span className="tab-strip-label">{skin === 'atelier' ? 'A PLACE FOR YOUR IDEAS' : 'NeuInk Library'}</span></div>
        <div className="atelier-heading"><div><div className="atelier-breadcrumb">全部条目 <ChevronRight size={11} /> {section === 'papers' ? '研究主题' : '笔记'}</div><h1>{section === 'papers' ? category : '标签笔记'}</h1><p>{section === 'papers' ? `${filtered.length} 篇论文 · 每一次阅读，都留下一点理解` : '3 篇笔记 · 把零散的想法，写成自己的理解'}</p></div><span className="atelier-shelf-seal"><BookOpen size={22} strokeWidth={1.2} /><span>私人藏书</span></span></div>
        <div className="atelier-toolbar"><div className="atelier-local-search"><Search size={14} /><Input aria-label="筛选论文" placeholder="在收藏中查找…" value={query} onChange={event => setQuery(event.target.value)} disabled={section !== 'papers'} />{query ? <Button size="icon-xs" variant="plain" aria-label="清除筛选" onClick={() => setQuery('')}><X size={12} /></Button> : null}</div><Button className="atelier-tool" variant="outline" size="sm" aria-pressed={onlyReading} onClick={() => { setOnlyReading(value => !value); setSection('papers'); }}><Clock3 size={13} />正在阅读</Button>
          {skin === 'atelier' && section === 'papers' ? <div className="atelier-segmented" aria-label="显示方式"><Button variant="plain" size="sm" aria-pressed={display === 'shelf'} onClick={() => setDisplay('shelf')}><LayoutGrid size={13} />书架</Button><Button variant="plain" size="sm" aria-pressed={display === 'list'} onClick={() => setDisplay('list')}><List size={13} />列表</Button></div> : null}
        </div>
        <ScrollArea className="atelier-content-scroll">
          {section === 'notes' ? <div className="atelier-notebooks"><div className="notebook-section-label"><span>随手记下，日后重逢</span><small>FIELD NOTES / 03</small></div>{notes.map((item, index) => <Button variant="plain" key={item.id} className="atelier-notebook" onClick={() => openNote(item.id)}><span className="notebook-binding" /><span className="notebook-number">0{index + 1}</span><span className="notebook-label"><small>{item.tag} / RESEARCH NOTES</small><strong>{item.title}</strong><span>{item.text.split('\n')[0]}</span><em>{item.date} · 点击翻开</em></span><NotebookPen size={24} strokeWidth={1.3} /></Button>)}</div>
            : display === 'shelf' && skin === 'atelier' ? <div className="atelier-shelves">{[0, 3].map(offset => filtered.slice(offset, offset + 3).length ? <div className="atelier-shelf" key={offset}><div className="shelf-backlight" /><div className="atelier-book-row">{filtered.slice(offset, offset + 3).map(paper => <div key={paper.id} className="atelier-book-item" data-selected={selected.id === paper.id}><button className="atelier-book-pick" aria-label={`选择论文 ${paper.title}`} aria-pressed={selected.id === paper.id} onClick={() => setSelected(paper)} onDoubleClick={() => setReader(paper)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSelected(paper); setReader(paper); } }} title={`${paper.title} · 双击或按 Enter 翻阅`}><Cover paper={paper} /></button><div className="shelf-book-caption"><strong>{paper.subtitle}</strong><span>{paper.progress === 100 ? <><Check size={11} />已读完</> : paper.progress ? `已读 ${paper.progress}%` : '等待翻阅'}<span className="caption-dot">·</span>{paper.notes} 篇笔记</span></div></div>)}</div><div className="shelf-plank"><span>{offset ? '探索与发现' : '最近放回书架'}</span><i /></div></div> : null)}{!filtered.length ? <div className="atelier-empty"><BookOpen size={30} /><h2>这里暂时没有论文</h2><p>试试其他标题，或清除筛选。</p><Button variant="outline" onClick={() => { setQuery(''); setOnlyReading(false); }}>清除筛选</Button></div> : null}<div className="atelier-shelf-footer"><span className="shelf-line" />纸上得来，心中留下。<span className="shelf-line" /></div></div>
              : <div className="atelier-table-wrap"><Table className="atelier-table"><TableHeader><TableRow><TableHead>论文</TableHead><TableHead>阅读进度</TableHead><TableHead>标签</TableHead><TableHead>笔记</TableHead></TableRow></TableHeader><TableBody>{filtered.map(paper => <TableRow key={paper.id} data-selected={selected.id === paper.id}><TableCell><button onClick={() => setSelected(paper)} onDoubleClick={() => setReader(paper)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSelected(paper); setReader(paper); } }} title={`${paper.title} · 双击或按 Enter 翻阅`}><span className="table-book"><Cover paper={paper} miniature /></span><span><b>{paper.title}</b><small>{paper.subtitle} · {paper.year}</small></span></button></TableCell><TableCell><span className="atelier-small-progress"><i style={{ width: `${paper.progress}%` }} /></span><small>{paper.progress ? `${paper.progress}%` : '未开始'}</small></TableCell><TableCell><span className="atelier-tag-chip">{paper.category}</span></TableCell><TableCell>{paper.notes}</TableCell></TableRow>)}</TableBody></Table>{!filtered.length ? <p className="atelier-empty">没有匹配的论文。</p> : null}</div>}
        </ScrollArea>
      </main>
      <aside className="atelier-inspector">
        <div className="inspector-label"><span>{section === 'papers' ? '书签夹' : '笔记索引'}</span><Bookmark size={14} /></div>
        <ScrollArea className="inspector-scroll"><div className="inspector-inner">
          {section === 'papers' ? <><div className="inspector-cover-wrap"><Cover paper={selected} miniature /><span>SELECTED READING<br /><b>NO. {selected.id}</b></span></div><span className="inspector-eyebrow">{selected.venue}</span><h2>{selected.title}</h2><div className="inspector-meta">{selected.year}<span>·</span>{selected.pages} 页<span>·</span>PDF</div><p className="inspector-abstract">{selected.abstract}</p>
            <div className="inspector-reading"><div className="reading-dial" style={{ '--read-progress': `${selected.progress}%` } as CSSProperties}><span>{selected.progress}<small>%</small></span></div><div><strong>{selected.progress === 100 ? '已经读完' : selected.progress ? '上次读到这里' : '等待第一次翻阅'}</strong><p>{selected.progress ? `第 ${Math.max(1, Math.round(selected.pages * selected.progress / 100))} / ${selected.pages} 页` : '新的想法，正在等你'}</p></div></div>
            <Button className="atelier-primary" onClick={() => setReader(selected)}><BookOpen size={15} />{selected.progress && selected.progress < 100 ? '继续阅读' : '翻开这本论文'}<ArrowRight size={14} /></Button>
            <div className="inspector-related"><span>相关笔记</span><Button variant="plain" onClick={() => openNote(initialNotes[0].id)}><NotebookPen size={15} /><span>需求究竟在什么时候被理解？<small>标签笔记 · 需求对齐</small></span><ChevronRight size={12} /></Button></div>
          </> : <><div className="notebook-intro"><TactileIcon kind="notes" /><h2>写下自己的理解</h2><p>论文是起点，笔记是留下的路。</p></div><div className="inspector-related"><span>笔记里的线索</span>{['需求的表达与澄清', '可检验的研究证据', '人与模型的协作'].map(text => <p key={text}><Tag size={12} />{text}</p>)}</div><p className="inspector-abstract">选择左侧的一本笔记，查看引用来源，也可以在样稿中试写几句话。</p></>}
        </div></ScrollArea>
      </aside>
    </div>
    <footer className="atelier-status"><span><i className="status-led" />设计预览 · 示例资料</span><span role="status">{notice || (skin === 'atelier' ? '书房风格 / 已开启' : '在顶部搜索中输入 theme，再按 Enter 体验隐藏风格')}</span>{skin === 'atelier' ? <Button variant="plain" size="xs" onClick={() => { setSkin('classic'); setDisplay('list'); }}>退出拟物</Button> : <span>原有风格</span>}</footer>

    <Dialog open={commandOpen} onOpenChange={setCommandOpen}><DialogContent className="atelier-theme atelier-command" data-skin={skin} onCloseAutoFocus={event => { event.preventDefault(); searchButton.current?.focus(); }}><DialogHeader><DialogTitle>搜索资料</DialogTitle><DialogDescription>查找论文、标签和笔记</DialogDescription></DialogHeader><div className="command-input"><Search size={18} /><Input autoFocus aria-label="全局搜索" placeholder="搜索条目、标签、笔记…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (secret) switchSkin(); else if (search && found.length) { setSelected(found[0]); setSection('papers'); setCommandOpen(false); } } }} /></div>
      {secret ? <Button className="atelier-secret-command" variant="plain" onClick={switchSkin}><span className="secret-key">S</span><span><b>{skin === 'classic' ? '打开拟物' : '回到原有风格'}</b><small>{skin === 'classic' ? '有温度的材质，为认真阅读而来。' : '保留当前选择与笔记草稿。'}</small></span><kbd>↵</kbd></Button> : search ? <div className="command-results">{found.length ? found.slice(0, 4).map(paper => <Button variant="plain" key={paper.id} onClick={() => { setSelected(paper); setSection('papers'); setCommandOpen(false); }}><BookOpen size={15} /><span>{paper.title}<small>{paper.subtitle}</small></span></Button>) : <p>没有匹配的资料。</p>}</div> : <p className="command-hint">输入关键词开始查找</p>}
    </DialogContent></Dialog>
    <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent className="atelier-theme atelier-guide" data-skin={skin}><DialogHeader><DialogTitle>拟物 / 图标与光影</DialogTitle><DialogDescription>保留温润的材质与光影，让书房延续熟悉的质感。</DialogDescription></DialogHeader><IconSpecimens /><div className="material-samples"><span data-material="metal">暖灰金属</span><span data-material="linen">亚麻织物</span><span data-material="wood">胡桃木</span><span data-material="paper">米白纸张</span></div><p>图标采用真正透明的 PNG，保留布纹、皮革、玻璃和金属各自的质感。柔光统一从左上方落下；保留金属工具栏、织物导航和实体按钮的光影，只减轻搜索框的内凹。书架和正文继续保留熟悉的浏览方式。</p><p>可试用：搜索隐藏入口、书架／列表、主题筛选、论文详情、阅读预览及笔记编辑。</p><p className="guide-boundary">独立样稿，不读取真实资料，不修改原有风格。通过暗号开启后，会记住当前风格；点击“退出拟物”才会回到原有风格。试写内容在刷新后重置。</p><p>进入方式：搜索 <code>theme</code>，按 Enter。</p></DialogContent></Dialog>
    <Dialog open={Boolean(reader)} onOpenChange={value => { if (!value) setReader(null); }}><DialogContent layout="bounded" className="atelier-theme atelier-reader" data-skin={skin}><DialogHeader><DialogTitle><BookOpen size={16} />阅读预览</DialogTitle><DialogDescription>示例排版，用于体验纸张、工具栏和阅读光影。</DialogDescription></DialogHeader><div className="reader-toolbar"><Button size="sm" variant="outline" className="atelier-tool" onClick={() => { setReader(null); setSection('papers'); }}><ArrowLeft size={13} />放回书架</Button><span>01 / {reader?.pages}</span><Button size="sm" variant="outline" className="atelier-tool" onClick={() => { setReader(null); openNote(initialNotes[0].id); }}><NotebookPen size={13} />打开笔记</Button></div><ScrollArea className="reader-scroll"><article className="atelier-paper-sheet"><span className="paper-running-head">NEUINK · READING COLLECTION</span><h1>{reader?.title}</h1><p className="paper-byline">Research collection / {reader?.year}</p><hr /><h2>摘要 / Abstract</h2><p>{reader?.abstract}</p><p>理解并不总是发生在第一次阅读。当我们把不同的观点放在一起，问题的轮廓才开始清晰。保留原文、记录疑问，然后回到证据中寻找答案。</p><blockquote>“把新的发现放回已有的知识中，才是阅读真正开始的地方。”</blockquote><h2>01　从问题出发</h2><div className="paper-columns"><p>每一次阅读，都从一个具体的问题开始。我们关注作者如何提出假设，如何收集材料，又如何解释那些不完全符合预期的结果。</p><p>在这一过程中，笔记承载的不只是摘要，还有当时的疑问、判断，以及后来改变想法的原因。让来源与理解并排存在。</p></div><span className="paper-page-number">— 1 —</span></article></ScrollArea></DialogContent></Dialog>
    <Dialog open={noteOpen} onOpenChange={setNoteOpen}><DialogContent layout="bounded" className="atelier-theme atelier-note-editor" data-skin={skin}><DialogHeader><DialogTitle>{note.title}</DialogTitle><DialogDescription>{note.tag} · 标签笔记</DialogDescription></DialogHeader><div className="note-source-strip"><Bookmark size={13} /><span>{note.sources}</span></div><Textarea className="atelier-writing-paper" aria-label="笔记内容" value={draft} onChange={event => setDraft(event.target.value)} /><div className="note-editor-footer"><span>{draft === note.text ? '已保存在本次 Demo 中' : '未保存'}</span><Button className="atelier-primary" size="sm" disabled={draft === note.text} onClick={saveNote}>保存笔记</Button></div></DialogContent></Dialog>
  </div>;
}

const demoRoot = createRoot(document.getElementById('root')!);
demoRoot.render(<TooltipProvider><AtelierShowcase /></TooltipProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => demoRoot.unmount());
