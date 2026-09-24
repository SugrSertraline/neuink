/** Small, original PDF fixture. Actual PDF.js rendering and text selection, without workspace files or a network download. */
export function readerPdfFixture(withReferences = false, brokenReference = false, twoColumnReferences = false) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let page = 0; page < 4; page++) {
    const body = twoColumnReferences && page === 3 ? [
      'BT /F1 12 Tf 48 651 Td ([1] Left-column paper. Smith 2024.) Tj ET',
      'BT /F1 12 Tf 312 651 Td ([12] Right-column paper. Lee 2026.) Tj ET',
      'BT /F1 12 Tf 48 627 Td (Evidence about the left column.) Tj ET',
      'BT /F1 12 Tf 312 627 Td (Evidence about the right column.) Tj ET'
    ] : Array.from({length: 14}, (_, i) => `BT /F1 12 Tf 48 ${651 - i * 24} Td (${withReferences && page === 0 && i === 0 ? twoColumnReferences ? 'Compare [1] and [12].' : 'Compare Figure 3 and reference [1].' : withReferences && page === 3 && i === 0 ? '[1] NeuInk reading study. Comparing research evidence. 2026.' : i % 3 === 0 ? 'Evidence from multiple sources can be compared in a shared research note.' : i % 3 === 1 ? 'Keep the original document readable while navigating between papers.' : 'Select text, search within the PDF, and keep your current reading position.'}) Tj ET`);
    const lines = [
      '0.12 0.32 0.54 rg 40 694 515 104 re f',
      `BT /F1 23 Tf 1 1 1 rg 58 759 Td (Reading across research papers) Tj ET`,
      `BT /F1 11 Tf 1 1 1 rg 58 723 Td (NEUINK / READING STUDY / PAGE ${page + 1}) Tj ET`,
      '0.16 0.20 0.27 rg',
      ...body,
      '0.55 0.72 0.80 rg 48 172 110 110 re f', '0.70 0.66 0.80 rg 182 172 110 80 re f',
      '0.50 0.68 0.63 rg 316 172 110 134 re f', '0.76 0.69 0.59 rg 450 172 96 64 re f',
      `BT /F1 11 Tf 0.25 0.30 0.38 rg 48 130 Td (Figure ${page + 1}. Research evidence grouped by source.) Tj ET`
    ].join('\n');
    const annotations = withReferences && page === 0 ? twoColumnReferences
      ? '/Annots [<< /Type /Annot /Subtype /Link /Rect [104 646 111 665] /Border [0 0 0] /Dest [10 0 R /XYZ 48 651 null] /Contents ([1]) >> << /Type /Annot /Subtype /Link /Rect [144 646 158 665] /Border [0 0 0] /Dest [10 0 R /XYZ 312 651 null] /Contents ([12]) >>]'
      : `/Annots [<< /Type /Annot /Subtype /Link /Rect [95 646 144 665] /Border [0 0 0] /Dest [8 0 R /XYZ 48 306 null] /Contents (Figure 3) >> ${brokenReference ? '<< /Type /Annot /Subtype /Link /Rect [228 646 236 665] /Border [0 0 0] /Dest (missing.citation.2026) >>' : ''}]` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R ${annotations} >>`, `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`);
  }
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
