"use strict";
const $ = id => document.getElementById(id);
let csrf = '', users = [], after = '', before = null, busy = false;
const errors = {401:'登录已到期，请重新登录',403:'无管理权限或安全校验失败，请重新登录',404:'记录已不存在，请刷新列表',409:'操作与当前状态冲突；不能禁用自己或最后一个管理员',429:'请求过于频繁，请稍后重试'};
const pages = {users:['用户与设备','查看成员访问权限、登录设备和存储配额。'],registration:['注册与邀请','控制注册规模，安全地邀请新的成员。'],operations:['备份与审计','了解服务备份情况，追踪关键管理操作。']};
function el(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=String(text); return node; }
function date(value) { return value ? new Date(value*1000).toLocaleString('zh-CN',{hour12:false}) : '暂无记录'; }
function bytes(value) { const n=Number(value||0); return n>=1073741824?(n/1073741824).toFixed(2)+' GiB':n>=1048576?(n/1048576).toFixed(1)+' MiB':n.toLocaleString()+' B'; }
async function api(path, method='GET', body) {
  if(location.protocol!=='https:' && !['localhost','127.0.0.1'].includes(location.hostname)) throw new Error('请使用 HTTPS 管理地址，HTTP 无法保存登录凭据');
  const response=await fetch('/admin/api/'+path,{method,signal:AbortSignal.timeout(20000),credentials:'same-origin',headers:{'Content-Type':'application/json','X-Neuink-Admin':'1','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){const data=await response.json().catch(()=>({}));const specific={username_taken:'用户名已存在，请更换用户名',registration_full:'普通账号名额已满，请先调整注册上限',password_length:'密码至少 12 个字符，最多 1024 字节',invalid_username:'用户名需为 3–64 位字母、数字或 . _ @ -',invalid_quota:'存储配额无效'}[data.error];if(response.status===401)show(false);const failure=new Error(path==='login' && response.status===401?'用户名或密码不正确，或账号已禁用':specific||errors[response.status]||'请求失败，请重试（'+response.status+'）');failure.status=response.status;throw failure;}
  return response.json();
}
function show(connected){document.body.classList.toggle('authenticated',connected);$('login').hidden=connected;$('workspace').hidden=!connected;$('logout').hidden=!connected;if(!connected){csrf='';users=[];after='';$('secret').textContent='';if($('details').open)$('details').close();$('details-body').replaceChildren();}}
async function run(action){if(busy)return;busy=true;$('status').textContent='正在处理…';$('status').dataset.error='false';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();$('status').textContent='已完成';}catch(error){$('status').textContent=error.name==='TimeoutError'?'连接超时，请重试':error.message||'操作失败，请重试';$('status').dataset.error='true';}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function button(label,action,className='secondary'){const node=el('button',className,label);node.type='button';node.onclick=()=>void run(action);return node;}
function detail(title,subtitle=''){$('details-title').textContent=title;$('details-subtitle').textContent=subtitle;$('details-body').replaceChildren();if(!$('details').open)$('details').showModal();}
function clientLabel(agent){if(!agent)return '未记录客户端';const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/Chrome\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'客户端';const os=/Android/i.test(agent)?'Android':/iPhone|iPad/i.test(agent)?'iOS':/Windows/i.test(agent)?'Windows':/Macintosh|Mac OS/i.test(agent)?'macOS':/Linux/i.test(agent)?'Linux':'';return [browser,os].filter(Boolean).join(' · ');}
async function devices(user){
  const rows=await api('users/'+user.id+'/devices');detail('登录设备',user.username+' · '+rows.length+' 个有效会话');
  $('details-body').append(el('p','drawer-help',rows.length?'IP 为登录时服务器看到的连接地址，不采信未经验证的代理头。最近活动按分钟更新，不代表实时在线。最多显示 200 条。':'当前没有有效登录会话。'));
  for(const row of rows){
    const card=el('article','session-card'),heading=el('div','session-title'),icon=el('span','session-icon','▣'),identity=el('div');
    identity.append(el('h3','',row.device_name||'未命名设备'),el('p','',clientLabel(row.user_agent)));heading.append(icon,identity);card.append(heading);
    const fields=el('dl','session-fields');
    for(const [label,value,className] of [['登录 IP',row.login_ip||'历史登录未记录','ip'],['最近活动',date(row.last_seen_at),''],['登录时间',date(row.created_at),''],['会话最晚到期',date(row.expires_at),'']]){const field=el('div');field.append(el('dt','',label),el('dd',className,value));fields.append(field);}card.append(fields);
    if(row.user_agent){const disclosure=el('details','session-agent');disclosure.append(el('summary','','查看客户端标识'),el('code','',row.user_agent));card.append(disclosure);}
    const footer=el('div','session-footer');footer.append(el('small','','仅撤销这次登录，不删除资料'),button('撤销此登录',async()=>{if(!confirm('撤销 '+user.username+' 的这次登录？若为当前管理会话，也会退出管理端。'))return;await api('users/'+user.id+'/devices/'+row.id,'DELETE');await loadUsers(true);await devices(user);},'danger'));card.append(footer);$('details-body').append(card);
  }
}
function createAccount(){
  detail('新增账号','直接创建普通用户，无需邀请码');const form=el('form','quota-form');form.id='create-account-form';
  form.append(el('p','','用户名仅支持字母、数字及 . _ @ -，3–64 位；密码至少 12 个字符。请通过可信方式将初始密码交给本人。'));
  for(const [name,title,type,value]of [['username','用户名','text',''],['password','初始密码','password',''],['quota','存储配额（GiB）','number','2']]){const label=el('label','',title),input=el('input');input.name=name;input.type=type;input.required=true;input.value=value;if(name==='username'){input.minLength=3;input.maxLength=64;input.pattern='[a-zA-Z0-9._@-]{3,64}';input.autocomplete='off';}if(name==='password'){input.minLength=12;input.autocomplete='new-password';}if(name==='quota'){input.min='0';input.step='any';}label.append(input);form.append(label);}
  const submit=el('button','primary','创建账号');submit.type='submit';form.append(submit);
  form.onsubmit=event=>{event.preventDefault();void run(async()=>{const quota=Math.round(Number(form.elements.quota.value)*1073741824);if(!Number.isSafeInteger(quota)||quota<0)throw new Error('请输入有效的非负配额');await api('users','POST',{username:form.elements.username.value,password:form.elements.password.value,quota});form.elements.password.value='';await loadUsers(true);const policy=await api('registration');$('registered').textContent='已注册普通账号：'+policy.registered+'（禁用账号仍占名额）';$('details').close();});};$('details-body').append(form);
}
async function files(user){
  detail('存储文件',user.username);$('details-body').append(el('p','drawer-help','按已存附件去重列出大小、名称和所属资料库；正文与历史占用请查看空间明细。每页 100 个，未找到当前引用的附件以哈希标识。'));
  const list=el('div','file-list');$('details-body').append(list);let after='';const more=button('读取下一页',()=>loadPage(),'secondary');more.hidden=true;$('details-body').append(more);
  async function loadPage(){const data=await api('users/'+user.id+'/files?after='+encodeURIComponent(after));
    for(const file of data.items){const card=el('article','session-card'),refs=file.references||[];card.append(el('h3','file-title',refs[0]?.name||'未找到当前文件名'),el('p','help-text',bytes(file.size)),el('code','file-hash',file.hash));
      if(!refs.length)card.append(el('p','help-text','没有当前资源名称记录，可能为历史保留或尚未关联的附件。'));
      for(const ref of refs.slice(0,10))card.append(el('p','file-reference',(ref.library_name||'未命名资料库')+' · '+(ref.name||'未命名资源')));
      if(refs.length>10)card.append(el('p','help-text','此文件还有其他引用，仅展示前 10 条。'));list.append(card);}
    if(!data.items.length&&!after)list.append(el('p','help-text','当前没有已存附件'));after=data.next;more.hidden=!after;
  }await loadPage();
}
function quotaEditor(user){
  detail('调整存储配额',user.username);const form=el('form','quota-form'),label=el('label','','存储配额（GiB）'),input=el('input');input.type='number';input.min='0';input.step='any';input.value=String(user.quota/1073741824);input.required=true;label.append(input);form.append(el('p','','当前配额 '+bytes(user.quota)+'。降低配额不会删除资料，超出额度后将暂停新的上传。'),label);const submit=el('button','primary','保存配额');submit.type='submit';form.append(submit);form.onsubmit=e=>{e.preventDefault();const value=Number(input.value),quota=Math.round(value*1073741824);void run(async()=>{if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(quota))throw new Error('请输入有效的非负配额');if(!confirm('将 '+user.username+' 的配额改为 '+bytes(quota)+'？'))return;await api('users/'+user.id,'PATCH',{quota});user.quota=quota;renderUsers();$('details').close();});};$('details-body').append(form);
}
async function storage(user){const data=await api('users/'+user.id+'/storage');detail('空间明细',user.username);for(const [label,value]of [['附件',data.file_bytes],['正文与历史',data.metadata_bytes],['上传预留',data.reserved_bytes],['合计已用',data.used_bytes]]){const row=el('div','storage-line');row.append(el('span','',label),el('strong','',bytes(value)));$('details-body').append(row);}}
function accountActions(user){detail('账号设置',user.username);const list=el('div','action-list');list.append(button('查看存储文件列表',()=>files(user)),button('调整存储配额',()=>quotaEditor(user)),button('查看完整空间明细',()=>storage(user)),button(user.disabled?'启用账号':'禁用账号',async()=>{if(!confirm((user.disabled?'启用 ':'禁用 ')+user.username+'？禁用将立即撤销全部会话。'))return;await api('users/'+user.id,'PATCH',{disabled:!user.disabled});user.disabled=!user.disabled;renderUsers();$('details').close();},user.disabled?'secondary':'danger'),button('生成一次性密码重置凭据',async()=>{if(!confirm('为 '+user.username+' 生成有效期 15 分钟的一次性重置凭据？使用后会撤销旧会话。'))return;const value=await api('reset/'+user.id,'POST',{});detail('一次性重置凭据',user.username);$('details-body').append(el('p','drawer-help','仅在当前详情显示，请通过可信方式交给本人。'),el('output','',value.reset_token));},'danger'));$('details-body').append(list);}
function renderUsers(){
  $('users').replaceChildren();const status=$('user-status').value;
  const visible=users.filter(u=>u.username.includes($('filter').value.trim().toLowerCase()) && (status==='all'||(status==='admin'?u.admin:status==='disabled'?u.disabled:!u.disabled)));
  $('user-count').textContent=visible.length+' / '+users.length+' 已读取';$('summary').replaceChildren();
  for(const [label,value,note]of [['已读取账号',users.length,'当前列表内的注册成员'],['已启用成员',users.filter(u=>!u.disabled).length,'可正常访问服务'],['有效登录会话',users.reduce((n,u)=>n+Number(u.session_count||0),0),'未撤销且可继续续期'],['附件占用',bytes(users.reduce((n,u)=>n+Number(u.used_bytes||0),0)),'当前已读取账号的附件']]){const metric=el('div','metric');metric.append(el('div','metric-label',label),el('div','metric-value',value),el('div','metric-note',note));$('summary').append(metric);}
  if(!visible.length){const row=el('tr'),cell=el('td','','没有匹配的账号');cell.colSpan=8;row.append(cell);$('users').append(row);}
  for(const user of visible){const row=el('tr'),nameCell=el('td'),identity=el('div','user-identity'),name=el('div');name.append(el('strong','user-name',user.username),el('div','user-caption',user.admin?'完整管理权限':'资料同步账号'));identity.append(el('span','user-avatar',user.username.slice(0,2).toUpperCase()),name);nameCell.append(identity);row.append(nameCell);
    for(const [text,className]of [[user.admin?'管理员':'普通用户',user.admin?'admin':''],[user.disabled?'已禁用':'已启用',user.disabled?'disabled':'enabled']]){const cell=el('td');cell.append(el('span','badge '+className,text));row.append(cell);}
    const login=el('td');if(user.last_login_at){const time=new Date(user.last_login_at*1000);login.append(el('span','time-date',time.toLocaleDateString('zh-CN')),el('span','time-clock',time.toLocaleTimeString('zh-CN',{hour12:false})));}else login.append(el('span','time-date','暂无记录'));row.append(login);
    const count=el('td');count.append(el('span','device-count',String(user.device_count||0)+' / '+String(user.session_count||0)));row.append(count,el('td','',bytes(user.used_bytes)),el('td','',bytes(user.quota)));
    const actions=el('td','row-actions');actions.append(button('登录设备',()=>devices(user),'row-device'),button('更多',()=>accountActions(user),'row-more'));row.append(actions);$('users').append(row);
  }
}
async function loadUsers(reset=false){if(reset){users=[];after='';}const rows=await api('users?after='+encodeURIComponent(after));users.push(...rows);if(rows.length)after=rows[rows.length-1].id;$('more').hidden=rows.length<100;renderUsers();}
async function audit(reset=false){if(reset){before=null;$('audit').replaceChildren();}const rows=await api('audit'+(before?'?before='+before:''));for(const row of rows){const item=el('li','',date(row.occurred_at)+' · '+row.action+' · '+row.actor+' → '+row.subject);$('audit').append(item);}if(!rows.length && !before)$('audit').append(el('li','','暂无管理操作记录'));if(rows.length)before=rows[rows.length-1].id;$('audit-more').hidden=rows.length<100;}
async function loadBackup(){const data=await api('backup');const labels={not_configured:'尚未配置定时备份',unavailable:'无法读取备份状态，请检查服务配置',running:'正在备份',succeeded:'最近一次备份已通过校验',failed:'最近一次备份失败，请检查部署日志'};$('backup').textContent=(labels[data.state]||'备份状态未知')+(data.last_success?' · 最近成功：'+date(data.last_success):'');}
async function load(){await loadBackup();const policy=await api('registration');$('policy').elements.max_accounts.value=policy.max_accounts;$('registered').textContent='已注册普通账号：'+policy.registered+'（禁用账号仍占名额）';await loadUsers(true);await audit(true);}
$('login').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;void run(async()=>{const value=await api('login','POST',{username:form.elements.username.value,password:form.elements.password.value,device_name:'NeuInk Admin Web'});form.elements.password.value='';csrf=value.csrf;show(true);const session=await api('session');$('current-user').textContent=session.account?.username||'管理员';await load();});};
$('logout').onclick=()=>void run(async()=>{await api('logout','POST',{});show(false);});
$('policy').onsubmit=event=>{event.preventDefault();const value=Number(event.currentTarget.elements.max_accounts.value);void run(async()=>{if(!Number.isSafeInteger(value)||value<0||value>2147483647)throw new Error('账号上限无效');if(confirm('确认将普通账号名额改为 '+value+'？已有账号仍保留。'))await api('registration','PATCH',{max_accounts:value});});};
$('invite').onclick=()=>void run(async()=>{$('secret').textContent='一次性邀请码：'+(await api('invites','POST',{})).invite;});
$('create-account').onclick=()=>void run(createAccount);
$('details').addEventListener('close',()=>{$('details-body').replaceChildren();});
$('filter').oninput=renderUsers;$('user-status').onchange=renderUsers;$('details-close').onclick=()=>$('details').close();
$('details').onclick=event=>{if(event.target===$('details')){const rect=$('details').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right)$('details').close();}};
$('refresh').onclick=()=>void run(()=>loadUsers(true));$('more').onclick=()=>void run(()=>loadUsers());$('backup-refresh').onclick=()=>void run(loadBackup);$('audit-refresh').onclick=()=>void run(()=>audit(true));$('audit-more').onclick=()=>void run(()=>audit());
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab);document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));$('page-title').textContent=pages[b.dataset.tab][0];$('page-description').textContent=pages[b.dataset.tab][1];});document.querySelector('[data-tab=users]').click();
void run(async()=>{let session;try{session=await api('session');}catch(error){show(false);if(error.status!==401)throw error;return;}csrf=session.csrf;$('current-user').textContent=session.account?.username||'管理员';show(true);await load();});
