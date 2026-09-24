import { asSchema, streamText, type ModelMessage, type ToolSet } from 'ai';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import type { AgentDriver, AgentTool, AgentToolCall } from '../agent-core/agent';
import { AgentStoppedError } from '../agent-core/agent';
import { createNeuinkModel, generationSettings } from './provider';
import type { RunBudget } from '../agent-core';
import { createContextProjector } from './contextProjection';
import type { RequestToolApproval } from '../runtime/toolApproval';

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
    async turn(messages, signal) {
      const maxChars = Math.max(4_000, (options.settings.max_context_length ?? 64_000) - (options.settings.max_output_tokens ?? 4_096)) * 2;
      const available = maxChars - options.system.length - JSON.stringify(declarations).length;
      if (available < 2000) throw new AgentStoppedError('System instructions and tools exceed the model context budget.');
      const projected = await project(messages, available, signal);
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000);
      options.onTurn?.();
      const response = streamText({
        model: createNeuinkModel(options.settings),
        ...generationSettings(options.settings),
        system: options.system,
        messages: projected,
        tools: declarations,
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
          error: part.invalid ? 'Tool arguments are invalid. Correct them using the tool schema.' : undefined
        });
      }
      requestSignal.throwIfAborted();
      // Preserve provider reasoning/signatures and tool-call metadata, not just text.
      const result = await response.response;
      const usage = await response.usage;
      options.budget?.usage(usage.inputTokens, usage.outputTokens);
      if (await response.finishReason === 'length') {
        for (const call of calls) call.error = 'Model output was truncated. Reissue a complete tool call; no action was executed.';
        if (!calls.length) throw new AgentStoppedError('模型输出达到长度上限，未把不完整回答标记为完成。');
      }
      return { text, calls, messages: result.messages.filter((message) => message.role === 'assistant') };
    },
    instruction: (text) => ({ role: 'user', content: text }),
    result: (call, output, failed) => ({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: call.id, toolName: call.name,
        output: failed
          ? { type: 'error-text', value: String((output as { error: string }).error) }
          : { type: 'json', value: JSON.parse(JSON.stringify(output ?? null)) }
      }]
    })
  };
}

export function agentExecutors(tools: ToolSet, requestApproval?: RequestToolApproval): Record<string, AgentTool> {
  const options = { strict: false, allErrors: false, logger: false as const, validateFormats: false };
  const draft7 = new Ajv(options);
  const draft2020 = new Ajv2020(options);
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const validate = async (input: unknown) => {
      const schema = await asSchema(definition.inputSchema).jsonSchema;
      if (JSON.stringify(schema).length > 65_536) throw new Error('Tool schema exceeds size limit.');
      const validator = schema.$schema?.includes('draft-07') ? draft7 : draft2020;
      if (!validator.validate(schema, input)) throw new Error(`Invalid arguments for ${name}: ${validator.errorsText()}`);
    };
    // Keep direct executor calls fail-closed too: only prepare returns the effectful closure.
    const execute: AgentTool = async (input, context) => {
      const prepared = await execute.prepare!(input, context);
      return prepared(input, context);
    };
    execute.prepare = async (input, context) => {
      context.signal?.throwIfAborted();
      if (!definition.execute) throw new Error(`Tool has no executor: ${name}`);
      const frozenInput = structuredClone(input);
      await validate(frozenInput);
      if (definition.needsApproval) {
        if (!requestApproval) throw new AgentStoppedError('此操作需要用户确认，当前入口无法确认，未执行任何修改。');
        if (!await requestApproval({ toolCallId: context.id, toolName: name, input: structuredClone(frozenInput) }, context.signal)) {
          throw new AgentStoppedError('用户已拒绝本次操作，任务已停止，未执行待确认操作。');
        }
      }
      context.signal?.throwIfAborted();
      let consumed = false;
      return async (_input, callContext) => {
        callContext.signal?.throwIfAborted();
        if (consumed || callContext.id !== context.id) throw new AgentStoppedError('确认只能用于本次操作，不能重复使用。');
        consumed = true;
        return definition.execute!(frozenInput, { toolCallId: context.id, abortSignal: callContext.signal, messages: [] });
      };
    };
    return [name, execute];
  }));
}
