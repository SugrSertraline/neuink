import { describe, expect, it } from 'vitest';
import { hasAssistantToolMarkup, visibleAssistantAnswer } from './assistantAnswerMarkup';
import { answerVerification } from './answerVerification';
import { isPotentialRawModelToolCall, isRawModelToolCall } from './modelToolCallMarkup';

const dsmlCalls = `<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="read_entry_assistant_context">
<｜｜DSML｜｜ parameter name="entry_id" string="true">aJDfGv7T73XH2E9s</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="query" string="true">bind drag and drop content to widget LLM handler custom event</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
<｜｜DSML｜｜ invoke name="read_pdf_pages">
<｜｜DSML｜｜ parameter name="entry_id" string="true">aJDfGv7T73XH2E9s</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="pages" string="false">[2]</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;

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

  it('hides DeepSeek DSML envelopes, including the recorded fullwidth sample', () => {
    expect(visibleAssistantAnswer(dsmlCalls)).toBe('');
    expect(hasAssistantToolMarkup(dsmlCalls)).toBe(true);
    expect(isRawModelToolCall(dsmlCalls)).toBe(true);
    expect(visibleAssistantAnswer('<｜DSML｜function_calls>\ninvoke\n</｜DSML｜function_calls>\n正文')).toBe('正文');
    expect(visibleAssistantAnswer('说明。<|DSML|calls>\n</|DSML|calls>\n正文')).toBe('说明。\n正文');
    expect(visibleAssistantAnswer('<｜tool▁calls▁begin｜>\ncall\n</｜tool▁calls▁begin｜>\n正文')).toBe('正文');
    expect(visibleAssistantAnswer('结论已经整理。<｜')).toBe('结论已经整理。');
    expect(visibleAssistantAnswer('结论已经整理。<｜｜DSML')).toBe('结论已经整理。');
    expect(visibleAssistantAnswer('结论已经整理。\n<｜｜DSML｜｜ calls>')).toBe('结论已经整理。');
    for (const prefix of ['<', '<｜', '<｜｜', '<｜｜D', '<｜｜DSML', '<|DSML', '<tool_call']) {
      expect(isPotentialRawModelToolCall(prefix)).toBe(true);
    }
    expect(isPotentialRawModelToolCall('普通回答')).toBe(false);
    expect(isRawModelToolCall('普通回答')).toBe(false);
  });

  it('keeps DSML examples that are inside Markdown code', () => {
    const fenced = '示例：\n```xml\n<｜｜DSML｜｜ calls>\n</｜｜DSML｜｜ calls>\n```';
    expect(visibleAssistantAnswer(fenced)).toBe(fenced);
    expect(hasAssistantToolMarkup(fenced)).toBe(false);
    const inline = '字面标签 `<｜｜DSML｜｜ calls>` 是示例。';
    expect(visibleAssistantAnswer(inline)).toBe(inline);
    expect(visibleAssistantAnswer('比较 a < b，以及代码 <| 不是标签。')).toBe('比较 a < b，以及代码 <| 不是标签。');
  });

  it('asks the model to replace tool markup with a normal final answer', () => {
    const issue = answerVerification({ answer: '结论。<tools>', question: '总结', sources: new Map(),
      events: [], observations: [], hasProposals: false, availabilityNotes: [] });
    expect(issue?.message).toContain('不完整的工具标签');
    expect(issue?.correction).toContain('Do not print tool-control tags');
    const leaked = answerVerification({ answer: dsmlCalls, question: '有点像stitches', sources: new Map(),
      events: [], observations: [], hasProposals: false, availabilityNotes: [] });
    expect(leaked?.correction).toContain('<tool_call>');
    expect(leaked?.correction).toContain('DSML');
  });
});
