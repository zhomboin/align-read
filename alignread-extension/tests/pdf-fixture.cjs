function fixturePdf() {
  const text = (x, y, value, size = 12, font = 'F1') =>
    'BT /' + font + ' ' + size + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + value + ') Tj ET';
  const fraction = (x, y, labelX, label) => [
    text(x, y, 'f ='), text(x + 22, y + 8, '1', 9), text(x + 22, y - 7, 'N', 9),
    text(x + 30, y + 15, '!', 12), text(labelX, y, '\\(' + label + '\\)'),
    (x + 18) + ' ' + (y + 4) + ' m ' + (x + 29) + ' ' + (y + 4) + ' l S',
  ].join('\n');
  const research = text(20, 240, 'Research for AI + Science remains useful.') +
    '\n' + text(20, 270, 'function parametrized as a spline.') +
    '\n' + text(20, 295, 'function f\\(x\\) is smooth on this interval.');
  const exponent = [text(20, 215, 'The result is'), text(89, 215, '10'), text(102.3, 219.3, '2', 8),
  text(110, 215, 'with modest error.')].join('\n');
  const prose = research + '\n' + exponent + '\n' +
    'BT /F1 14 Tf 20 150 Td (Ordinary prose) Tj 0 -25 Td (x = 2) Tj 0 -25 Td (Let a + b and c + d be positive) Tj ET\n' +
    fraction(125, 62, 270, '1.1') + '\n' + text(155, 20, '1');
  const columns = [
    [20, 200, 'Inside the left column'], [180, 191, 'Inside the right column'],
    [20, 180, 'continues here.'], [180, 171, 'finishes here.'],
  ].map(([x, y, value]) => text(x, y, value)).join('\n');
  const chapter = text(125, 260, '2', 15, 'F2') + '\n' + text(153, 260, 'Article title', 15, 'F2');
  const subsection = text(20, 102, '2.1 Closing note', 12, 'F2');
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
  const horizontalTable = [
    ...[296, 279, 262, 245].map(y => '20 ' + y + ' m 298 ' + y + ' l S'),
    text(31, 284, 'Sparse table label', 9), text(181, 284, 'Measured result', 9),
    text(31, 267, 'Sample one', 9), text(181, 267, '23.4', 9),
    text(31, 250, 'Sample two', 9), text(181, 250, '19.6', 9),
  ].join('\n');
  const displayFunction = [
    text(97, 174, 'f\\(x\\) = w\\(spline\\(x\\)\\)'), text(282, 174, '\\(4.2\\)'),
  ].join('\n');
  const notes = [
    text(20, 53, '2', 7), text(24, 49, 'First source note has a superscript.', 9),
    text(20, 39, '3', 7), text(24, 35, 'Second source note must stay separate.', 9),
  ].join('\n');
  const indexedConditions = [
    text(30, 206, 'A = 1'),
    text(78, 206, 'p = 1, n'), text(118.4, 204, 'in', 8), text(125, 206, ','),
    text(145, 206, 'q = 1, n'), text(185.4, 204, 'out', 8), text(198, 206, ','),
    text(223, 206, 'r = limit'),
    text(282, 206, '\\(4.1\\)'),
  ].join('\n');
  const alignment = [
    text(20, 247, 'This is a reference paragraph across the page for testing.'),
    text(20, 215, 'x = 7'),
    text(124, 180, 'ALG\\(x\\) = x + 2'), text(296, 180, '\\(5.1\\)'),
    text(292, 143, 'z = 3'),
  ].join('\n');
  const wideEquation = [
    text(20, 79, 'f ='), text(64, 92, 'N', 9), text(60, 81, 'X', 14), text(60, 67, 'i=1', 9),
    text(87, 79, 'b1 + b2 + b3 + b4 + b5 + b6 + b7'), text(269, 79, '+ 0.5'),
    text(285, 54, '\\(5.2\\)'),
  ].join('\n');
  const page = contents => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 300] /Resources << /Font << /F1 4 0 R /F2 14 0 R >> /XObject << /Figure 9 0 R >> >> ' + contents + ' >>';
  const stream = (text, entries = '') => '<< ' + entries + ' /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R 10 0 R 11 0 R] /Count 5 >>',
    page('/Contents 5 0 R'), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(prose),
    page(''), page('/Contents 8 0 R'), stream([chapter, columns, columnEquations, subsection, graphics].join('\n')),
    stream(drawing, '/Type /XObject /Subtype /Form /BBox [0 0 260 60] /Resources << /Font << /F1 4 0 R >> >>'),
    page('/Contents 12 0 R'), page('/Contents 13 0 R'),
    stream([horizontalTable, indexedConditions, displayFunction,
      text(20, 132, 'Fourth page prose above the enclosed table.', 14), table, notes, text(20, 12, '4')].join('\n')),
    stream([text(20, 110, 'Fifth page prose', 14), text(289, 282, 'v'), alignment, wideEquation].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    // The range reader should be able to leave an unreferenced stream untouched.
    stream(' '.repeat(2 * 1024 * 1024))];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, obj] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  }
  const start = pdf.length;
  const size = objects.length + 1;
  pdf += 'xref\n0 ' + size + '\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return pdf + 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
}

module.exports = { fixturePdf };
