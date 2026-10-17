import { describe, expect, it } from 'vitest';
import { singleEnglishWord, translateLocalEnglishWord } from './localEnglishLexicon';

describe('local English lexicon', () => {
  it('ships the expected common-word and inflection coverage', async () => {
    const loaders = import.meta.glob<{ default: {
      words: Record<string, string>;
      forms: Record<string, string>;
    } }>('./localEnglishDictionary/*.json');
    const shards = await Promise.all(Object.values(loaders).map(load => load()));
    const words = Object.assign({}, ...shards.map(shard => shard.default.words)) as Record<string, string>;
    const forms = Object.assign({}, ...shards.map(shard => shard.default.forms)) as Record<string, string>;

    expect(shards).toHaveLength(26);
    expect(Object.keys(words).length).toBeGreaterThan(48_000);
    expect(Object.keys(forms).length).toBeGreaterThan(30_000);
    expect(Object.values(forms).every(base => Boolean(words[base]))).toBe(true);
    expect(Object.values(words).every(translation => translation.length > 0 && !translation.includes('�'))).toBe(true);
  });

  it('uses reviewed paper terms and explicit word forms', async () => {
    expect(await translateLocalEnglishWord('  Embedding  ')).toBe('嵌入表示');
    expect(await translateLocalEnglishWord('model')).toBe('模型');
    expect(await translateLocalEnglishWord('models')).toBe('模型');
    expect(await translateLocalEnglishWord('studies')).toBe('研究');
    expect(await translateLocalEnglishWord('convolution')).toBe('卷积');
    expect(await translateLocalEnglishWord('convolutions')).toBe('卷积');
    expect(await translateLocalEnglishWord('“fine‑tuning,”')).toBe('微调');
  });

  it('covers general and scientific words from local dictionary shards', async () => {
    expect(await translateLocalEnglishWord('Abandon')).toContain('放弃');
    expect(await translateLocalEnglishWord('biomedical')).toContain('生物医学');
    expect(await translateLocalEnglishWord('classified')).toContain('分类');
    expect(await translateLocalEnglishWord('went')).toContain('去');
  });

  it('does not treat a sentence, formula or unknown word as a dictionary hit', async () => {
    expect(singleEnglishWord('a model')).toBeNull();
    expect(singleEnglishWord('x_1')).toBeNull();
    expect(singleEnglishWord('model,')).toBe('model');
    expect(await translateLocalEnglishWord('inventedword')).toBeNull();
  });
});
