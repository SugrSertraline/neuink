import { describe, expect, it, vi } from 'vitest';
import type { RunAssistantHarnessOptions } from '../harness/engine';
import { approveClaudeTool } from './approvals';
const options = (extra:Partial<RunAssistantHarnessOptions> = {}) => ({root:'C:\\Library', ...extra}) as RunAssistantHarnessOptions;
describe('Claude native approvals', () => {
  it.each(['codex','opencode'] as const)('%s native file diffs protect NeuInk storage and retain scratch operations',async provider=>{
    const requestToolApproval=vi.fn(async()=>true);
    for(const input of [{changes:[{path:'C:/Library/notes/a.md'}]},{rawInput:{files:[{filePath:'C:/Library/a.md'}]}},{locations:[{path:'../notes/a.md'}]}]) {
      expect(await approveClaudeTool({tool_name:'Edit',input},'q',options({requestToolApproval}),provider)).toMatchObject({behavior:'deny'});
    }
    expect(requestToolApproval).not.toHaveBeenCalled();
    expect(await approveClaudeTool({tool_name:'Edit',input:{changes:[{path:'C:/Scratch/a.txt'}]}},'q',options({requestToolApproval}),provider)).toMatchObject({behavior:'allow'});
  });
  it('preserves native tools with single-call approval and fails closed without an approver', async () => {
    const requestToolApproval = vi.fn(async () => true);
    const input = {tool_name:'Bash',input:{command:'echo test'}};
    expect(await approveClaudeTool(input,'q1',options({requestToolApproval}))).toEqual({behavior:'allow',updatedInput:input.input});
    expect(requestToolApproval).toHaveBeenCalledWith({toolCallId:'q1',toolName:'claude.Bash',input:input.input},undefined);
    expect(await approveClaudeTool(input,'q2',options())).toMatchObject({behavior:'deny'});
    requestToolApproval.mockResolvedValue(false);
    expect(await approveClaudeTool(input,'q3',options({requestToolApproval}))).toMatchObject({behavior:'deny'});
  });
  it.each(['C:/Library/notes/a.md','c:\\library\\note.md','../notes/a.md','C:/Library'])('routes protected note writes through MCP: %s', async path => {
    const requestToolApproval = vi.fn(async () => true);
    expect(await approveClaudeTool({tool_name:'Write',input:{file_path:path}},'q',options({requestToolApproval}))).toMatchObject({behavior:'deny'});
    expect(requestToolApproval).not.toHaveBeenCalled();
  });
  it('allows scratch-file operations after confirmation', async () => {
    const requestToolApproval = vi.fn(async () => true);
    expect(await approveClaudeTool({tool_name:'Edit',input:{file_path:'C:/Scratch/example.txt'}},'q',options({requestToolApproval}))).toMatchObject({behavior:'allow'});
  });
  it('maps native questions into the existing question form and validates answers', async () => {
    const input = {tool_name:'AskUserQuestion',input:{questions:[{question:'选择格式',multiSelect:true,options:[{label:'简短'},{label:'详细'}]}]}};
    const requestUserInput = vi.fn(async () => ({'0':{selected:['1'],text:'中文'}}));
    const requestToolApproval = vi.fn();
    expect(await approveClaudeTool(input,'q',options({requestUserInput,requestToolApproval}))).toMatchObject({behavior:'allow',updatedInput:{answers:{'选择格式':'详细, 中文'}}});
    expect(requestToolApproval).not.toHaveBeenCalled();
    requestUserInput.mockResolvedValue({'0':{selected:['missing'],text:''}});
    expect(await approveClaudeTool(input,'q',options({requestUserInput}))).toMatchObject({behavior:'deny'});
  });
  it('does not execute an approved tool after cancellation', async () => {
    const controller = new AbortController();
    const requestToolApproval = vi.fn(async () => {controller.abort(); return true;});
    await expect(approveClaudeTool({tool_name:'Bash',input:{}},'q',options({requestToolApproval,abortSignal:controller.signal}))).rejects.toMatchObject({name:'AbortError'});
  });
});
