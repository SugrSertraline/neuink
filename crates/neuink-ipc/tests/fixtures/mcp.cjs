// Synthetic MCP server for protocol tests; no network or user workspace access.
const readline = require('node:readline');
let initialized = false;
let notified = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  if (request.method === 'initialize') {
    initialized = true;
    reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } });
  } else if (request.method === 'notifications/initialized') {
    notified = true;
  } else if (!initialized || !notified) {
    process.exit(2);
  } else if (request.method === 'tools/list') {
    if (request.params.cursor === 'page2') reply({ tools: [{ name: 'second', inputSchema: { type: 'object' } }] });
    else reply({ tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object' } }], nextCursor: 'page2' });
  } else if (request.method === 'tools/call' && request.params.name === 'hang') {
    // Wait for host cancellation/termination.
  } else if (request.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] });
  }
});
