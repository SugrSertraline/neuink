import type { DailyState } from '@/shared/types/daily';
import type { NoteDocument } from '@/shared/types/domain';
import type { Recommendations } from '@/modules/daily/RecommendationContext';
import { newWidget } from '@/modules/daily/dailyWidgets';
import { formatLocalDate } from '@/modules/reader/components/libraryReading';
const today = formatLocalDate(new Date());
const notes = new Map<string, NoteDocument>();
let revision = 0;
let state: DailyState = { version:1, widgets:['note','todos','journal'].map(kind => newWidget(kind as 'note'|'todos'|'journal')), lists:[{id:'inbox',title:'研究待办'}],todos:[{id:'todo-1',list_id:'inbox',text:'核对论文对照实验和数据集划分',date:today,completed:false,deleted:false}],recommendation_preferences:{interests:['diffusion models'],exclusions:[],enabled:false} };
state.widgets[0].note = {owner:{kind:'daily',date:today},note_id:'journal'};
let recommendations: Recommendations = {version:1,batches:[],feedback:[],last_attempt_at:null,last_error:null};
const researchTasks: any[] = [];
let researchInstallAt = 0, researchInstalled = false;
export const fixture = { fail:false };
export function installDailyFixture() {
  // This isolated HTML entry never ships as the main application and never reads a real workspace.
  Object.assign(window, { __TAURI_INTERNALS__: { convertFileSrc:(path:string)=>path, invoke:async (command:string, args:any) => {
    if (command.startsWith('plugin:event')) return 1;
    if (command === 'list_reading_states') return [];
    if (command === 'get_llm_settings') return { profiles: [{id:'fixture',name:'隔离示例模型',model:'示例 · 不发送真实请求',api_protocol:'openai_compatible',base_url:'http://127.0.0.1:9/v1',api_key:'fixture'}], assistant_profile: null, assistant_profile_id: 'fixture' };
    if (command === 'list_conversations') return [];
    if (fixture.fail && ['daily_workspace','daily_recommendations'].includes(command)) throw new Error('模拟写盘或读取失败；原内容保留。');
    const action = args?.request?.action;
    if (command === 'daily_workspace') {
      if (action.kind === 'save') { state = structuredClone(action.state); revision++; }
      if (action.kind === 'read_note' || action.kind === 'save_note') {
        if (action.kind === 'save_note') notes.set(action.date,{...action.document,revision:String(++revision)});
        return notes.get(action.date) ?? {note_id:'journal',entry_id:'daily',title:`${action.date} 每日记录`,markdown:'# 今日记录\n\n研究问题、论文结论和下一步计划。\n\n- [ ] 核对证据\n- [ ] 整理方法比较',links:[],revision:'missing'};
      }
      return {revision:String(revision),state:structuredClone(state)};
    }
    if (command === 'daily_recommendations') {
      if (action.kind === 'generate') recommendations.batches = [{date:today,generated_at:new Date().toISOString(),interest_key:'fixture',interests:['diffusion models'],papers:[{id:'arxiv:2006.11239',title:'Denoising Diffusion Probabilistic Models · 展示样本',authors:['Jonathan Ho','Ajay Jain','Pieter Abbeel'],year:'2020',abstract_text:'隔离展示数据，用于检查摘要、推荐理由与导入入口；不是本次真实联网推荐结果。',doi:'',url:'https://arxiv.org/abs/2006.11239',pdf_url:'https://arxiv.org/pdf/2006.11239',provider:'arxiv',evidence_level:'abstract',published:'2020-06-19',updated:'2020-12-16',categories:['cs.LG'],reasons:['匹配近期阅读标签 diffusion models；界面展示样本。'],matched_interests:['diffusion models']}]}];
      if (action.kind === 'generate') {
        const batch = recommendations.batches[0], sample = batch.papers[0];
        batch.papers = [sample, ...['时间序列预测中的扩散建模 · 展示样本', '多模态学习与交通预测的方法比较 · 展示样本', 'Graph Structure Learning · 展示样本'].map((title, index) => ({ ...sample, id: `fixture-${index}`, title, url: `https://example.com/fixture-paper-${index}`, pdf_url: `https://example.com/fixture-paper-${index}.pdf` }))];
        batch.papers[0].abstract_text += '\n\n' + '长摘要边界检查：这里使用合成文字验证方法介绍、数据说明与研究限制的排版；不是实际论文结论。\n'.repeat(40) + 'https://example.com/' + 'long-reference-path-'.repeat(20);
      }
      if (action.kind === 'feedback') recommendations.feedback = [...recommendations.feedback.filter(f=>f.id!==action.id),{id:action.id,ignored:action.ignored,saved:action.saved}];
      return structuredClone(recommendations);
    }
    if (command === 'preview_research_import') return recommendations.batches.flatMap(b=>b.papers).filter(p=>args.request.paper_ids.includes(p.id));
    if (command === 'approve_research_import') throw new Error('隔离检查页不会下载论文，请在真实资料库中确认。');
    if (command === 'read_note_catalog') return {notes:[],errors:[]};
    if (command === 'deep_research') {
      if (researchInstallAt && Date.now() - researchInstallAt >= 6000) { researchInstalled = true; researchInstallAt = 0; }
      const running = researchTasks.find(t => t.status === 'running');
      if (running && Date.now() - Date.parse(running.created_at) >= 6000) { running.status = 'completed'; running.stage = '研究完成'; running.report = '这是隔离界面测试的示例回答。**未发送模型请求。**\n\n可以继续追问，或查看历史记录。'; }
      if (action.kind === 'status' || action.kind === 'check') return {ready:researchInstalled,version:'2.1.0',error:null,pending_save:false,active: researchInstallAt ? { id:'fixture-install',installation:true,stage:'正在准备研究组件（示例）',progress:Math.min(99,Math.floor((Date.now()-researchInstallAt)/60)) } : running?.status === 'running' ? {id:running.id,installation:false,stage:running.stage} : null};
      if (action.kind === 'install') { researchInstallAt = Date.now(); return {started:true}; }
      if (action.kind === 'cancel') { researchInstallAt = 0; if (running) {running.status='cancelled';running.stage='已取消';} return {}; }
      if (action.kind === 'list') return structuredClone(researchTasks);
      if (action.kind === 'get') return structuredClone(researchTasks.find(t => t.id === action.id));
      if (action.kind === 'thread') { const chain=[]; let t=researchTasks.find(t=>t.id===action.id); while(t){chain.unshift(t); t=researchTasks.find(p=>p.id===t.parent_id);} return structuredClone(chain); }
      if (action.kind === 'preview_scope') return {scope_hash:'fixture',documents:[]};
      if (action.kind === 'start') {
        const task={id:action.id,query:action.query,parent_id:action.parent_id,created_at:new Date().toISOString(),status:'running',stage:'正在检索来源（示例）',model:'示例模型',engine:'deerflow',engine_version:'2.1.0',profile_id:'fixture',retriever:'auto',depth:'deep',timeout_seconds:3600,report:'',documents:[],source_urls:[],error:null,cost_estimate:null};
        researchTasks.unshift(task); return structuredClone(task);
      }
    }
    return null;
  } } });
}
