// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLlmSettings } from '@/shared/ipc/assistantApi';
import { runJsonModelTask } from '@/modules/assistant/sdk/modelTasks';
import { useDailyAdvice } from './useDailyAdvice';
import { buildDailyAdvice } from './dailyAdvice';
vi.mock('@/shared/ipc/assistantApi',()=>({getLlmSettings:vi.fn()}));
vi.mock('@/modules/assistant/sdk/modelTasks',()=>({runJsonModelTask:vi.fn()}));
const input=buildDailyAdvice([],{},'2026-10-23');
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.mocked(getLlmSettings).mockResolvedValue({assistant_profile:{id:'configured',max_output_tokens:5000}} as any);
vi.mocked(runJsonModelTask).mockResolvedValue({summary:'从今日推荐开始',suggestions:[{id:'recommendations'}]});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('only calls the configured model once per visible visit and bounds input/output',async()=>{
 const ui=renderHook(({active,ready,input})=>useDailyAdvice(active,ready,input),{initialProps:{active:false,ready:true,input}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(runJsonModelTask).not.toHaveBeenCalled();
 ui.rerender({active:true,ready:true,input});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
 expect(ui.result.current.phase).toBe('ready');expect(runJsonModelTask).toHaveBeenCalledOnce();
 expect(vi.mocked(runJsonModelTask).mock.calls[0][0].settings.max_output_tokens).toBe(1200);
 ui.rerender({active:true,ready:true,input:{...input,minutes:1}});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
 expect(runJsonModelTask).toHaveBeenCalledOnce();
 ui.rerender({active:false,ready:true,input});ui.rerender({active:true,ready:true,input});
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(runJsonModelTask).toHaveBeenCalledTimes(2);
});
it('waits for reading records instead of treating loading as zero reading',async()=>{
 const ui=renderHook(({ready})=>useDailyAdvice(true,ready,input),{initialProps:{ready:false}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(runJsonModelTask).not.toHaveBeenCalled();
 ui.rerender({ready:true});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(ui.result.current.phase).toBe('ready');
});
it('aborts hidden requests and ignores late results',async()=>{
 let finish!:(v:Awaited<ReturnType<typeof runJsonModelTask>>)=>void;vi.mocked(runJsonModelTask).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const ui=renderHook(({active})=>useDailyAdvice(active,true,input),{initialProps:{active:true}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});const signal=vi.mocked(runJsonModelTask).mock.calls[0][0].abortSignal!;
 ui.rerender({active:false});expect(signal.aborted).toBe(true);
 await act(async()=>{finish({summary:'late',suggestions:[{id:'recommendations'}]});});expect(ui.result.current.result).toBeUndefined();
});
it('reports unconfigured models and failures without pretending to have AI output',async()=>{
 vi.mocked(getLlmSettings).mockResolvedValue({assistant_profile:null,profiles:[],assistant_profile_id:null} as any);
 const ui=renderHook(()=>useDailyAdvice(true,true,input));await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
 expect(ui.result.current.phase).toBe('error');expect(ui.result.current.error).toContain('尚未配置');expect(runJsonModelTask).not.toHaveBeenCalled();
 vi.mocked(getLlmSettings).mockRejectedValue(new Error('network'));act(()=>ui.result.current.refresh());await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
 expect(ui.result.current.error).toContain('本地建议');
});

