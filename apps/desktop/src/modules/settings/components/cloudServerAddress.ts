/** Bare campus addresses use the deployment's HTTPS port; explicit URLs keep their port. */
export function cloudServerAddress(value: string): string {
  const input = value.trim();
  if (!input) throw '请填写服务器 IP 地址';
  const explicit = input.includes('://');
  let url: URL;
  try { url = new URL(explicit ? input : `https://${input}`); }
  catch { throw '服务器地址格式无效，请填写 IP 或完整 HTTPS 地址'; }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw '服务器地址不能包含账号、路径或参数';
  if (!['https:', 'http:'].includes(url.protocol)) throw '请使用 HTTPS 服务器地址';
  if (!explicit && !/:\d+\/?$/.test(input)) url.port = '18793';
  return url.toString();
}
