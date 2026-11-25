import { evalState } from './evalState';
import type { createNeuinkModel } from '../sdk/provider';

type Model = ReturnType<typeof createNeuinkModel>;

/** Observe the actual SDK stream before the driver hides markup or rejects truncation. */
export function traceModel(model: Model): Model {
  const doStream = async (options: Parameters<Model['doStream']>[0]) => {
    const turn = evalState.turns[evalState.turns.length - 1];
    if (turn) {
      turn.declaredTools = (options.tools ?? []).flatMap(tool => tool.type === 'function' ? [tool.name] : []);
      turn.modelPrompt = structuredClone(options.prompt);
    }
    const result = await model.doStream(options);
    return { ...result, stream: result.stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (turn && chunk.type === 'text-delta') turn.rawText = (turn.rawText ?? '') + chunk.delta;
        if (turn && chunk.type === 'finish') {
          turn.finishReason = chunk.finishReason.unified;
          turn.usage = structuredClone(chunk.usage);
        }
        controller.enqueue(chunk);
      }
    })) };
  };
  return new Proxy(model, { get(target, key) {
    if (key === 'doStream') return doStream;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
