#!/usr/bin/env node
/**
 * Read-only query of a recorded Harness session transcript.
 *
 * The "dual-channel / multimodal embedding" research conclusions live in one
 * session's transcript and in the orchestration output directory. This script
 * answers "which variant measured best" from that recorded evidence instead of
 * re-running experiments or spending model calls.
 *
 * It never writes to a session, never sends a prompt, and never prints
 * credentials. Live cross-session prompting is the Harness session API; this
 * script deliberately reads the durable transcript rather than reimplementing
 * that RPC client.
 *
 * Usage:
 *   node scripts/retrieval/ask-sidecar-session.mjs --list
 *   node scripts/retrieval/ask-sidecar-session.mjs --session <id> --grep "DocVQA" --turns 12
 *   node scripts/retrieval/ask-sidecar-session.mjs --session <id> --artifacts <dir>
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const DSH_HOME =
  process.env.DSH_HOME ?? join(process.env.APPDATA ?? '', 'dsh-desktop', 'harness');

function parseArgs(argv) {
  const out = { turns: 8, grep: null, session: null, artifacts: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--list': out.list = true; break;
      case '--session': out.session = next(); break;
      case '--workspace': out.workspace = next(); break;
      case '--grep': out.grep = new RegExp(next(), 'i'); break;
      case '--turns': out.turns = Number(next()); break;
      case '--artifacts': out.artifacts = next(); break;
      case '--cwd': out.cwd = next(); break;
      case '--help': out.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

/**
 * Harness stores one directory per workspace under `sessions/<encoded path>/`.
 * The exact encoding is an internal detail, so callers name a session id or a
 * workspace substring and the script locates the directory itself.
 */
function projectRoots() {
  const base = join(DSH_HOME, 'sessions');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name));
}

function locateSession(sessionId) {
  const direct = projectRoots()
    .map((root) => join(root, sessionId, 'session.v4.jsonl.zstd'))
    .find((path) => existsSync(path));
  if (direct) return direct;
  throw new Error(`session ${sessionId} has no transcript under ${join(DSH_HOME, 'sessions')}`);
}

/** A transcript is a concatenation of independent zstd frames. */
function readTranscript(path) {
  const bytes = readFileSync(path);
  const events = [];
  let offset = 0;
  while (offset < bytes.length) {
    const result = zstdDecompressSync(bytes.subarray(offset), { info: true });
    offset += result.engine.bytesWritten;
    for (const line of result.buffer.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // A truncated tail line is expected when a session is mid-write.
      }
    }
  }
  return events;
}

function assistantText(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return text.trim() ? text : null;
}

function listSessions(workspaceFilter) {
  const rows = [];
  for (const root of projectRoots()) {
    if (workspaceFilter && !root.toLowerCase().includes(workspaceFilter.toLowerCase())) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, 'session.v4.jsonl.zstd');
      if (!existsSync(path)) continue;
      let events;
      try {
        events = readTranscript(path);
      } catch {
        continue;
      }
      const title = events.find((event) => event.type === 'session/title');
      const created = events.find((event) => event.type === 'session');
      const last = events.at(-1);
      rows.push({
        id: entry.name,
        title: title?.data?.title ?? '(untitled)',
        cwd: created?.cwd ?? '',
        updatedAt: last?.time ?? 0,
        turns: events.filter((event) => event.type === 'turn/start').length
      });
    }
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt);
}

function printConclusiveTurns(args) {
  const path = locateSession(args.session);
  const events = readTranscript(path);
  const title = events.find((event) => event.type === 'session/title')?.data?.title ?? '(untitled)';
  const messages = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => ({ turn: event.data?.turn, text: assistantText(event) }))
    .filter((item) => item.text && (!args.grep || args.grep.test(item.text)));
  const tail = messages.slice(-args.turns);
  console.log(`# source: recorded transcript (read-only)\n# session: ${args.session}\n# title: ${title}\n# matcher: ${args.grep ?? '(none)'}\n# matches: ${messages.length}, showing last ${tail.length}\n`);
  for (const item of tail) {
    console.log(`--- turn ${item.turn} ---`);
    console.log(item.text);
    console.log();
  }
}

function printArtifacts(dir) {
  if (!existsSync(dir)) throw new Error(`no artifacts at ${dir}`);
  const files = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  console.log(`# artifacts: ${dir}\n# files: ${files.length}\n`);
  for (const name of files) {
    const body = readFileSync(join(dir, name), 'utf8');
    const heading = body.split('\n').find((line) => line.startsWith('# ')) ?? name;
    const metricRows = body
      .split('\n')
      .filter((line) => /^\|/.test(line) && /\d\.\d/.test(line))
      .slice(0, 6);
    console.log(`--- ${name} ---`);
    console.log(heading.trim());
    if (metricRows.length) console.log(metricRows.join('\n'));
    console.log();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('see the file header for usage');
    return;
  }
  const root = args.cwd ?? process.cwd();
  if (args.list) {
    const rows = listSessions(args.workspace);
    for (const row of rows) {
      const when = row.updatedAt ? new Date(row.updatedAt).toISOString() : '-';
      console.log(`${row.id}\t${when}\t${row.turns} turns\t${row.cwd}\t${row.title}`);
    }
    return;
  }
  if (args.session) printConclusiveTurns(args);
  if (args.artifacts) printArtifacts(args.artifacts);
  if (!args.list && !args.session && !args.artifacts) {
    throw new Error('nothing to do: pass --list, --session, or --artifacts');
  }
}

main();
