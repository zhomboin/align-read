function fixturePdf() {
  const prose = 'BT /F1 14 Tf 20 150 Td (Ordinary prose) Tj 0 -25 Td (x = 2) Tj 0 -25 Td (Let a + b be positive) Tj ET';
  const columns = [
    [135, 260, 'Article title'], [20, 200, 'Inside the left column'], [180, 191, 'Inside the right column'],
    [20, 180, 'continues here.'], [180, 171, 'finishes here.'], [20, 120, 'Closing note'],
  ].map(([x, y, text]) => 'BT /F1 12 Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + text + ') Tj ET').join('\n');
  const page = contents => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 300] /Resources << /Font << /F1 4 0 R >> >> ' + contents + ' >>';
  const stream = text => '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>',
    page('/Contents 5 0 R'), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(prose),
    page(''), page('/Contents 8 0 R'), stream(columns)];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, obj] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  }
  // Unreferenced padding between the page objects and the trailer must not be downloaded.
  pdf += '%' + ' '.repeat(2 * 1024 * 1024) + '\n';
  const start = pdf.length;
  pdf += 'xref\n0 9\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return pdf + 'trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
}

module.exports = { fixturePdf };
