// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildDiagramArtifact } from './diagramArtifact';

describe('structured diagram artifacts', () => {
  it('renders a sourced mind map deterministically', () => {
    const result = buildDiagramArtifact({ kind: 'mindmap', title: '方法', nodes: [
      { id: 'root', label: '方法' },
      { id: 'data', label: '数据', parent_id: 'root', source_markers: [2] },
      { id: 'model', label: '模型', parent_id: 'root', source_markers: [1, 2] }
    ] }, new Set([1, 2]));
    expect(result.code).toBe('mindmap\n  n0["方法"]\n    n1["数据"]\n    n2["模型"]');
    expect(result.sourceMarkers).toEqual([1, 2]);
  });

  it('rejects missing evidence, cycles and unknown edge endpoints', () => {
    expect(() => buildDiagramArtifact({ kind: 'mindmap', title: 'x', nodes: [
      { id: 'root', label: 'x', source_markers: [9] }
    ] }, new Set([1]))).toThrow(/evidence/);
    expect(() => buildDiagramArtifact({ kind: 'mindmap', title: 'x', nodes: [
      { id: 'root', label: 'x' }, { id: 'a', label: 'a', parent_id: 'b' }, { id: 'b', label: 'b', parent_id: 'a' }
    ] }, new Set())).toThrow(/cycle/);
    expect(() => buildDiagramArtifact({ kind: 'flowchart', title: 'x', nodes: [
      { id: 'a', label: 'a' }
    ], edges: [{ from: 'a', to: 'missing' }] }, new Set())).toThrow(/endpoint/);
  });

  it('turns flowchart data into renderable syntax without trusting raw code', () => {
    const result = buildDiagramArtifact({ kind: 'flowchart', title: '过程', nodes: [
      { id: 'start', label: '开始' }, { id: 'end', label: '结束' }
    ], edges: [{ from: 'start', to: 'end', label: '下一步' }], code: 'malicious code' }, new Set());
    expect(result.code).toContain('n0 -->|"下一步"| n1');
    expect(result.code).not.toContain('malicious code');
  });

  it('produces Mermaid syntax accepted by the installed renderer', async () => {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ securityLevel: 'strict', startOnLoad: false });
    const mindmap = buildDiagramArtifact({ kind: 'mindmap', title: '论文', nodes: [
      { id: 'root', label: '论文' }, { id: 'method', label: '方法', parent_id: 'root' }
    ] }, new Set());
    const flowchart = buildDiagramArtifact({ kind: 'flowchart', title: '流程', nodes: [
      { id: 'start', label: '开始' }, { id: 'end', label: '结束' }
    ], edges: [{ from: 'start', to: 'end', label: '下一步' }] }, new Set());
    await expect(mermaid.parse(mindmap.code)).resolves.toBeTruthy();
    await expect(mermaid.parse(flowchart.code)).resolves.toBeTruthy();
  });
});
