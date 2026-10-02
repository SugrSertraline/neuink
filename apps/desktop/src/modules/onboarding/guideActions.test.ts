import { describe, expect, it } from 'vitest';
import { GUIDE_STEPS } from './catalog';
import { GUIDE_ACTIONS } from './guideActions';

describe('onboarding step contract', () => {
  it('provides an explicit action and observable result for every step in order', () => {
    expect(Object.keys(GUIDE_ACTIONS)).toEqual(expect.arrayContaining(GUIDE_STEPS.map(step => step.id)));
    expect(Object.keys(GUIDE_ACTIONS)).toHaveLength(GUIDE_STEPS.length);
    for (const step of GUIDE_STEPS) {
      expect(GUIDE_ACTIONS[step.id]?.action.trim(), step.id).toBeTruthy();
      expect(GUIDE_ACTIONS[step.id]?.result.trim(), step.id).toBeTruthy();
      expect(step.target.trim(), step.id).toBeTruthy();
      if (step.instructionCues) {
        expect(step.instructionCues, step.id).toHaveLength(step.instructions.length);
        expect(step.instructionCues.every(item => item.label && item.target), step.id).toBe(true);
      }
    }
  });

  it('points at the actual editor and split controls instead of outdated labels', () => {
    expect(GUIDE_STEPS.find(step => step.id === 'split-note')?.instructions[0]).toContain('在 PDF 旁打开');
    expect(GUIDE_STEPS.find(step => step.id === 'document-note')?.instructions[0]).toContain('未命名笔记');
    expect(GUIDE_STEPS.find(step => step.id === 'parse-service')?.target).toBe('[data-setting-id="parser-service"]');
    expect(GUIDE_STEPS.find(step => step.id === 'reflow')?.target).toContain('reflow-reader');
    expect(GUIDE_STEPS.find(step => step.id === 'source-note')?.route).toBe('pdf-note');
    expect(GUIDE_STEPS.find(step => step.id === 'split-translation')?.route).toBe('split-pdf');
    expect(GUIDE_STEPS.find(step => step.id === 'write-note')?.route).toBe('note');
    for (const id of ['parse-choices', 'parse-zip', 'parse-service', 'translation-model', 'translation-task',
      'translation-view', 'split', 'split-translation', 'split-note', 'segment-note', 'annotation',
      'document-note', 'write-note', 'source-note', 'assistant-model', 'assistant-context',
      'assistant-send', 'assistant-proposal', 'tags']) {
      const step = GUIDE_STEPS.find(item => item.id === id);
      expect(step?.cue ?? step?.instructionCues, id).toBeTruthy();
    }
  });

  it('never requires a model call or a data mutation to advance the tutorial', () => {
    const automaticSignals = new Set(['pdf', 'parsed']);
    for (const step of GUIDE_STEPS) {
      if (step.signal && !automaticSignals.has(step.signal)) {
        expect(step.practiceOptional, step.id).toBe(true);
      }
    }
  });
});
