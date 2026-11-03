import { expect, it } from 'vitest';
import { FoldGenerationError, foldErrorMessage } from './foldErrors';

it.each([
  [401, '认证失败'], [402, '额度不足'], [429, '过于频繁'], [503, '暂时不可用'], [400, '拒绝了请求'],
])('classifies HTTP %s without exposing the provider body', (statusCode, text) => {
  const error = Object.assign(new Error('secret key sk-private; https://private.invalid/token?key=private'), { statusCode });
  const message = foldErrorMessage(error);
  expect(message).toContain(text); expect(message).not.toContain('private');
});

it.each([
  [new DOMException('signal timed out', 'TimeoutError'), '请求超时'],
  [new Error('模型输出达到长度上限'), '最大输出 Token'],
  [Object.assign(new Error('No output generated.'), { name: 'AI_NoOutputGeneratedError' }), '未返回可用正文'],
  [new Error('模型返回的内容不是有效 JSON'), '不是有效 JSON'],
  [new Error('fetch failed'), '无法连接'],
  [new FoldGenerationError('save'), '保存失败'],
  [new FoldGenerationError('configuration'), '配置助手模型'],
  [new FoldGenerationError('validation'), '未通过原文校验'],
  [Object.assign(new Error('private content'), { name: 'ModelContextLimitError' }), '上下文长度'],
])('preserves an actionable safe failure category: %s', (error, expected) => {
  expect(foldErrorMessage(error)).toContain(expected);
});

it('does not stringify arbitrary errors or expose unknown text', () => {
  expect(foldErrorMessage({ get statusCode() { throw Error('private'); } })).toBe('详略生成失败，请重试；已有结果保留。');
  expect(foldErrorMessage(new Error('private content'))).not.toContain('private');
});
