// Temporary tester-facing surface. Existing runtime configuration stays intact.
export const ADVANCED_ASSISTANT_SETTINGS_VISIBLE = false;
const ALL_SETTINGS_CATEGORIES = [
  { id: 'appearance', title: '外观与界面', tabs: ['appearance'] },
  { id: 'reader', title: '阅读与批注', tabs: ['reader'] },
  { id: 'translation', title: '翻译', tabs: ['translation'] },
  { id: 'parser', title: '导入与解析', tabs: ['parser'] },
  { id: 'data', title: '资料库与数据', tabs: ['data'] },
  { id: 'models', title: '模型与助手', tabs: ['models', 'main-agent', 'subagents'] },
  { id: 'external-tools', title: '工具与扩展', tabs: ['external-tools'] }
] as const;

export type SettingsTab = typeof ALL_SETTINGS_CATEGORIES[number]['tabs'][number];
export function visibleSettingsTab(tab: SettingsTab): SettingsTab {
  if (ADVANCED_ASSISTANT_SETTINGS_VISIBLE) return tab;
  if (tab === 'main-agent' || tab === 'subagents') return 'models';
  return tab;
}
export const SETTINGS_CATEGORIES = ALL_SETTINGS_CATEGORIES.map(category => ({
  ...category, tabs: category.tabs.filter(tab => visibleSettingsTab(tab) === tab) as SettingsTab[],
}));
export type SettingsNavigationTarget = { id: string; nonce: number };
export type SettingDefinition = {
  id: string;
  tab: SettingsTab;
  title: string;
  description: string;
  keywords: string;
};

// Metadata only: never index user values, credentials, paths or document content.
const ALL_SETTINGS_CATALOG: SettingDefinition[] = [
  { id: 'appearance-style', tab: 'appearance', title: '界面风格', description: '标准、拟物和玻璃。', keywords: '主题 theme 外观 皮肤 材质' },
  { id: 'appearance-color', tab: 'appearance', title: '强调色', description: '选中、焦点与主要操作使用的颜色预设。', keywords: '主题 颜色 配色 蓝色 绿色 紫色' },
  { id: 'appearance-scale', tab: 'appearance', title: '界面缩放', description: '调整标题栏、侧栏、阅读区和弹窗的大小。', keywords: '字体太小 字体大小 放大 缩小 DPI 比例' },
  { id: 'appearance-transparency', tab: 'appearance', title: '降低透明度', description: '切换玻璃通透效果与实色显示。', keywords: '主题 玻璃 模糊 透明 辅助 实色 折射 通透' },
  { id: 'reader-open-pdf', tab: 'reader', title: '有 PDF 时直接打开 PDF', description: '打开条目时优先阅读 PDF；关闭后或没有 PDF 时显示条目概览。', keywords: '默认打开PDF 默认打开 PDF 打开条目 直接阅读 阅读方式 概览 详情' },
  { id: 'reader-preview', tab: 'reader', title: 'PDF 悬停预览', description: '悬停时查看对应片段。', keywords: '阅读 鼠标 预览 浮层 卡片' },
  { id: 'reader-reflow-preview', tab: 'reader', title: '重排悬停预览', description: '重排视图悬停时查看对应片段。', keywords: '阅读 reflow 鼠标 预览' },
  { id: 'reader-preview-content', tab: 'reader', title: '预览显示内容', description: '原文、译文、片段记录和批注；PDF 与重排共用。', keywords: '悬停 片段笔记 区域 内容' },
  { id: 'reader-preview-size', tab: 'reader', title: 'PDF 预览大小', description: '预览文字大小和卡片宽度。', keywords: '悬停 字体大小 预览卡片大小' },
  { id: 'reader-regions', tab: 'reader', title: '默认显示 PDF 分段框', description: '控制 PDF 上分段区域框的默认显示。', keywords: '默认显示区域 框线 阅读 高亮' },
  { id: 'reader-open-note', tab: 'reader', title: '打开片段记录的方式', description: '选中后操作、单击或 Alt + 单击。', keywords: '打开片段笔记 左键 手势 点击 笔记' },
  { id: 'reader-close-overlay', tab: 'reader', title: '片段浮层关闭方式', description: '点击空白处或再次点击当前片段关闭。', keywords: '空白处关闭片段浮层 再次点击片段关闭 笔记 批注' },
  { id: 'translation-model', tab: 'translation', title: '阅读翻译模型', description: '指定整篇、片段和选中文字翻译使用的模型。', keywords: '任务模型 AI 翻译 模型' },
  { id: 'translation-selection', tab: 'translation', title: '选中文字后自动翻译', description: '选择文字后自动调用阅读翻译模型。', keywords: '划词 选区 翻译 英译中' },
  { id: 'translation-auto', tab: 'translation', title: '解析后自动翻译 PDF', description: '解析成功后自动启动英译中。', keywords: 'PDF自动翻译 自动翻译 数据与解析' },
  { id: 'translation-content', tab: 'translation', title: '自动翻译内容范围', description: '选择段落、标题、表格等参与翻译的内容类型。', keywords: '翻译 图片 公式 页眉 页脚 列表' },
  { id: 'translation-display', tab: 'translation', title: '重排翻译显示', description: '默认显示原文、译文或双语对照。', keywords: '翻译 reflow 双语 原文 译文' },
  { id: 'parser-auto', tab: 'parser', title: '导入 PDF 后自动解析', description: '关闭后可以在阅读页手动开始解析。', keywords: '上传PDF后自动开始解析 导入 解析' },
  { id: 'parser-service', tab: 'parser', title: 'MinerU 服务连接', description: '配置解析服务地址和可选 API Key。', keywords: 'MinerU URL 密钥 API Key token 凭据 解析 Base URL' },
  { id: 'parser-zip', tab: 'parser', title: '导入 MinerU 客户端 ZIP', description: '使用客户端生成的解析结果。', keywords: '离线 解析 导入 ZIP content_list' },
  { id: 'data-workspace', tab: 'data', title: '资料库位置与切换', description: '打开、新建、迁移资料库，以及最近使用记录。', keywords: '工作区 workspace 位置 路径 目录 迁移 最近使用 默认文库' },
  { id: 'models-connections', tab: 'models', title: '模型连接配置', description: '新增或编辑模型的 API Key、接口地址和模型 ID。', keywords: '大模型 大语言模型 密钥 API Key token 凭据 Base URL Provider Ollama OpenAI' },
  { id: 'models-advanced', tab: 'models', title: '模型高级参数', description: '在模型编辑中设置上下文、最大输出、Temperature 和 Top P。', keywords: '采样 温度 token 上下文窗口 参数' },
  { id: 'models-assistant', tab: 'models', title: '助手对话模型', description: '指定对话与资料问答使用的模型。', keywords: '任务模型 助手 对话 AI' },
  { id: 'agent-main', tab: 'main-agent', title: '主助手与执行权限', description: '身份、模型、工具调用和写入提案权限。', keywords: '主Agent 主 Agent 系统提示词 委派 权限 prompt' },
  { id: 'agent-delegation', tab: 'main-agent', title: '允许委派子助手', description: '控制主助手能否委派任务型子助手。', keywords: '委派 子Agent 子 Agent 权限' },
  { id: 'agent-tools', tab: 'main-agent', title: '允许调用工具', description: '控制主助手执行阶段的工具调用。', keywords: '主助手 工具权限 开关' },
  { id: 'agent-proposals', tab: 'main-agent', title: '允许生成写入提案', description: '控制主助手能否提出数据修改建议。', keywords: '主助手 写入 权限 提案 开关' },
  { id: 'agent-subagents', tab: 'subagents', title: '子助手', description: '配置内置子助手的模型、权限和系统提示词。', keywords: '子Agent 子 Agent worker 权限 启用' },
  { id: 'tools-services', tab: 'external-tools', title: 'Sciverse 外部检索', description: '配置科学文献检索服务和访问凭据。', keywords: 'Sciverse 检索 服务 插件 工具 API Key 密钥 外部工具' },
  { id: 'tools-mcp', tab: 'external-tools', title: 'MCP 与工具连接', description: '注册工具服务并配置连接参数。', keywords: 'MCP 服务 插件 工具 外部工具' }
];
export const SETTINGS_CATALOG = ALL_SETTINGS_CATALOG.filter(item =>
  ADVANCED_ASSISTANT_SETTINGS_VISIBLE || (visibleSettingsTab(item.tab) === item.tab && item.id !== 'tools-mcp'));

export function settingsCategory(tab: SettingsTab) {
  return SETTINGS_CATEGORIES.find(category => category.tabs.includes(visibleSettingsTab(tab)))!;
}

export function searchSettings(query: string): SettingDefinition[] {
  const terms = query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SETTINGS_CATALOG.map((item, index) => {
    const title = item.title.toLocaleLowerCase();
    const text = `${item.title} ${item.description} ${item.keywords} 设置 ${settingsCategory(item.tab).title}`.toLocaleLowerCase();
    const score = terms.every(term => text.includes(term))
      ? terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 1), 0) : 0;
    return { item, index, score };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(hit => hit.item);
}

const LAST_TAB_KEY = 'neuink.settings.lastTab';
export function readSettingsTab(): SettingsTab {
  try {
    const saved = window.localStorage.getItem(LAST_TAB_KEY);
    if (saved === 'tasks') return 'translation';
    if (saved === 'skills') return 'external-tools';
    const tab = ALL_SETTINGS_CATEGORIES.flatMap(category => [...category.tabs]).find(tab => tab === saved);
    return tab ? visibleSettingsTab(tab) : 'appearance';
  } catch { return 'appearance'; }
}
export function rememberSettingsTab(tab: SettingsTab) {
  try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch { /* Navigation remains usable without persistence. */ }
}
