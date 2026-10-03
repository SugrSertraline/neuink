import { describe, expect, it, vi } from 'vitest';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { isAgentToolFailure } from '../agent-core';
import { ToolPreconditionError, trackToolFailures } from './toolFailurePolicy';
import { AgentStoppedError, AgentPersistenceError, AgentToolNotExecutedError } from '../agent-core/agent';
import { AgentLoopGuardError } from '../agent-core/cycleGuard';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';

const call = { toolCallId: 'guarded-call', messages: [] };
function trackedFailure(error: unknown) {
  const report = vi.fn();
  const tools: ToolSet = { guarded: tool<unknown, unknown>({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => { throw error; } }) };
  trackToolFailures(tools, report);
  return { report, run: () => tools.guarded.execute!({}, call) };
}

describe('trusted tool precondition recovery', () => {
  it.each([
    ['note_read_required', 'Read the current target note'],
    ['patch_coordinates_required', 'line-precise patch_operations'],
    ['patch_content_mismatch', 'expected_text must match'],
    ['note_target_required', 'Select or confirm'],
    ['inline_citations_required', 'beside its supported claim'],
    ['source_search_required', 'search_sciverse_evidence first'],
    ['local_source_required', 'required user confirmation']
  ] as const)('keeps a fixed actionable instruction for %s', async (reason, instruction) => {
    const error = new ToolPreconditionError(reason);
    // No caller-supplied message, path, or credential may replace the fixed template.
    error.message = 'C:\\Private\\note.md Authorization: Bearer secret';
    const { run, report } = trackedFailure(error);
    const result = await run();
    expect(isAgentToolFailure(result)).toBe(true);
    expect(result).toMatchObject({ code: 'TOOL_PREFLIGHT_FAILED', outcome: 'not_executed', diagnostic: expect.stringContaining(instruction) });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(JSON.stringify([result, report.mock.calls])).not.toMatch(/Private|Authorization|secret/);
  });

  it('does not infer a trusted precondition from a matching ordinary remote error', async () => {
    const error = Object.assign(new Error('Read the current target note. token=secret'), {
      name: 'ToolPreconditionError', reason: 'note_read_required'
    });
    await expect(trackedFailure(error).run()).rejects.toBe(error);
  });
});

describe('read-only failure observations', () => {
  function tracked(name: string, error: unknown, signal?: AbortSignal) {
    const report = vi.fn();
    const tools: ToolSet = { [name]: tool<unknown, unknown>({ inputSchema: jsonSchema({ type: 'object' }),
      execute: async () => { throw error; } }) };
    trackToolFailures(tools, report, signal);
    return { report, run: () => tools[name].execute!({}, call) };
  }

  it.each(['read_browser_tab', 'read_pdf_pages', 'search_pdf_text'])('returns a safe actionable %s failure without exposing backend data', async name => {
    const { run, report } = tracked(name, new Error('PDF 文字提取超时。 C:\\Private\\paper.pdf Authorization: Bearer secret'));
    const result = await run();
    expect(result).toMatchObject({ ok: false, code: 'TOOL_EXECUTION_FAILED', outcome: 'failed',
      diagnostic: ASSISTANT_READ_FAILURES.pdfExtractTimeout, recovery: { writesBlocked: false } });
    expect(isAgentToolFailure(result)).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ error: ASSISTANT_READ_FAILURES.pdfExtractTimeout }));
    expect(JSON.stringify([result, report.mock.calls])).not.toMatch(/Private|Authorization|secret/);
  });

  it.each(['read_browser_tab', 'read_pdf_pages', 'search_web', 'read_note'])('preserves the existing %s AbortError cancellation contract', async name => {
    const error = new DOMException('Canceled', 'AbortError');
    await expect(tracked(name, error, new AbortController().signal).run()).rejects.toBe(error);
  });

  it('preserves actual user cancellation even when the underlying read throws a different error', async () => {
    const controller = new AbortController();
    const error = new DOMException('User canceled', 'AbortError'); controller.abort(error);
    const trackedRead = tracked('read_browser_tab', new Error('PDF timeout'), controller.signal);
    await expect(trackedRead.run()).rejects.toBe(error);
    expect(trackedRead.report).not.toHaveBeenCalled();
  });

  it.each([new AgentStoppedError('stop'), new AgentPersistenceError('checkpoint'),
    new AgentLoopGuardError('safety'), new AgentToolNotExecutedError('guard')])('preserves fatal and preflight protection %j', async error => {
    await expect(tracked('read_browser_tab', error).run()).rejects.toBe(error);
  });

  it.each(['create_entry', 'import_papers', 'mcp_remote_read', 'ask_user'])('does not grant read-only recovery to %s', async name => {
    const error = new DOMException('Unknown effects', 'AbortError');
    await expect(tracked(name, error).run()).rejects.toBe(error);
  });
});
