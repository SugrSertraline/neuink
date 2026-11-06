import { expect, it } from 'vitest';
import { alignSavedTranslation, splitAcademicSentences, sentenceAlignmentFailureReason } from './sentenceAlignment';

// Reduced regression examples from the read-only local corpus audit; no private
// paths or complete documents are needed to preserve the observed failure modes.
it.each([
  ['Scores average 4.80 and 4.67 on a 5-point scale. Results follow.', '在5分制下平均得分为4.80和4.67。结果如下。'],
  ['We use 192 APIs across six domains. Results follow.', '我们在6个领域使用192个API。结果如下。'],
  ['We made 15,000 calls over 20.6 hours. Results follow.', '我们在20.6小时内调用了15000次。结果如下。'],
  ['We observe 27, 646, 462, 733 values. Results follow.', '我们观察到27,646,462,733个值。结果如下。'],
  ['We use 25K entries. Results follow.', '我们使用2.5万条数据。结果如下。'],
  ['We use 20 million records. Results follow.', '我们使用2000万条记录。结果如下。'],
  ['We use 350K pairs and 17.7K triples. Results follow.', '我们使用35万对和1.77万组三元组。结果如下。'],
  ['Received 5 June 2024. Accepted 8 May 2025.', '收稿日期2024年6月5日。录用日期2025年5月8日。'],
  ['We use 128 G RAM at 3.00 GHz. Results follow.', '我们使用128G内存，频率3.00 GHz。结果如下。'],
  ['She is a 2nd-year student. Results follow.', '她是二年级学生。结果如下。'],
  ['Choose lengths 96, 192, 336, 720. Results follow.', '选择长度96、192、336、720。结果如下。'],
])('matches equivalent numeric notation without altering either text: %s', (source, translation) => {
  const pairs = alignSavedTranslation(source, translation);
  expect(pairs).toHaveLength(2);
  expect(pairs?.map(pair => pair.source)).toEqual(splitAcademicSentences(source));
  expect(pairs?.map(pair => pair.translation)).toEqual(splitAcademicSentences(translation, true));
});

it.each([
  ['We use 15.7K samples. Results follow.', '我们使用15.7万条样本。结果如下。'],
  ['Model 1 works. Model 2 fails.', '模型2有效。模型1失败。'],
  ['We use 5 and 5 samples. Results follow.', '我们使用5个样本。结果如下。'],
  ['We use 2m as a variable. Results follow.', '我们使用2000000作为变量。结果如下。'],
  ['We observed 9007199254740992 values. Results follow.', '我们观察到9007199254740993个值。结果如下。'],
])('keeps genuine or ambiguous numeric differences as paragraph fallback: %s', (source, translation) => {
  expect(alignSavedTranslation(source, translation)).toBeNull();
});

it('does not collapse a non-thousands numeric list', () => {
  expect(alignSavedTranslation('Choose 4,16,64,256,1024. Results follow.', '选择4、16、64、256、1024。结果如下。')).toHaveLength(2);
});

it('keeps trailing footnote superscripts attached to the preceding sentence', () => {
  const source = 'The budget is 20 million USD.<sup>1</sup> Next we describe the method.';
  const translation = '预算为2000万美元。<sup>1</sup>接下来描述方法。';
  const pairs = alignSavedTranslation(source, translation);
  expect(pairs).toHaveLength(2);
  expect(pairs?.[0].source).toMatch(/<\/sup>$/);
  expect(pairs?.[0].translation).toMatch(/<\/sup>$/);
});

it('keeps caption labels with their title, including tight PDF spacing', () => {
  for (const source of ['Table 12. Encoder and Decoder Architectures.', 'Fig.2. Research topics.']) {
    expect(splitAcademicSentences(source)).toHaveLength(1);
  }
  expect(splitAcademicSentences('We use Table 12. Next comes the method.')).toHaveLength(2);
  expect(alignSavedTranslation('Table 12. Encoder and Decoder Architectures.', '表12 编码器与解码器架构。')).toHaveLength(1);
});

it('handles an OCR closing prose bracket inside a math delimiter', () => {
  const source = 'We evaluate sparsity (measured by $L_0 )$. The results improve.';
  expect(splitAcademicSentences(source)).toEqual(['We evaluate sparsity (measured by $L_0 )$.', 'The results improve.']);
  expect(splitAcademicSentences('We use ($f(x)$ and $g(x)$). Next result.')).toHaveLength(2);
});

it('allows a short section label translated as an introductory colon', () => {
  expect(alignSavedTranslation('Internal validity. The ground truth may itself contain errors. We use reviewed code.',
    '内部效度：基准真值本身可能存在错误。我们采用经过评审的代码。')?.map(pair => [pair.sourceStartIndex, pair.sourceEndIndex]))
    .toEqual([[0, 2], [2, 3]]);
  expect(alignSavedTranslation('First. Second.', '合并译文。')).toBeNull();
});

it('classifies audit constraints without exposing source or provider error text', () => {
  expect(sentenceAlignmentFailureReason('Use 2. Next.', '使用3。接下来。')).toBe('numeric_mismatch');
  expect(sentenceAlignmentFailureReason('First. Second.', '合并译文。')).toBe('sentence_structure');
  expect(sentenceAlignmentFailureReason('', '')).toBe('empty');
  expect(sentenceAlignmentFailureReason('Sentence. '.repeat(31), '句子。')).toBe('limit');
});

it.each([
  ['We collected data on November 22, 2020. Results follow.', '我们于2020年11月22日采集数据。结果如下。'],
  ['The simulator has 3D visualization. It is interactive.', '仿真器支持三维可视化。它支持交互。'],
  ['We use a three-dimensional model. Results follow.', '我们使用三维模型。结果如下。'],
  ['We use a onedimensional matrix. Results follow.', '我们使用一维矩阵。结果如下。'],
  ['The model supports a single dimensionality. Results follow.', '该模型支持单一维度。结果如下。'],
  ['Lee (2019) (Lee et al., 2019) proposed a method. Results follow.', 'Lee等人（2019）提出一种方法。结果如下。'],
  ['Lee (2019) (Lee et al., 2019) proposed a method. Results follow.', 'Lee（2019）（Lee等，2019）提出一种方法。结果如下。'],
])('handles additional corpus notation conservatively: %s', (source, translation) => {
  const pairs = alignSavedTranslation(source, translation);
  expect(pairs).toHaveLength(2);
  expect(pairs?.map(pair => pair.source)).toEqual(splitAcademicSentences(source));
  expect(pairs?.map(pair => pair.translation)).toEqual(splitAcademicSentences(translation, true));
});

it('keeps numbered steps and their explanation together', () => {
  const source = 'Step 4. The agent returns another action (return to Step 3).';
  expect(splitAcademicSentences(source)).toEqual([source]);
  expect(alignSavedTranslation(source, '步骤4：智能体返回下一个动作（返回步骤3）。')).toHaveLength(1);
  expect(splitAcademicSentences('We return to Step 3. Then we continue.')).toHaveLength(2);
});

it.each([
  ['The event was in 2016 (Silver et al., 2016). Results follow.', '事件见Silver等（2016）。结果如下。'],
  ['Lee (2015) (Lee et al., 2013) proposed a method. Results follow.', 'Lee（2013）提出一种方法。结果如下。'],
  ['We use a 3D model. Results follow.', '我们使用二维模型。结果如下。'],
  ['We collected data on November 22, 2020. Results follow.', '我们于2020年11月23日采集数据。结果如下。'],
])('does not erase distinct dates, dimensions or narrative years: %s', (source, translation) => {
  expect(alignSavedTranslation(source, translation)).toBeNull();
});
