import { asSchema, streamText, type ModelMessage, type ToolSet } from 'ai';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import type { AgentDriver, AgentTool, AgentToolCall } from '../agent-core/agent';
import { AgentLocalLimitError, AgentStoppedError, AgentToolNotExecutedError } from '../agent-core/agent';
import { createAgentToolFailure, isAgentToolFailure } from '../agent-core/toolFailure';
import { createNeuinkModel, generationSettings } from './provider';
import type { RunBudget } from '../agent-core';
import { createContextProjector } from './contextProjection';
import type { RequestToolApproval } from '../runtime/toolApproval';
import { availableTurnTools, toolCallError } from './toolAvailability';
import { researchFailureMessage } from './researchRecovery';
import { TOOL_FAILURE_INSTRUCTIONS } from './toolFailurePolicy';
import { canReplayAssistantTool } from '../runtime/durableExecution';

/** AI SDK is a single-turn provider adapter, never the owner of our agent loop. */
export function createAgentDriver(options: {
  budget?: RunBudget;
  settings: LlmProfile;
  system: string;
  tools: ToolSet;
  onTurn?: () => void;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
}): AgentDriver<ModelMessage> {
  const declarations: ToolSet = Object.fromEntries(Object.entries(options.tools).map(([name, definition]) => {
    const { execute: _execute, needsApproval: _approval, ...declaration } = definition;
    return [name, declaration];
  }));
  const project = createContextProjector(options.settings, options.budget);
  return {
    async turn(messages, signal, turnOptions) {
      const permitted = options.budget?.writesBlocked
        ? Object.fromEntries(Object.entries(declarations).filter(([name]) => canReplayAssistantTool(name)))
        : declarations;
      const availability = availableTurnTools(permitted, messages, turnOptions?.finalTurn);
      const system = [options.system, TOOL_FAILURE_INSTRUCTIONS, availability.instructions].filter(Boolean).join('\n\n');
      const maxChars = Math.max(4_000, (options.settings.max_context_length ?? 64_000) - (options.settings.max_output_tokens ?? 4_096)) * 2;
      const available = maxChars - system.length - JSON.stringify(availability.tools).length;
      if (available < 2000) throw new AgentLocalLimitError('context_capacity', 'System instructions and tools exceed the model context budget.');
      const projected = await project(messages, available, signal, !availability.finish);
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000);
      options.onTurn?.();
      const response = streamText({
        model: createNeuinkModel(options.settings),
        ...generationSettings(options.settings),
        system,
        messages: projected,
        tools: availability.tools,
        toolChoice: availability.finish ? 'none' : 'auto',
        abortSignal: requestSignal,
        onError: () => undefined, // Never let SDK diagnostics log credentials or raw request bodies.
        maxRetries: 0
      });
      let text = '';
      const calls: AgentToolCall[] = [];
      for await (const part of response.fullStream) {
        requestSignal.throwIfAborted();
        if (part.type === 'text-delta') { text += part.text; options.onDelta?.(part.text); }
        if (part.type === 'reasoning-delta') options.onReasoningDelta?.(part.text);
        if (part.type === 'error') throw part.error;
        if (part.type === 'tool-call') calls.push({
          id: part.toolCallId, name: part.toolName, input: part.input,
          error: part.invalid ? toolCallError(part.toolName, part.error, availability.tools) : undefined,
          errorCode: part.invalid ? Object.prototype.hasOwnProperty.call(availability.tools, part.toolName)
            ? 'TOOL_INVALID_ARGUMENTS' : 'TOOL_NOT_AVAILABLE' : undefined
        });
      }
      requestSignal.throwIfAborted();
      // Preserve provider reasoning/signatures and tool-call metadata, not just text.
      const result = await response.response;
      const usage = await response.usage;
      options.budget?.usage(usage.inputTokens, usage.outputTokens);
      if (availability.finish && calls.length) {
        throw new AgentStoppedError('模型在总结阶段仍尝试调用工具，已安全停止，未执行这些操作。');
      }
      if (await response.finishReason === 'length') {
        for (const call of calls) {
          call.error = 'Model output was truncated. Reissue a complete tool call; no action was executed.';
          call.errorCode = 'TOOL_INVALID_ARGUMENTS';
        }
        if (!calls.length) throw new AgentLocalLimitError('output_length', '模型输出达到长度上限，未把不完整回答标记为完成。');
      }
      return { text, calls, messages: result.messages.filter((message) => message.role === 'assistant') };
    },
    instruction: (text) => ({ role: 'user', content: text }),
    result: (call, output, failed) => ({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: call.id, toolName: call.name,
        output: failed
          ? { type: 'error-text', value: modelToolFailure(call.name, output) }
          : { type: 'json', value: JSON.parse(JSON.stringify(output ?? null)) }
      }]
    })
  };
}

function modelToolFailure(name: string, output: unknown): string {
  const failure = isAgentToolFailure(output) ? output : createAgentToolFailure('TOOL_EXECUTION_FAILED');
  // The core's fixed envelope also carries host-bounded partial imports or child evidence.
  const detail = failure.diagnostic ? `${failure.message}\n诊断分类：${failure.diagnostic}` : failure.message;
  return `${JSON.stringify(failure)}\n${researchFailureMessage(name, detail)}`;
}

export function agentExecutors(tools: ToolSet, requestApproval?: RequestToolApproval): Record<string, AgentTool> {
  const options = { strict: false, allErrors: false, logger: false as const, validateFormats: false };
  const draft7 = new Ajv(options);
  const draft2020 = new Ajv2020(options);
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const validate = async (input: unknown) => {
      const schema = await asSchema(definition.inputSchema).jsonSchema;
      if (JSON.stringify(schema).length > 65_536) throw new AgentToolNotExecutedError('Tool schema exceeds size limit.', 'TOOL_PREFLIGHT_FAILED');
      const validator = schema.$schema?.includes('draft-07') ? draft7 : draft2020;
      if (!validator.validate(schema, input)) {
        // Only schema diagnostics, never raw argument values (which may contain private content).
        const fields = Object.keys(schema.properties ?? {}).join(', ');
        throw new AgentToolNotExecutedError(`工具参数不符合声明（INVALID_TOOL_INPUT / Invalid arguments for ${name}）: ${validator.errorsText()}. Allowed fields: ${fields}. Use the declared types; no action was executed.`, 'TOOL_INVALID_ARGUMENTS');
      }
    };
    // Keep direct executor calls fail-closed too: only prepare returns the effectful closure.
    const execute: AgentTool = async (input, context) => {
      const prepared = await execute.prepare!(input, context);
      return prepared(input, context);
    };
    execute.prepare = async (input, context) => {
      context.signal?.throwIfAborted();
      if (!definition.execute) throw new AgentToolNotExecutedError(`Tool has no executor: ${name}`, 'TOOL_NOT_AVAILABLE');
      let frozenInput: unknown;
      try {
        frozenInput = structuredClone(input);
        await validate(frozenInput);
      } catch (error) {
        context.signal?.throwIfAborted();
        if (error instanceof AgentStoppedError || error instanceof AgentToolNotExecutedError) throw error;
        throw new AgentToolNotExecutedError(undefined, 'TOOL_INVALID_ARGUMENTS');
      }
      if (definition.needsApproval) {
        if (!requestApproval) throw new AgentToolNotExecutedError('此操作需要用户确认，当前入口无法确认，未执行任何修改。', 'TOOL_APPROVAL_UNAVAILABLE');
        let approved: boolean;
        try {
          approved = await requestApproval({ toolCallId: context.id, toolName: name, input: structuredClone(frozenInput) }, context.signal);
        } catch (error) {
          context.signal?.throwIfAborted();
          if (error instanceof AgentStoppedError) throw error;
          throw new AgentToolNotExecutedError(undefined, 'TOOL_APPROVAL_UNAVAILABLE');
        }
        if (!approved) {
          throw new AgentStoppedError('用户已拒绝本次操作，任务已停止，未执行待确认操作。');
        }
      }
      context.signal?.throwIfAborted();
      let consumed = false;
      return async (_input, callContext) => {
        callContext.signal?.throwIfAborted();
        if (consumed || callContext.id !== context.id) throw new AgentToolNotExecutedError('确认只能用于本次操作，不能重复使用。', 'TOOL_REPEAT_SKIPPED');
        consumed = true;
        return definition.execute!(frozenInput, { toolCallId: context.id, abortSignal: callContext.signal, messages: [] });
      };
    };
    return [name, execute];
  }));
}
