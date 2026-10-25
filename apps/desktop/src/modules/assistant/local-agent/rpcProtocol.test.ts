import { describe,expect,it,vi } from 'vitest';
import { RpcAgentStream } from './rpcProtocol';
const callbacks=()=>({text:vi.fn(),reset:vi.fn(),reasoning:vi.fn(),tool:vi.fn(),initialized:vi.fn()});
describe('official local agent protocols',()=>{
  it('reconciles Codex summary sections with completion and does not mix raw and summary copies',()=>{
    const output=callbacks(),stream=new RpcAgentStream('codex',output);
    stream.consume({method:'item/reasoning/summaryTextDelta',params:{itemId:'r1',summaryIndex:0,delta:'检查'}});
    stream.consume({method:'item/reasoning/textDelta',params:{itemId:'r1',contentIndex:0,delta:'另一种表示'}});
    stream.consume({method:'item/reasoning/summaryTextDelta',params:{itemId:'r1',summaryIndex:1,delta:'准备结论'}});
    const complete={method:'item/completed',params:{item:{id:'r1',type:'reasoning',summary:['检查','准备结论。'],content:['另一种表示']}}};
    stream.consume(complete);stream.consume(complete);
    stream.consume({method:'item/completed',params:{item:{id:'r2',type:'reasoning',summary:['第二轮摘要'],content:[]}}});
    expect(output.reasoning.mock.calls.flat().join('')).toBe('检查\n\n准备结论。\n\n第二轮摘要');
    expect(output.text).not.toHaveBeenCalled();
  });
  it('uses returned raw text when no summary is supplied and handles completion-only blocks',()=>{
    const output=callbacks(),stream=new RpcAgentStream('codex',output);
    stream.consume({method:'item/reasoning/textDelta',params:{itemId:'r1',contentIndex:0,delta:'开始'}});
    stream.consume({method:'item/completed',params:{item:{id:'r1',type:'reasoning',summary:[],content:['开始检查。']}}});
    stream.consume({method:'item/completed',params:{item:{id:'r2',type:'reasoning',summary:[],content:['已返回的内容']}}});
    expect(output.reasoning.mock.calls.flat().join('')).toBe('开始检查。\n\n已返回的内容');
  });
  it('corrects known rejected PDF batches only after actual host coverage',()=>{
    const output=callbacks(),stream=new RpcAgentStream('codex',output);
    stream.consume({method:'item/started',params:{item:{id:'bad',type:'mcpToolCall',server:'neuink',tool:'read_pdf_pages',arguments:{entry_id:'e1',start_page:16,page_count:6}}}});
    stream.consume({method:'item/completed',params:{item:{id:'bad',type:'mcpToolCall',server:'neuink',tool:'read_pdf_pages',status:'failed',error:{message:'INVALID_TOOL_INPUT data/page_count must be <= 5'}}}});
    for(const range of [[16,20],[21,21]]) stream.pdfReading.observe({kind:'read_pdf_pages',entry_id:'e1',reading_mode:'pdf_text_layer',page_count:21,
      scanned_start_page:range[0],scanned_end_page:range[1],evidence:Array.from({length:range[1]-range[0]+1},(_,i)=>({page:range[0]+i,text:'text',truncated:false}))});
    expect(output.tool).toHaveBeenLastCalledWith(expect.objectContaining({id:'bad',recovered:true}));
  });
  it('persists the real Codex thread id and streams each final message once',()=>{
    const output=callbacks(), stream=new RpcAgentStream('codex',output);
    stream.consume({type:'local_agent_init',session_id:'thread-123'});
    expect(output.initialized).toHaveBeenCalledWith('thread-123');
    stream.consume({method:'item/agentMessage/delta',params:{itemId:'a',delta:'hello'}});
    stream.consume({method:'item/completed',params:{item:{id:'a',type:'agentMessage',text:'hello'}}});
    expect(output.text.mock.calls).toEqual([['hello']]);
    stream.consume({method:'item/agentMessage/delta',params:{itemId:'b',delta:'final'}});
    expect(output.reset).toHaveBeenCalledTimes(2);
    stream.consume({method:'item/reasoning/summaryTextDelta',params:{delta:'think'}});
    expect(output.reasoning).toHaveBeenCalledWith('think');
  });
  it('shows Codex native tools and MCP failures without changing their identity',()=>{
    const output=callbacks(), stream=new RpcAgentStream('codex',output);
    stream.consume({method:'item/started',params:{item:{id:'r',type:'mcpToolCall',server:'neuink',tool:'read_pdf_pages',arguments:{start_page:1}}}});
    stream.consume({method:'item/completed',params:{item:{id:'r',type:'mcpToolCall',server:'neuink',tool:'read_pdf_pages',status:'failed',error:{message:'failure'}}}});
    expect(output.tool).toHaveBeenLastCalledWith(expect.objectContaining({id:'r',toolName:'codex.mcp__neuink__read_pdf_pages',status:'error'}));
    stream.consume({method:'item/started',params:{item:{id:'cmd',type:'commandExecution',command:'test'}}});
    expect(output.tool).toHaveBeenLastCalledWith(expect.objectContaining({toolName:'codex.commandExecution',status:'running'}));
  });
  it('applies authoritative complete text when deltas were absent or incomplete',()=>{
    const output=callbacks(), stream=new RpcAgentStream('codex',output);
    stream.consume({method:'item/agentMessage/delta',params:{itemId:'a',delta:'partial'}});
    stream.consume({method:'item/completed',params:{item:{id:'a',type:'agentMessage',text:'complete'}}});
    expect(output.text).toHaveBeenLastCalledWith('complete');expect(output.reset).toHaveBeenCalledTimes(2);
  });
  it('handles ACP partial tool updates and thought chunks',()=>{
    const output=callbacks(), stream=new RpcAgentStream('opencode',output);
    const update=(value:unknown)=>stream.consume({method:'session/update',params:{update:value}});
    update({sessionUpdate:'tool_call',toolCallId:'t1',name:'read',rawInput:{path:'fixture'},status:'pending'});
    update({sessionUpdate:'tool_call_update',toolCallId:'t1',status:'failed'});
    expect(output.tool).toHaveBeenLastCalledWith(expect.objectContaining({toolName:'opencode.read',input:{path:'fixture'},status:'error'}));
    update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'thinking'}});
    update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'reply'}});
    expect(output.reasoning).toHaveBeenCalledWith('thinking');expect(output.text).toHaveBeenCalledWith('reply');
  });
});
