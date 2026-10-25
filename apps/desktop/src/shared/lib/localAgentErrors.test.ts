import { describe, expect, it } from 'vitest';
import { formatAssistantError } from './assistantDebug';
describe('safe local-agent failures in chat', () => {
  it.each(['Claude Code','Codex','OpenCode'])('displays fixed %s connection errors and rejects contaminated diagnostics',name=>{
    const text=`${name} 服务连接失败，请检查网络和本机服务配置后重试。`;
    expect(formatAssistantError(text)).toBe(text);
    expect(formatAssistantError(`${text} Bearer private-token`)).not.toContain('private-token');
  });
  it('displays an actionable fixed error without opt-in debug details', () => {
    const text = 'Claude 认证失败，请先在 Claude Code 中完成认证后重试。';
    expect(formatAssistantError(new Error(text))).toBe(text);
    expect(formatAssistantError(`${text} Bearer secret`)).not.toContain('secret');
  });
});
