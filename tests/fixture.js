'use strict'
// Minimal deterministic fixtures only; production PDF parsing/writing stays in Rust.
function pdf({ version = '1.7', signed = false, encrypted = false, rich = false, image = false } = {}) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${rich ? '/Outlines 9 0 R /AcroForm << /Fields [11 0 R] >> /Names << /EmbeddedFiles << /Names [(note.txt) 12 0 R] >> >> /Metadata 14 0 R /StructTreeRoot 15 0 R /OCProperties << /OCGs [16 0 R] /D << /ON [16 0 R] >> >>' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
  ]
  for (let i = 0; i < 3; i++) {
    const content = `BT /F1 12 Tf 10 20 Td (Page ${i + 1}) Tj ET\n` + (image ? 'q 100 0 0 100 0 0 cm /Im1 Do Q\n' : '') + '% padding for compression\n'.repeat(5000)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${200 + i * 100} 400] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> ${image ? '/XObject << /Im1 17 0 R >>' : ''} >> /Contents ${4 + i * 2} 0 R ${rich && i === 0 ? '/Annots [11 0 R]' : ''} >>`)
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
  }
  if (rich) objects.push(
    '<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 1 >>',
    '<< /Title (First page) /Parent 9 0 R /Dest [3 0 R /Fit] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Alice) /Rect [10 10 80 30] /P 3 0 R >>',
    '<< /Type /Filespec /F (note.txt) /EF << /F 13 0 R >> >>',
    '<< /Type /EmbeddedFile /Length 5 >>\nstream\nhello\nendstream',
    '<< /Type /Metadata /Subtype /XML /Length 4 >>\nstream\n<x/>\nendstream',
    '<< /Type /StructTreeRoot /K [] >>',
    '<< /Type /OCG /Name (Layer 1) >>',
  )
  if (image) {
    while (objects.length < 16) objects.push('<< >>')
    const pixels = Buffer.alloc(600 * 600 * 3, 128).toString('latin1')
    objects.push(`<< /Type /XObject /Subtype /Image /Width 600 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`)
  }
  if (signed) objects[0] = objects[0].replace(' /Pages', ' /Signature << /Type /Sig /ByteRange [0 1 2 3] >> /Pages')
  let text = `%PDF-${version}\n`, offsets = [0]
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(text, 'latin1')); text += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(text, 'latin1')
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? '/Encrypt << /Filter /Standard /V 1 /R 2 /O (bad) /U (bad) /P -4 >>' : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text, 'latin1')
}
module.exports = { pdf }
