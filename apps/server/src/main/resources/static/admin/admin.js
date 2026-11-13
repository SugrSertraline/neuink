"use strict";
const $ = id => document.getElementById(id);
let csrf = '', users = [], after = '', before = null, busy = false;
const errors = {401:'登录已到期，请重新登录',403:'无管理权限或安全校验失败，请重新登录',409:'操作与当前状态冲突；不能禁用自己或最后一个管理员',429:'请求过于频繁，请稍后重试'};
async function api(path, method='GET', body) {
  const response = await fetch('/admin/api/' + path, {method, credentials:'same-origin', headers:{'Content-Type':'application/json','X-Neuink-Admin':'1','X-CSRF-Token':csrf}, body:body === undefined ? undefined : JSON.stringify(body)});
  if (!response.ok) { if(response.status===401) show(false); throw new Error(errors[response.status] || '请求失败，请重试（' + response.status + '）'); }
  return response.json();
}
function show(connected) { $('login').hidden=connected; $('workspace').hidden=!connected; $('logout').hidden=!connected; if(!connected) {csrf=''; $('secret').textContent='';} }
async function run(action) {
  if(busy) return; busy=true; $('status').textContent='正在处理…';
  document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try {await action(); $('status').textContent='已完成';} catch(error) {$('status').textContent=error.message || '操作失败，请重试';}
  finally {busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}
}
function button(label, action) { const element=document.createElement('button');element.textContent=label;element.onclick=()=>void run(action);return element; }
function renderUsers() {
  $('users').replaceChildren();
  for(const user of users.filter(user=>user.username.includes($('filter').value.trim().toLowerCase()))) {
    const row=document.createElement('tr');
    for(const value of [user.username,user.admin?'管理员':'普通用户',user.disabled?'已禁用':'已启用']) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    const quota=document.createElement('td'), input=document.createElement('input');input.type='number';input.min='0';input.max=String(Number.MAX_SAFE_INTEGER);input.value=String(user.quota);input.setAttribute('aria-label',user.username+' 配额字节');quota.append(input);row.append(quota);
    const actions=document.createElement('td');
    actions.append(button('保存配额',async()=>{const value=Number(input.value);if(!Number.isSafeInteger(value)||value<0)throw new Error('配额须为非负整数');if(!confirm('将 '+user.username+' 的配额改为 '+value+' 字节？降低配额不会删除资料。'))return;await api('users/'+user.id,'PATCH',{quota:value});user.quota=value;}));
    actions.append(button(user.disabled?'启用':'禁用',async()=>{if(!confirm((user.disabled?'启用 ':'禁用 ')+user.username+'？禁用将立即撤销全部会话。'))return;await api('users/'+user.id,'PATCH',{disabled:!user.disabled});user.disabled=!user.disabled;renderUsers();}));
    actions.append(button('空间明细',async()=>{const data=await api('users/'+user.id+'/storage');$('storage').textContent=user.username+'\n附件：'+data.file_bytes+' 字节\n正文与历史：'+data.metadata_bytes+' 字节\n上传预留：'+data.reserved_bytes+' 字节\n已用：'+data.used_bytes+' 字节';}));
    actions.append(button('重置凭据',async()=>{if(!confirm('为 '+user.username+' 生成有效期 15 分钟的一次性重置凭据？使用后会撤销旧会话。'))return;const value=await api('reset/'+user.id,'POST',{});$('secret').textContent='一次性重置凭据：'+value.reset_token;}));
    row.append(actions);$('users').append(row);
  }
}
async function loadUsers(reset=false) {if(reset){users=[];after='';}const rows=await api('users?after='+encodeURIComponent(after));users.push(...rows);if(rows.length)after=rows[rows.length-1].id;$('more').hidden=rows.length<100;renderUsers();}
async function audit(reset=false) {if(reset){before=null;$('audit').replaceChildren();}const rows=await api('audit'+(before?'?before='+before:''));for(const row of rows){const item=document.createElement('li');item.textContent=new Date(row.occurred_at*1000).toLocaleString()+' · '+row.action+' · '+row.actor+' → '+row.subject;$('audit').append(item);}if(rows.length)before=rows[rows.length-1].id;$('audit-more').hidden=rows.length<100;}
async function loadBackup() {const data=await api('backup');const labels={not_configured:'尚未配置定时备份',unavailable:'无法读取备份状态，请检查服务配置',running:'正在备份',succeeded:'最近一次备份已通过校验',failed:'最近一次备份失败，请检查部署日志'};$('backup').textContent=labels[data.state]+(data.last_success?' · 最近成功：'+data.last_success:'');}
$('backup-refresh').onclick=()=>void run(loadBackup);
async function load() {await loadBackup();const policy=await api('registration');$('policy').elements.max_accounts.value=policy.max_accounts;$('registered').textContent='已注册普通账号：'+policy.registered+'（禁用账号仍占名额）';await loadUsers(true);await audit(true);}
$('login').onsubmit=event=>{event.preventDefault();void run(async()=>{const form=event.currentTarget;const value=await api('login','POST',{username:form.elements.username.value,password:form.elements.password.value,device_name:'NeuInk Admin Web'});form.elements.password.value='';csrf=value.csrf;show(true);await load();});};
$('logout').onclick=()=>void run(async()=>{await api('logout','POST',{});show(false);});
$('policy').onsubmit=event=>{event.preventDefault();const value=Number(event.currentTarget.elements.max_accounts.value);void run(async()=>{if(!Number.isSafeInteger(value)||value<0||value>2147483647)throw new Error('账号上限无效');if(confirm('确认将普通账号名额改为 '+value+'？已有账号仍保留。'))await api('registration','PATCH',{max_accounts:value});});};
$('invite').onclick=()=>void run(async()=>{$('secret').textContent='一次性邀请码：'+(await api('invites','POST',{})).invite;});
$('filter').oninput=renderUsers;
$('refresh').onclick=()=>void run(()=>loadUsers(true));$('more').onclick=()=>void run(()=>loadUsers());
$('audit-refresh').onclick=()=>void run(()=>audit(true));$('audit-more').onclick=()=>void run(()=>audit());
void run(async()=>{try{const session=await api('session');csrf=session.csrf;show(true);await load();}catch(error){show(false);throw error;}});
