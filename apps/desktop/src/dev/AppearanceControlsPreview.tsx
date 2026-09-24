import { useState } from 'react';
import { Columns2, Search, MessageSquare } from 'lucide-react';
import { AppearanceIcon } from '@/shared/components/AppearanceIcon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarSectionHeader } from '@/modules/library/components/SidebarSectionHeader';
import { SidebarContentRow } from '@/modules/library/components/SidebarContentRow';
import { FileText, Plus } from 'lucide-react';

/** DEV only. Local control state; DialogBody owns scrolling and Radix owns focus/keys. No dragging or persistence. */
export function AppearanceControlsPreview() {
  const [enabled, setEnabled] = useState(true);
  const [children, setChildren] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [message, setMessage] = useState('按钮、选择框和开关均复用正式组件。');
  return <Dialog>
    <DialogTrigger asChild><Button size="sm" variant="outline">控件检查</Button></DialogTrigger>
    <DialogContent layout="bounded" className="h-[min(38rem,calc(100%-2rem))]">
      <DialogHeader>
        <DialogTitle>控件与交互</DialogTitle>
        <DialogDescription>查看当前主题的按钮、开关与选择状态。Tab 移动焦点，空格切换，Esc 关闭。</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-5 px-1 py-1">
        <section className="space-y-2" aria-label="玻璃材质样例">
          <h3 className="font-medium">透光与边缘</h3>
          <div className="relative flex h-36 items-center justify-center gap-3 overflow-hidden rounded-lg border" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 23px, color-mix(in srgb, var(--primary) 28%, transparent) 23px 25px), repeating-linear-gradient(0deg, transparent 0 23px, color-mix(in srgb, var(--primary) 28%, transparent) 23px 25px), var(--glass-ambient, var(--muted))' }}>
            <Button variant="outline" className="h-12 px-6" onClick={() => setMessage('点击与玻璃光影相互独立。')}>透光按钮</Button>
            <Popover><PopoverTrigger asChild><Button variant="outline">查看玻璃浮层</Button></PopoverTrigger><PopoverContent className="w-64"><p className="font-medium">清晰的内容，透光的背景</p><p className="mt-2 text-sm text-muted-foreground">网格经过边缘时弯折。鼠标移动时，高光随位置改变。</p></PopoverContent></Popover>
          </div>
        </section>
        <section className="space-y-2" aria-label="助手图标示例">
          <h3 className="font-medium">助手图标</h3>
          <Tooltip><TooltipTrigger asChild><Button variant="plain" size="icon" aria-label="助手"><AppearanceIcon kind="assistant"><MessageSquare /></AppearanceIcon></Button></TooltipTrigger><TooltipContent>大模型对话</TooltipContent></Tooltip>
        </section>
        <section className="space-y-2" aria-label="按钮示例">
          <h3 className="font-medium">按钮</h3>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMessage('已保存示例。')}>保存笔记</Button>
            <Button variant="outline" onClick={() => setMessage('已打开示例。')}>打开论文</Button>
            <Button variant="secondary">阅读统计</Button>
            <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" aria-label="分屏打开"><Columns2 /></Button></TooltipTrigger><TooltipContent>在右侧分屏打开</TooltipContent></Tooltip>
            <Button variant="ghost">更多</Button>
            <Tooltip><TooltipTrigger asChild><Button variant="plain" size="icon" aria-label="新建笔记"><Plus /></Button></TooltipTrigger><TooltipContent>新建笔记</TooltipContent></Tooltip>
            <Button variant="destructive">移入回收站</Button>
            <Button variant="outline" disabled>暂不可用</Button>
          </div>
        </section>
        <section className="space-y-1" aria-label="折叠与列表示例">
          <SidebarSectionHeader label="文档笔记 · 1" open={notesOpen} onToggle={() => setNotesOpen(value => !value)} controlsId="preview-notes" action={<Button variant="plain" size="icon-xs" aria-label="添加示例笔记" onClick={() => setMessage('添加按钮独立于折叠。')}><Plus /></Button>} />
          <div id="preview-notes" hidden={!notesOpen} data-material="panel-body">
            <SidebarContentRow active icon={<FileText size={14} />} label="研究问题与阅读线索" meta="文档笔记 · 已保存" onClick={() => setMessage('已打开笔记示例。')} />
            <SidebarContentRow active={false} disabled icon={<FileText size={14} />} label="只读来源" meta="不可编辑" onClick={() => {}} />
          </div>
        </section>
        <section className="space-y-1" aria-label="开关示例">
          <h3 className="font-medium">开关</h3>
          <div className="flex items-center justify-between border-b py-2"><label htmlFor="preview-reading">显示阅读进度</label><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{enabled ? '开启' : '关闭'}</span><Switch id="preview-reading" checked={enabled} onCheckedChange={setEnabled} /></div></div>
          <div className="flex items-center justify-between border-b py-2"><label htmlFor="preview-children">包含子标签</label><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{children ? '开启' : '关闭'}</span><Switch id="preview-children" checked={children} onCheckedChange={setChildren} /></div></div>
          <div className="flex items-center justify-between py-2 text-muted-foreground"><span>不可用状态</span><div className="flex items-center gap-3"><Switch aria-label="不可用且关闭" disabled checked={false} /><Switch aria-label="不可用且开启" disabled checked /></div></div>
        </section>
        <section className="space-y-2" aria-label="复选框示例">
          <h3 className="font-medium">复选框</h3>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2"><Checkbox defaultChecked />当前论文</label>
            <label className="flex items-center gap-2"><Checkbox />标签笔记</label>
            <label className="flex items-center gap-2 text-muted-foreground"><Checkbox disabled />不可编辑</label>
          </div>
        </section>
        <section className="space-y-2" aria-label="输入示例">
          <h3 className="font-medium">搜索与选择</h3>
          <div className="flex items-center gap-2">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <Input aria-label="搜索论文" placeholder="搜索论文标题" />
            <Select defaultValue="updated"><SelectTrigger aria-label="排序方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated">最近更新</SelectItem><SelectItem value="read">最近阅读</SelectItem></SelectContent></Select>
          </div>
          <Input aria-label="只读来源" value="只读来源：论文原文" readOnly />
          <Input aria-label="必填标题" aria-invalid="true" aria-describedby="preview-title-error" placeholder="请输入标题" />
          <p id="preview-title-error" className="text-xs text-destructive">标题不能为空（错误样例）</p>
        </section>
        <section className="space-y-2" aria-label="选择框状态示例">
          <h3 className="font-medium">选择框</h3>
          <div className="grid grid-cols-2 gap-3 max-[440px]:grid-cols-1">
            <Select><SelectTrigger className="w-full" aria-label="未选择"><SelectValue placeholder="请选择阅读方式" /></SelectTrigger><SelectContent><SelectItem value="pdf">PDF 原文</SelectItem><SelectItem value="reflow">重排阅读</SelectItem><SelectItem value="disabled" disabled>暂不可用</SelectItem></SelectContent></Select>
            <Select defaultValue="long"><SelectTrigger className="w-full" aria-label="长模型名称"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="long">Research Assistant · 一个用于检查长名称截断的模型</SelectItem><SelectItem value="short">短名称</SelectItem></SelectContent></Select>
            <Select disabled defaultValue="readonly"><SelectTrigger className="w-full" aria-label="不可用选择框"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="readonly">只读，无法修改</SelectItem></SelectContent></Select>
            <Select><SelectTrigger className="w-full" aria-label="必选项" aria-invalid="true" aria-describedby="preview-select-error"><SelectValue placeholder="请选择模型" /></SelectTrigger><SelectContent><SelectItem value="example">示例模型</SelectItem></SelectContent></Select>
            <Select defaultValue="compact"><SelectTrigger size="sm" className="w-full" aria-label="紧凑选择框"><SelectValue /></SelectTrigger><SelectContent viewportAligned><SelectItem value="compact">标准大小</SelectItem><SelectItem value="large">较大</SelectItem></SelectContent></Select>
            <Select disabled><SelectTrigger className="w-full" aria-label="加载中选择框"><SelectValue placeholder="正在加载模型…" /></SelectTrigger><SelectContent><SelectItem value="placeholder" disabled>正在加载</SelectItem></SelectContent></Select>
          </div>
          <p id="preview-select-error" className="text-xs text-destructive">请选择模型（错误样例）</p>
        </section>
        <section className="space-y-2" aria-label="切换示例">
          <h3 className="font-medium">页签与切换</h3>
          <Tabs defaultValue="papers"><TabsList><TabsTrigger value="papers">论文</TabsTrigger><TabsTrigger value="notes">标签笔记</TabsTrigger></TabsList><TabsContent value="papers">论文内容</TabsContent><TabsContent value="notes">标签笔记内容</TabsContent></Tabs>
          <div className="flex flex-wrap items-center gap-4">
            <ToggleGroup type="single" spacing={0} defaultValue="current" variant="outline" aria-label="论文范围"><ToggleGroupItem value="current">仅当前</ToggleGroupItem><ToggleGroupItem value="children">含子标签</ToggleGroupItem></ToggleGroup>
            <ToggleGroup type="multiple" variant="outline" aria-label="阅读筛选"><ToggleGroupItem value="reading">在读</ToggleGroupItem><ToggleGroupItem value="finished">已读</ToggleGroupItem><ToggleGroupItem value="unavailable" disabled>不可用</ToggleGroupItem></ToggleGroup>
          </div>
        </section>
      </DialogBody>
      <p role="status" className="shrink-0 border-t pt-3 text-xs text-muted-foreground">{message}</p>
    </DialogContent>
  </Dialog>;
}
