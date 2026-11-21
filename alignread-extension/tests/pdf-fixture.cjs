function fixturePdf() {
  const text = (x, y, value, size = 12) => 'BT /F1 ' + size + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + value + ') Tj ET';
  const fraction = (x, y, labelX, label) => [
    text(x, y, 'f ='), text(x + 22, y + 8, '1', 9), text(x + 22, y - 7, 'N', 9),
    text(x + 30, y + 15, '!', 12), text(labelX, y, '\\(' + label + '\\)'),
    (x + 18) + ' ' + (y + 4) + ' m ' + (x + 29) + ' ' + (y + 4) + ' l S',
  ].join('\n');
  const prose = 'BT /F1 14 Tf 20 150 Td (Ordinary prose) Tj 0 -25 Td (x = 2) Tj 0 -25 Td (Let a + b be positive) Tj ET\n' +
    fraction(125, 62, 270, '1.1') + '\n' + text(155, 20, '1');
  const columns = [
    [135, 260, 'Article title'], [20, 200, 'Inside the left column'], [180, 191, 'Inside the right column'],
    [20, 180, 'continues here.'], [180, 171, 'finishes here.'], [20, 102, 'Closing note'],
  ].map(([x, y, value]) => text(x, y, value)).join('\n');
  const columnEquations = fraction(55, 145, 110, '2.1') + '\n' + fraction(192, 145, 252, '2.2');
  const graphics = 'q 1 0 0 1 30 31 cm /Figure Do Q BT /F1 12 Tf 35 12 Td (Figure 1: Comparison of both columns.) Tj ET';
  const drawing = [
    '0 0 260 60 re S', '0 30 m 260 30 l S', '130 0 m 130 60 l S',
    'BT /F1 12 Tf 10 43 Td (Labels inside the illustration) Tj ET',
  ].join('\n');
  const table = [
    '20 110 m 220 110 l S', '20 65 m 220 65 l S', '20 65 m 20 110 l S', '220 65 m 220 110 l S',
    'BT /F1 10 Tf 28 80 Td (Labels inside the table) Tj ET',
  ].join('\n');
  const page = contents => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 300] /Resources << /Font << /F1 4 0 R >> /XObject << /Figure 9 0 R >> >> ' + contents + ' >>';
  const stream = (text, entries = '') => '<< ' + entries + ' /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R 10 0 R 11 0 R] /Count 5 >>',
    page('/Contents 5 0 R'), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(prose),
    page(''), page('/Contents 8 0 R'), stream(columns + '\n' + columnEquations + '\n' + graphics),
    stream(drawing, '/Type /XObject /Subtype /Form /BBox [0 0 260 60] /Resources << /Font << /F1 4 0 R >> >>'),
    page('/Contents 12 0 R'), page('/Contents 13 0 R'),
    stream('BT /F1 14 Tf 20 150 Td (Fourth page prose) Tj ET\n' + table),
    stream('BT /F1 14 Tf 20 150 Td (Fifth page prose) Tj ET')];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, obj] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  }
  // Unreferenced padding between the page objects and the trailer must not be downloaded.
  pdf += '%' + ' '.repeat(2 * 1024 * 1024) + '\n';
  const start = pdf.length;
  pdf += 'xref\n0 14\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return pdf + 'trailer\n<< /Size 14 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
}

module.exports = { fixturePdf };
