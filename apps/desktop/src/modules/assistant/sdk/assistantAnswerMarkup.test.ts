import { describe, expect, it } from 'vitest';
import { hasAssistantToolMarkup, visibleAssistantAnswer } from './assistantAnswerMarkup';
import { answerVerification } from './answerVerification';

describe('assistant answer tool markup', () => {
  it('hides unfinished and complete control tags across streamed drafts', () => {
    expect(visibleAssistantAnswer('结论已经整理。<to')).toBe('结论已经整理。');
    expect(visibleAssistantAnswer('结论已经整理。<tools>')).toBe('结论已经整理。');
    expect(visibleAssistantAnswer('结论已经整理。<tools>{"name":"read"}')).toBe('结论已经整理。');
    expect(visibleAssistantAnswer('<tools>{"name":"read"}</tools>\n这是正文。')).toBe('这是正文。');
    expect(visibleAssistantAnswer('结论已经整理。\n<tools>\n{"name":"read"}')).toBe('结论已经整理。');
    expect(hasAssistantToolMarkup('结论已经整理。\n<tool_call')).toBe(true);
  });

  it('preserves fenced examples and ordinary angle brackets', () => {
    const example = '示例：\n```xml\n<tools>\n</tools>\n```';
    expect(visibleAssistantAnswer(example)).toBe(example);
    expect(visibleAssistantAnswer('字面标签 `<tools>` 是示例。')).toBe('字面标签 `<tools>` 是示例。');
    expect(visibleAssistantAnswer('x < y，<toolbox> 是普通名称。')).toBe('x < y，<toolbox> 是普通名称。');
    expect(hasAssistantToolMarkup(example)).toBe(false);
  });

  it('asks the model to replace tool markup with a normal final answer', () => {
    const issue = answerVerification({ answer: '结论。<tools>', question: '总结', sources: new Map(),
      events: [], observations: [], hasProposals: false, availabilityNotes: [] });
    expect(issue?.message).toContain('不完整的工具标签');
    expect(issue?.correction).toContain('Do not print tool-control tags');
  });
});
