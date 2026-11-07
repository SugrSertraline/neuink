import { expect,it,vi } from 'vitest';
import { runIdeationTask } from './ideationTask';
import { getLocalBackgroundJobs } from '@/shared/lib/localBackgroundJobs';
import { jobTitle } from '@/shared/components/jobStatusPresentation';
const toast=()=>({notify:vi.fn().mockReturnValue('notice'),dismiss:vi.fn()});
it('projects real stages to the global task list and replaces the running toast with completion',async()=>{
 const ui=toast(),controller=new AbortController();
 await runIdeationTask({root:'task-test',kind:'report',controller,toast:ui},async stage=>{
  stage('阶段 2/3：设计方案');const job=getLocalBackgroundJobs()[0];
  expect(job).toMatchObject({status:'processing',scope:{root:'task-test'},progress:{total:0},message:'生成研究报告：阶段 2/3：设计方案'});
  expect(jobTitle(job)).toBe('研究报告生成');return 3;
 });
 expect(getLocalBackgroundJobs()[0].status).toBe('succeeded');
 expect(ui.dismiss).toHaveBeenCalledWith('notice');expect(ui.notify.mock.calls[1][0].tone).toBe('success');
});
it('global notification stop cancels immediately, with no late progress or success',async()=>{
 const ui=toast(),controller=new AbortController();let finish!:(value:number)=>void;let stage!:(text:string)=>void;
 const pending=runIdeationTask({root:'task-test',kind:'compose',controller,toast:ui},report=>{stage=report;return new Promise(resolve=>{finish=resolve;});});
 const stopped=expect(pending).rejects.toMatchObject({name:'AbortError'});
 ui.notify.mock.calls[0][0].action.props.onClick();await stopped;
 expect(getLocalBackgroundJobs()[0].status).toBe('canceled');
 stage('迟到的阶段');finish(1);await Promise.resolve();
 expect(getLocalBackgroundJobs()[0].status).toBe('canceled');expect(ui.notify).toHaveBeenCalledTimes(1);expect(ui.dismiss).toHaveBeenCalled();
});
it('records failure without exposing model responses or credentials in global messages',async()=>{
 const ui=toast();await expect(runIdeationTask({root:'task-test',kind:'recommend',controller:new AbortController(),toast:ui},async()=>{throw new Error('HTTP 500 sk-secret private model response');})).rejects.toThrow();
 expect(getLocalBackgroundJobs()[0].status).toBe('failed');
 expect(JSON.stringify(getLocalBackgroundJobs()[0])).not.toContain('sk-secret');
 expect(ui.notify.mock.calls[1][0].tone).toBe('danger');
 expect(JSON.stringify(ui.notify.mock.calls)).not.toContain('sk-secret');
});
