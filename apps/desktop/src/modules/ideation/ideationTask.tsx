import { useContext } from 'react';
import { Button } from '@/components/ui/button';
import { ToastContext, type ToastContextValue } from '@/shared/hooks/useToast';
import { runLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';
import { waitForAbort } from './generateCards';
export type IdeationTaskKind = 'recommend' | 'compose' | 'report';
const terminalNotifications=new WeakMap<ToastContextValue,Map<string,string>>();
const labels: Record<IdeationTaskKind,string> = {recommend:'推荐研究卡片',compose:'整理研究思路',report:'生成研究报告'};
export async function runIdeationTask<T>(options:{root:string;kind:IdeationTaskKind;controller:AbortController;toast?:ToastContextValue|null},execute:(stage:(text:string)=>void)=>Promise<T>):Promise<T>{
  const {root,kind,controller,toast}=options,title=labels[kind];
  controller.signal.throwIfAborted();
  const key=JSON.stringify([root,kind]);
  if(toast){const previous=terminalNotifications.get(toast)?.get(key);if(previous)toast.dismiss(previous);terminalNotifications.get(toast)?.delete(key);}
  const terminal=(input:Parameters<ToastContextValue['notify']>[0])=>{if(!toast)return;const records=terminalNotifications.get(toast)??new Map<string,string>();records.set(key,toast.notify(input));terminalNotifications.set(toast,records);};
  const notification=toast?.notify({title:`正在${title}`,description:'全局任务列表显示当前阶段。关闭本通知不会停止任务。',durationMs:Infinity,action:<Button size="sm" variant="outline" onClick={()=>controller.abort()}>停止</Button>});
  try {
    const result=await runLocalBackgroundJob({kind:'llm',scope:{kind:'workspace',root},idPrefix:`ideation-${kind}`,message:`${title}：准备中`,successMessage:kind==='recommend'?'卡片推荐检查完成，请在左侧查看结果':`${title}完成，草稿尚未保存到条目`,failureMessage:`${title}未完成，请返回研究页面重试。`},async report=>{
      const stage=(text:string)=>{if(!controller.signal.aborted)report({current:0,total:0,percent:0},{message:`${title}：${text}`});};
      const result=await waitForAbort(execute(stage),controller.signal);
      controller.signal.throwIfAborted();return result;
    });
    terminal({title:kind==='recommend'?'推荐检查完成':`${title}完成`,description:kind==='recommend'?'请在左侧查看推荐或缺口提示。':'结果仍是草稿，请审阅后确认保存。',tone:'success'});
    return result;
  }catch(error){
    if(!controller.signal.aborted)terminal({title:`${title}未完成`,description:'已有内容保留，请返回研究页面查看原因并重试。',tone:'danger'});
    throw error;
  }finally{if(notification)toast?.dismiss(notification);}
}
export function useIdeationTask(){const toast=useContext(ToastContext);return <T,>(options:{root:string;kind:IdeationTaskKind;controller:AbortController},execute:(stage:(text:string)=>void)=>Promise<T>)=>runIdeationTask({...options,toast},execute);}
