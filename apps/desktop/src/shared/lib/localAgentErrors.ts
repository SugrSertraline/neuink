/** Exact host-owned messages only. Never display arbitrary CLI stderr or provider bodies. */
const messages = new Set([
  '连接测试正在进行，请稍后重试。',
  '连接测试超时，请检查本机登录、模型和网络配置后重试。',
  '模型已响应，但未完成 NeuInk 工具验证，请重试。',
  '模型已响应，但没有调用 NeuInk 测试工具，请重试。',
  '本地 Agent 已关闭，请在设置 → 工具与扩展中启用。',
  '未检测到 Claude Code，请安装后重新检测。',
  'Claude Code 无法启动，请检查安装。',
  'Claude Code 检测超时，请重新检测。',
  'NeuInk 工具连接失败，请重试。',
  'NeuInk 工具结果未能送达 Claude，本次任务已停止，请重试。',
  '无法读取资料库的 Agent 权限配置，任务已停止。请检查资料库后重试，系统不会改用默认权限执行。',
  'Claude 认证失败，请先在 Claude Code 中完成认证后重试。',
  'Claude 请求额度不足或被限流，请稍后重试。',
  'Claude 已达到本次任务的执行步数上限，请缩小任务范围。',
  'Claude 未完成本次任务，请检查本地配置后重试。',
  'Claude 未返回完整结果，请检查本地认证和配置后重试。',
  'Claude 异常退出，请检查本地配置后重试。',
  'Claude 输出格式不兼容，请更新 Claude Code 后重试。',
  'Claude 执行超时，请缩小任务范围后重试。',
  'Claude 输出超过本次任务限制。',
  'Claude 输出超过单条消息限制。',
  '无法启动 NeuInk 工具连接。',
  '请在 NeuInk 桌面应用中使用本地 Agent。',
]);
for (const name of ['Claude Code','Codex','OpenCode']) for (const pattern of [
  `未检测到 ${name}，请安装后重新检测。`, `${name} 无法启动，请检查安装。`, `${name} 检测超时，请重新检测。`,
  `${name} 认证失败，请先在 ${name} 中完成认证后重试。`, `${name} 请求额度不足或被限流，请稍后重试。`,
  `${name} 未完成本次任务，请检查本地配置后重试。`, `${name} 未返回完整结果，请检查本地认证和配置后重试。`,
  `${name} 执行超时，请缩小任务范围后重试。`, `${name} 连接超时，请检查本地配置后重试。`,
  `${name} 当前模型不可用，请检查本机模型配置后重试。`, `${name} 服务连接失败，请检查网络和本机服务配置后重试。`,
]) messages.add(pattern);
for (const message of [
  'NeuInk 工具结果未能送达本地 Agent，本次任务已停止，请重试。',
  'OpenCode 当前版本不支持所需的 HTTP MCP，请更新后重试。',
  'OpenCode 当前版本不支持恢复对话，请更新或新建对话。',
  'OpenCode 本机配置无效，请检查后重试。',
  '本地 Agent 连接已关闭，请重试。', '本地 Agent 输出超过本次任务限制。',
  '本地 Agent 输出格式不兼容，请更新工具后重试。', '本地 Agent 返回的对话标识无效。',
  '本地 Agent 待确认操作过多。', '本地 Agent 在对话准备完成前请求了操作。',
]) messages.add(message);
// Keep persisted old messages readable while every new CLI error uses the official name.
for (const message of [...messages]) messages.add(message.replace(/Claude(?! Code)/g,'Claude Code'));
export function safeLocalAgentError(error: unknown): string | null {
  const value = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return messages.has(value) ? value : null;
}
