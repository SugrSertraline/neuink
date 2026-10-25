import { describe, expect, it, vi } from 'vitest';
import { ClaudeStream } from './protocol';

function setup() {
  let answer = '';
  const callbacks = { text:vi.fn((text:string) => {answer += text;}), reset:vi.fn(() => {answer = '';}),
    reasoning:vi.fn(), tool:vi.fn(), initialized:vi.fn() };
  const stream = new ClaudeStream(callbacks);
  const event = (value:unknown) => stream.consume({type:'stream_event',event:value});
  return {stream,event,callbacks,answer:() => answer};
}
describe('Claude stream protocol', () => {
  it('combines thinking block starts, deltas and final suffixes without repeating snapshots', () => {
    const s = setup();
    s.event({type:'message_start',message:{id:'m1'}});
    s.event({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'先'}});
    s.event({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'查原文'}});
    const complete = {type:'assistant',uuid:'thought1',message:{id:'m1',content:[{type:'thinking',thinking:'先查原文，再核对引用。'}]}};
    s.stream.consume(complete); s.stream.consume(complete);
    s.event({type:'content_block_stop',index:0});
    s.event({type:'content_block_start',index:2,content_block:{type:'thinking',thinking:''}});
    s.event({type:'content_block_delta',index:2,delta:{type:'thinking_delta',thinking:'整理结论。'}});
    s.stream.consume({type:'assistant',uuid:'thought2',message:{id:'m1',content:[{type:'thinking',thinking:'整理结论。'}]}});
    s.event({type:'message_start',message:{id:'m2'}});
    s.event({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'检查最终回答。'}});
    expect(s.callbacks.reasoning.mock.calls.flat().join('')).toBe('先查原文，再核对引用。\n\n整理结论。\n\n检查最终回答。');
    expect(s.answer()).toBe('');
  });
  it('supports completed thinking without partial events and ignores signatures, redacted and child content', () => {
    const s = setup();
    const complete = {type:'assistant',uuid:'thought1',message:{id:'m1',content:[{type:'thinking',thinking:'已返回的思考',signature:'private-signature'}]}};
    s.stream.consume(complete); s.stream.consume(complete);
    s.stream.consume({type:'assistant',uuid:'thought2',message:{id:'m1',content:[{type:'thinking',thinking:'下一段'}]}});
    s.stream.consume({...complete,uuid:'child',parent_tool_use_id:'tool-child'});
    s.stream.consume({type:'assistant',uuid:'redacted',message:{content:[{type:'redacted_thinking',data:'encrypted-text'}]}});
    s.event({type:'content_block_delta',delta:{type:'signature_delta',signature:'private-signature'}});
    expect(s.callbacks.reasoning.mock.calls.flat().join('')).toBe('已返回的思考\n\n下一段');
    expect(s.answer()).toBe('');
  });
  it('does not duplicate completed blocks and resets at the next model step', () => {
    const s = setup();
    s.event({type:'message_start',message:{id:'m1'}});
    s.event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'第一段'}});
    s.event({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'第二段'}});
    s.stream.consume({type:'assistant',uuid:'a1',message:{id:'m1',content:[{type:'text',text:'第一段'}]}});
    s.stream.consume({type:'assistant',uuid:'a2',message:{id:'m1',content:[{type:'text',text:'第二段'}]}});
    expect(s.answer()).toBe('第一段第二段');
    s.event({type:'message_start',message:{id:'m2'}});
    s.event({type:'content_block_delta',delta:{type:'text_delta',text:'最终回答'}});
    s.stream.consume({type:'assistant',uuid:'a3',message:{id:'m2',content:[{type:'text',text:'最终回答'}]}});
    expect(s.answer()).toBe('最终回答');
  });
  it('supports complete messages without partials, duplicates and separate content blocks', () => {
    const s = setup();
    const first = {type:'assistant',uuid:'a1',message:{id:'m1',content:[{type:'text',text:'A'}]}};
    s.stream.consume(first); s.stream.consume(first);
    s.stream.consume({type:'assistant',uuid:'a2',message:{id:'m1',content:[{type:'text',text:'B'}]}});
    expect(s.answer()).toBe('AB');
    s.stream.consume({type:'assistant',uuid:'a3',message:{id:'m2',content:[{type:'text',text:'C'}]}});
    expect(s.answer()).toBe('C');
  });
  it('tracks native tool completion, reasoning and ignores child-agent answers', () => {
    const s = setup();
    s.stream.consume({type:'assistant',parent_tool_use_id:'child',message:{content:[{type:'text',text:'child answer'}]}});
    s.event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'thought'}});
    s.stream.consume({type:'assistant',uuid:'t1',message:{content:[{type:'tool_use',id:'read1',name:'Read'}]}});
    s.stream.consume({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read1',is_error:true}]}});
    expect(s.answer()).toBe('');
    expect(s.callbacks.reasoning).toHaveBeenCalledWith('thought');
    expect(s.callbacks.tool.mock.calls.map(call => call[0].status)).toEqual(['running','error']);
  });
  it('requires the per-run NeuInk MCP connection before marking a session ready', () => {
    const s = setup();
    expect(() => s.stream.consume({type:'system',subtype:'init',mcp_servers:[{name:'neuink',status:'failed'}]})).toThrow('工具连接失败');
    expect(s.callbacks.initialized).not.toHaveBeenCalled();
    s.stream.consume({type:'system',subtype:'init',mcp_servers:[{name:'neuink',status:'connected'}]});
    expect(s.callbacks.initialized).toHaveBeenCalledOnce();
  });
  it('explains native Read token overflow without leaking the file path or hiding an unresolved failure', () => {
    const s = setup();
    s.stream.consume({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'large', name: 'Read', input: { file_path: 'private-path' } }] } });
    s.stream.consume({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'large', is_error: true,
      content: 'File content (50324 tokens) exceeds maximum allowed tokens (25000). secret-private-path' }] } });
    const event = s.callbacks.tool.mock.lastCall?.[0];
    expect(event).toMatchObject({ status: 'error', error: expect.stringContaining('超过单次长度限制') });
    expect(event.recovered).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('private-path');
  });
  it('keeps a rejected PDF request in the trace and marks recovery only after the missing range is scanned', () => {
    const s = setup();
    s.stream.consume({type:'assistant',message:{content:[{type:'tool_use',id:'invalid',name:'mcp__neuink__read_pdf_pages',
      input:{entry_id:'paper',start_page:16,page_count:6}}]}});
    s.stream.consume({type:'user',message:{content:[{type:'tool_result',tool_use_id:'invalid',is_error:true,
      content:'INVALID_TOOL_INPUT / Invalid arguments for read_pdf_pages: data/page_count must be <= 5.'}]}});
    const read = (start:number,end:number) => ({kind:'read_pdf_pages',reading_mode:'pdf_text_layer',entry_id:'paper',
      page_count:21,scanned_start_page:start,scanned_end_page:end,evidence:[{page:start,text:'evidence',truncated:false}]});
    s.stream.pdfReading.observe(read(16,20));
    expect(s.callbacks.tool.mock.lastCall?.[0]).toMatchObject({status:'error'});
    expect(s.callbacks.tool.mock.lastCall?.[0].error).toContain('最多 5 页');
    expect(s.callbacks.tool.mock.lastCall?.[0].recovered).toBeUndefined();
    s.stream.pdfReading.observe(read(21,21));
    expect(s.callbacks.tool.mock.lastCall?.[0]).toMatchObject({id:'invalid',status:'error',recovered:true});
  });
  it('does not label a real PDF extraction error as a corrected page-count request', () => {
    const s = setup();
    s.stream.consume({type:'assistant',message:{content:[{type:'tool_use',id:'failed',name:'mcp__neuink__read_pdf_pages',
      input:{entry_id:'paper',start_page:1,page_count:6}}]}});
    s.stream.consume({type:'user',message:{content:[{type:'tool_result',tool_use_id:'failed',is_error:true,content:'PDF extraction failed'}]}});
    s.stream.pdfReading.observe({kind:'read_pdf_pages',reading_mode:'pdf_text_layer',entry_id:'paper',page_count:5,
      scanned_start_page:1,scanned_end_page:5,evidence:[]});
    expect(s.callbacks.tool.mock.calls.some(([event]) => event.recovered)).toBe(false);
  });
});
