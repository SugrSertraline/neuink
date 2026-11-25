import { describe, expect, it } from 'vitest';
import type { ResearchPaper } from '@/shared/ipc/researchApi';
import { SYNTHETIC_PAPERS } from './fixtures';
import { listsRecentPapers } from './scenarioChecks';
import type { EvalRun } from './types';

function run(answer: string, papers = SYNTHETIC_PAPERS): EvalRun {
  return { answer, calls: [], turns: [], noteProposals: [], entryMetaProposals: [], tagProposals: [],
    toolEvents: [{ id: 'search', toolName: 'search_papers', status: 'done', researchPapers: papers as ResearchPaper[] }] };
}
const block = (ids: string[]) => '```neuink-papers\n' + JSON.stringify({
  items: ids.map(id => ({ ref: `research:${id}`, reason: 'Relevant retrieved paper.' }))
}) + '\n```';

describe('literature discovery assertions', () => {
  it('accepts three rendered references backed by recent retrieved records', () => {
    expect(listsRecentPapers(run(block(SYNTHETIC_PAPERS.map(paper => paper.id))), 3, 2023)).toBe(true);
  });
  it('rejects a single matching title or domain as a substitute for three papers', () => {
    expect(listsRecentPapers(run('Retrieval-Augmented Generation https://arxiv.org'), 3, 2023)).toBe(false);
    expect(listsRecentPapers(run(block([SYNTHETIC_PAPERS[0].id])), 3, 2023)).toBe(false);
  });
  it('does not count an older paper or an invented reference', () => {
    const ids = SYNTHETIC_PAPERS.map(paper => paper.id);
    const papers = SYNTHETIC_PAPERS.map((paper, i) => ({ ...paper, year: i === 0 ? '2022' : paper.year }));
    expect(listsRecentPapers(run(block(ids), papers), 3, 2023)).toBe(false);
    expect(listsRecentPapers(run(block([ids[0], ids[1], 'invented'])), 3, 2023)).toBe(false);
  });
  it('accepts actual inline source links but excludes links printed as code', () => {
    const links = SYNTHETIC_PAPERS.map(paper => `[${paper.title}](${paper.url})`).join('\n');
    expect(listsRecentPapers(run(links), 3, 2023)).toBe(true);
    expect(listsRecentPapers(run('```text\n' + links + '\n```'), 3, 2023)).toBe(false);
  });
});
