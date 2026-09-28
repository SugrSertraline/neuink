import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { ParadisePage } from '@/modules/paradise/ParadisePage';
import { createWorld, evolve } from '@/modules/paradise/world';
import type { ParadiseSave } from '@/shared/ipc/paradiseApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import '../styles/globals.css';

// Development-only, memory-only sandbox. Never connects to a user's workspace or model.
const previewOptions=new URLSearchParams(window.location.search);
let save: ParadiseSave | null = previewOptions.get('state')==='letter'
  ? {revision:1,world:evolve(createWorld(),{type:'depart',now:Date.now()-120000,id:'preview-letter'})} : null;
mockIPC((command,args)=>{
  if(command==='read_paradise')return structuredClone(save);
  if(command==='save_paradise'){
    const request=(args as {request:{expected_revision:number;world:ParadiseSave['world']}}).request;
    if(request.expected_revision!==(save?.revision??0))throw new Error('模拟存档冲突');
    save={revision:(save?.revision??0)+1,world:structuredClone(request.world)};return structuredClone(save);
  }
  throw new Error('隔离体验不允许其他接口');
});
const entries:LibraryEntry[]=[{id:'demo-paper',title:'示例论文：校园花园中的学习与记忆',contents:[],tagIds:[],tags:[],fields:{},createdAt:'',updatedAt:'',pdfFileName:null,parseMessage:null,parseEndpoint:null,status:'No PDF',progress:0}];
function Preview(){const narrow=previewOptions.has('narrow'),zoom=previewOptions.has('zoom')?1.25:1;return <main className="mx-auto" style={{maxWidth:narrow?390:undefined,width:`calc(100vw / ${zoom})`,height:`calc(100vh / ${zoom})`,zoom}}><ParadisePage root="demo" entries={entries} active onBack={()=>window.alert('正式应用中返回条目库；此隔离体验刷新即重置')} onOpenEntry={()=>window.alert('正式应用中打开论文标签页')}/></main>;}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
