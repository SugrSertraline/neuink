import { describe, expect, it } from 'vitest';
import { alignSavedTranslation, splitAcademicSentences } from './sentenceAlignment';

const textPairs = (pairs: ReturnType<typeof alignSavedTranslation>) =>
  pairs?.map(({ id, source, translation }) => ({ id, source, translation }));

describe('local sentence reading', () => {
  it('keeps academic abbreviations, numbers, math and citations with their sentences', () => {
    expect(splitAcademicSentences('See Fig. 2 and Eq. 3, i.e. the $x = 1. 2$ model [1]. It works!')).toEqual([
      'See Fig. 2 and Eq. 3, i.e. the $x = 1. 2$ model [1].', 'It works!',
    ]);
    expect(splitAcademicSentences('Dr. A. Smith measured 3.5 cm. Why?')).toEqual([
      'Dr. A. Smith measured 3.5 cm.', 'Why?',
    ]);
  });

  it('aligns saved whole-paragraph translations by punctuation, sequence and numeric anchors', () => {
    expect(textPairs(alignSavedTranslation('Model 1 works. Model 2 fails.', '模型 1 有效。模型 2 失败。'))).toEqual([
      { id: 1, source: 'Model 1 works.', translation: '模型 1 有效。' },
      { id: 2, source: 'Model 2 fails.', translation: '模型 2 失败。' },
    ]);
    expect(alignSavedTranslation('Model 1 works. Model 2 fails.', '模型 2 有效。模型 1 失败。')).toBeNull();
    expect(alignSavedTranslation('First. Second.', '合并译文。')).toBeNull();
    expect(textPairs(alignSavedTranslation('First. Second.', '第一句，第二句。'))).toEqual([
      { id: 1, source: 'First.', translation: '第一句，' },
      { id: 2, source: 'Second.', translation: '第二句。' },
    ]);
    expect(textPairs(alignSavedTranslation('A is fast. B is slow.', 'A 很快。B 很慢。'))).toEqual([
      { id: 1, source: 'A is fast.', translation: 'A 很快。' },
      { id: 2, source: 'B is slow.', translation: 'B 很慢。' },
    ]);
    expect(splitAcademicSentences('准确率为 3.5。随后提高。', true)).toEqual(['准确率为 3.5。', '随后提高。']);
  });

  it('does not invent sentence translations when a saved result has no usable boundaries', () => {
    expect(alignSavedTranslation('We propose a method. It works.', '我们提出的方法有效')).toBeNull();
  });

  it('keeps URL dots inside the URL and matches an English number word to its translated digit', () => {
    const source = 'Experiments on five benchmark datasets demonstrate the performance of AGAC. The source code is available at https://github.com/kaikai-kks/AGAC.';
    const translation = '在5个公开基准数据集上的实验表明AGAC性能优越。源代码可在https://github.com/kaikai-kks/AGAC获取。';
    expect(splitAcademicSentences(translation, true)).toHaveLength(2);
    expect(textPairs(alignSavedTranslation(source, translation))).toEqual([
      { id: 1, source: 'Experiments on five benchmark datasets demonstrate the performance of AGAC.', translation: '在5个公开基准数据集上的实验表明AGAC性能优越。' },
      { id: 2, source: 'The source code is available at https://github.com/kaikai-kks/AGAC.', translation: '源代码可在https://github.com/kaikai-kks/AGAC获取。' },
    ]);
  });

  it('ignores MinerU unknown-symbol placeholders and groups translations for a merged source sentence', () => {
    const source = 'where $k _ { \\mathrm { m i n } }$is the lower bound, <sub>??</sub> controls the scaling factor, and $\\alpha , \\eta$are balancing coeficients learned jointly with model parameters. The heterogeneity indicators are averaged across the entire network and temporal window, localized and short-term disruptions do not disproportionately afect $k .$Short-term disturbances are primarily captured through the cross-layer contrastive learning module while the multilayer structure remains stable.';
    const translation = '其中$k _ { \\mathrm { m i n } }$为下界，<sub>??</sub>控制缩放因子，$\\alpha , \\eta$为与模型参数联合学习的平衡系数。该异质性指标在整个网络和时间窗口上取平均，局部短期扰动不会对$k .$造成不成比例的影响。短期扰动主要由跨层对比学习模块捕捉，而多层结构保持稳定。';
    expect(splitAcademicSentences(source)).toHaveLength(2);
    expect(splitAcademicSentences(translation, true)).toHaveLength(3);
    const aligned = alignSavedTranslation(source, translation);
    expect(aligned).toHaveLength(2);
    expect(aligned?.[0].translation).toContain('</sub>控制缩放因子');
    expect(aligned?.[0].translation).not.toContain('异质性指标');
    expect(aligned?.[1].translation).toContain('异质性指标');
    expect(aligned?.[1].translation).toContain('短期扰动主要');
  });

  it('keeps citations intact and conservatively groups two source sentences translated as one', () => {
    const source = 'Some studies address heterogeneity (Zhang et al., 2023c; Gao et al., 2024). MC-STL (Zhang et al., 2023c) uses masking. This model also uses attention. TPSSL (Gao et al., 2024) applies masked modeling. It also employs contrastive learning to understand spatial dimensions. Although these methods help, limitations remain.';
    const translation = '部分研究解决异质性问题（Zhang等，2023c；Gao等，2024）。MC-STL（Zhang等，2023c）使用掩码建模。该模型还使用注意力机制。TPSSL（Gao等，2024）采用掩码建模，同时采用对比学习理解空间维度。尽管这些方法有效，仍存在局限。';
    expect(splitAcademicSentences(translation, true)).toHaveLength(5);
    const aligned = alignSavedTranslation(source, translation);
    expect(aligned).toHaveLength(5);
    expect(aligned?.[3]).toMatchObject({ sourceStartIndex: 3, sourceEndIndex: 5 });
    expect(aligned?.[3].source).toContain('It also employs contrastive learning');
    expect(aligned?.[3].translation).toContain('同时采用对比学习');
    expect(aligned?.[4]).toMatchObject({ sourceStartIndex: 5, sourceEndIndex: 6 });
  });

  it('recognizes translated decades and keeps corporate abbreviations inside a sentence', () => {
    const source = 'Traffic forecasting originated in the 1980s (Xu et al., 2013). Methods improved later.';
    const translation = '交通预测起源于20世纪80年代（Xu等，2013）。随后方法得到改进。';
    expect(alignSavedTranslation(source, translation)).toHaveLength(2);
    expect(splitAcademicSentences('This work was funded by Jiangsu Co., Ltd. (2024JKY39, Sub-project 5).')).toHaveLength(1);
    expect(alignSavedTranslation('We use 1-D causal convolution:', '我们采用一维因果卷积：')).toHaveLength(1);
  });

  it('uses discourse openings to avoid merging a sentence into the following formula', () => {
    const source = 'Next, an adaptive threshold-based positive and negative pairs selection strategy is designed. This strategy dynamically determines the selection criteria for positive and negative examples based on the characteristics of nodes in each layer to adapt to feature distributions. This approach improves the model’s ability to capture spatio-temporal dependencies. To evaluate the similarity between nodes in adjacent layers, the similarity $Q_i$ is calculated as:';
    const translation = '接下来，设计了一种基于自适应阈值的正负样本对选择策略。该策略基于每层节点的特征动态确定正负样本的选择标准，适配不同层的特征分布，提升模型捕捉时空依赖的能力。为评估相邻层节点的相似性，计算相似度$Q_i$如下：';
    expect(alignSavedTranslation(source, translation)?.map(pair =>
      [pair.sourceStartIndex, pair.sourceEndIndex])).toEqual([[0, 1], [1, 3], [3, 4]]);
  });

  it('allows a short introductory sentence to join the following sentence when punctuation confirms it', () => {
    const source = 'As illustrated with real-world traffic flow data from the PEMS03 dataset in Fig. 1(a), traffic states at a node across time steps are associated, reflecting temporal correlations. Spatial correlations are observed through adjacent road segments. Additionally, a more complex joint spatio-temporal correlation exists. The traffic flow at a node is influenced by upstream nodes before time t while affecting downstream nodes later, as shown in the diagram.';
    const translation = '如图1(a)中PEMS03数据集的真实交通流量数据所示，节点在不同时间步的交通状态存在关联，反映了时间相关性。空间相关性主要通过相邻路段的影响观察到。此外，还存在更复杂的联合时空相关性：给定节点的交通流量受到先前上游节点的影响，同时影响后续下游节点。';
    expect(alignSavedTranslation(source, translation)?.map(pair =>
      [pair.sourceStartIndex, pair.sourceEndIndex])).toEqual([[0, 1], [1, 2], [2, 4]]);
  });
});

it('aligns the six LightST abstract sentences with translated speedup multipliers', () => {
  const source = "Graph neural networks (GNNs) have gained considerable attention in recent years for traffc fow prediction due to their ability to learn spatio-temporal pattern representations through a graph-based message-passing framework. Although GNNs have shown great promise in handling traffc datasets, their deployment in real-life applications has been hindered by scalability constraints arising from high-order message passing. Additionally, the over-smoothing problem of GNNs may lead to indistinguishable region representations as the number of layers increases, resulting in performance degradation. To address these challenges, we propose a new knowledge distillation paradigm termed LightST that transfers spatial and temporal knowledge from a highcapacity teacher to a lightweight student. Specifcally, we introduce a spatio-temporal knowledge distillation framework that helps student MLPs capture graph-structured global spatio-temporal patterns while alleviating the over-smoothing effect with adaptive knowledge distillation. Extensive experiments verify that LightST signifcantly speeds up traffc fow predictions by 5X to 40X compared to state-of-the-art spatiotemporal GNNs, all while maintaining superior accuracy.";
  const translation = "图神经网络（GNN）近年来在交通fow预测方面获得了相当大的关注，因为它们能够通过基于图的消息传递框架学习时空模式表示。尽管GNN在处理traffc数据集方面显示出巨大的前景，但它们在现实生活中的部署受到了高阶消息传递引起的可扩展性约束的阻碍。此外，随着层数的增加，GNN的过平滑问题可能导致不可区分的区域表示，从而导致性能下降。为了应对这些挑战，我们提出了一种新的知识蒸馏范式，称为LightST，它将空间和时间知识从高能力教师转移到轻量级学生。具体来说，我们引入了一个时空知识蒸馏框架，该框架帮助学生MLP捕获图形结构的全局时空模式，同时通过自适应知识蒸馏减轻过度平滑效应。广泛的实验证实，与最先进的时空GNN相比，LightST将交通fow预测显著加快了5倍至40倍，同时保持了卓越的准确性。";
  expect(splitAcademicSentences(source)).toHaveLength(6);
  expect(splitAcademicSentences(translation, true)).toHaveLength(6);
  const aligned = alignSavedTranslation(source, translation);
  expect(aligned).toHaveLength(6);
  expect(aligned?.map(pair => pair.source)).toEqual(splitAcademicSentences(source));
  expect(aligned?.map(pair => pair.translation)).toEqual(splitAcademicSentences(translation, true));
});

it('recognizes explicit multiplier equivalence without ignoring numeric errors or variables', () => {
  expect(alignSavedTranslation('It is 2.5x faster. Accuracy remains.', '速度提升2.5倍。准确率保持不变。')).toHaveLength(2);
  expect(alignSavedTranslation('It is 5X faster. Accuracy remains.', '速度提升6倍。准确率保持不变。')).toBeNull();
  expect(alignSavedTranslation('Use 5x here. Continue.', '这里使用5。继续。')).toBeNull();
  expect(alignSavedTranslation('Model 5a works. Continue.', '模型5有效。继续。')).toBeNull();
  expect(alignSavedTranslation('Speed increases 5倍. Continue.', 'It is 5X faster. Continue.')).not.toBeNull();
});
