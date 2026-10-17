import { describe, expect, it } from 'vitest';
import { singleEnglishWord, translateLocalEnglishWord } from './localEnglishLexicon';

describe('local English lexicon', () => {
  it('finds a selected word without a network request', () => {
    expect(translateLocalEnglishWord('  Embedding  ')).toBe('嵌入表示');
    expect(translateLocalEnglishWord('model')).toBe('模型');
    expect(translateLocalEnglishWord('models')).toBe('模型');
    expect(translateLocalEnglishWord('studies')).toBe('研究');
  });

  it('does not treat a sentence, formula or unknown word as a dictionary hit', () => {
    expect(singleEnglishWord('a model')).toBeNull();
    expect(singleEnglishWord('x_1')).toBeNull();
    expect(translateLocalEnglishWord('inventedword')).toBeNull();
  });
});
