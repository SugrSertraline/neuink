const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../src/main/resources/static/admin');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const code = readFileSync(path.join(root, 'admin.js'), 'utf8');
async function idle(window) {
  for (let i = 0; i < 100; i++) {
    if (window.document.getElementById('status').textContent !== '正在处理…') return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('UI did not finish');
}
async function open({ connected = true, url = 'https://admin.example/admin/' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window, calls = [];
  let revoked = false;
  const user = { id: 'a'.repeat(64), username: 'admin.preview', admin: true, disabled: false,
    quota: 2147483648, used_bytes: 1048576, last_login_at: 1730000000, device_count: 1, session_count: 1 };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.confirm = () => true;
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    let status = 200, body = {};
    if (url.endsWith('/session')) { status = connected ? 200 : 401; body = { csrf: 'csrf-test' }; }
    else if (url.endsWith('/login')) { status = 401; }
    else if (url.endsWith('/backup')) body = { state: 'not_configured' };
    else if (url.endsWith('/registration')) body = { max_accounts: 100, registered: 1 };
    else if (url.includes('/users?')) body = [{ ...user, device_count: revoked ? 0 : 1, session_count: revoked ? 0 : 1 }];
    else if (options.method === 'DELETE') revoked = true;
    else if (url.endsWith('/devices')) body = revoked ? [] : [{ id: 'b'.repeat(64), device_name: 'Laptop', created_at: null, expires_at: 1900000000, login_ip: '203.0.113.7', last_seen_at: 1795000000, user_agent: 'Mozilla Linux Firefox/120 <img src=x onerror=alert(1)>' }];
    else if (url.includes('/files?')) body = {items:[{hash:'c'.repeat(64),size:123,references:[{name:'<img src=x>.pdf',library_name:'Test library'}]}],next:''};
    else if (url.includes('/audit')) body = [];
    return { ok: status === 200, status, json: async () => body };
  };
  w.eval(code); await idle(w);
  return { dom, w, calls };
}
test('fresh visits show login without a false expired warning; invalid login is explained', async () => {
  const { dom, w } = await open({ connected: false });
  assert.equal(w.document.getElementById('login').hidden, false);
  assert.equal(w.document.getElementById('status').textContent, '已完成');
  const form = w.document.getElementById('login');
  form.dispatchEvent(new w.Event('submit', { cancelable: true })); await idle(w);
  assert.match(w.document.getElementById('status').textContent, /用户名或密码不正确/);
  dom.window.close();
});
test('user list shows login and session metrics, filters users and revokes a reviewed session', async () => {
  const { dom, w, calls } = await open();
  assert.match(w.document.getElementById('users').textContent, /admin.preview/);
  assert.match(w.document.getElementById('users').textContent, /1 \/ 1/);
  const filter = w.document.getElementById('filter'); filter.value = 'missing'; filter.dispatchEvent(new w.Event('input'));
  assert.match(w.document.getElementById('users').textContent, /没有匹配的账号/);
  filter.value = ''; filter.dispatchEvent(new w.Event('input'));
  [...w.document.querySelectorAll('button')].find(b => b.textContent === '登录设备').click(); await idle(w);
  assert.match(w.document.getElementById('details-body').textContent, /暂无记录/);
  assert.match(w.document.getElementById('details-body').textContent, /203\.0\.113\.7/);
  assert.match(w.document.getElementById('details-body').textContent, /Firefox · Linux/);
  assert.match(w.document.getElementById('details-body').textContent, /最近活动/);
  assert.equal(w.document.getElementById('details-body').querySelector('img'), null);
  [...w.document.querySelectorAll('button')].find(b => b.textContent === '撤销此登录').click(); await idle(w);
  assert.match(w.document.getElementById('details-body').textContent, /没有有效登录/);
  const request = calls.find(c => c.options.method === 'DELETE');
  assert.equal(request.options.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(request.options.credentials, 'same-origin');
  dom.window.close();
});
test('HTTP entry refuses to transmit login requests', async () => {
  const { dom, w, calls } = await open({ url: 'http://admin.example/admin/' });
  assert.equal(calls.length, 0);
  assert.match(w.document.getElementById('status').textContent, /HTTPS/);
  dom.window.close();
});

test('admin creates a normal account and safely renders stored file names', async () => {
 const {dom,w,calls}=await open();
 w.document.getElementById('create-account').click();await idle(w);
 const form=w.document.getElementById('create-account-form');
 form.elements.username.value='new.user';form.elements.password.value='initial-password-only';
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await idle(w);
 const call=calls.find(c=>c.url==='/admin/api/users' && c.options.method==='POST');
 assert.equal(JSON.parse(call.options.body).quota,2147483648);
 assert.equal(call.options.headers['X-CSRF-Token'],'csrf-test');assert.equal(form.elements.password.value,'');
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='更多').click();await idle(w);
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='查看存储文件列表').click();await idle(w);
 assert.match(w.document.getElementById('details-body').textContent, /Test library/);
 assert.match(w.document.getElementById('details-body').textContent, /<img src=x>.pdf/);
 assert.equal(w.document.getElementById('details-body').querySelector('img'),null);
 dom.window.close();
});
