/** Source metadata is not a placement instruction: the writer must cite the claim itself. */
export function assertInlineNoteCitations(markdown: string, markers: string[]) {
  const placed = new Set<string>();
  let fence: { character: string; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      const run = delimiter[1];
      if (!fence) fence = { character: run[0], length: run.length };
      else if (run[0] === fence.character && run.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const prose = line.replace(/(`+)[\s\S]*?\1/g, '');
    const citations = [...prose.matchAll(/\[S(\d+)]/g)];
    if (!citations.length) continue;
    // A row of markers (including list/blockquote/table decoration) is not a cited claim.
    const content = prose.replace(/^\s*(?:>\s*)?(?:\d+[.)]\s+)?/, '')
      .replace(/\[S\d+]/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
    if (!content) {
      throw new Error('Place each [S#] citation inline beside the sentence or list item it supports, not on a separate line or in a source list. Retry the note proposal with inline citations.');
    }
    citations.forEach(match => placed.add(`S${match[1]}`));
  }
  for (const marker of markers) {
    if (!placed.has(marker)) {
      throw new Error(`Source ${marker} has no inline citation in the note content. Put [${marker}] next to its supported claim (in the inserted/replacement text for patches), or remove it from source_markers if unused. Retry the note proposal.`);
    }
  }
}
