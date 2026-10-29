const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { inflateSync } = require('node:zlib')
const api = require(process.env.PDFCRAFT_TEST_PACKAGE || '../npm')
const { pdf } = require('./fixture')
const code = expected => e => e.code === `ERR_PDFCRAFT_${expected}`
function png(b,w,h) {
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  assert.equal(b.readUInt32BE(16),w); assert.equal(b.readUInt32BE(20),h)
  return b
}
function raw(b) {
  const chunks=[]
  for (let i=8;i<b.length;) { const len=b.readUInt32BE(i); if(b.toString('ascii',i+4,i+8)==='IDAT') chunks.push(b.subarray(i+8,i+8+len)); i+=12+len }
  return inflateSync(Buffer.concat(chunks))
}
test('PDF rendering outputs real PNG pixels and applies bounds', async () => {
  const b = png(await api.renderPdfPage(pdf(),1,{dpi:72}),200,400)
  assert.ok(raw(b).some(v=>v!==255 && v!==0),'contains rendered ink')
  png(await api.renderPdfPage(pdf({rotation:90,userUnit:2}),1,{dpi:72}),800,400)
  await assert.rejects(api.renderPdfPage(pdf({font:'NoSuchFont'}),1),code('RENDER'))
  await assert.rejects(api.renderPdfPage(pdf(),4),code('PAGE_RANGE'))
  await assert.rejects(api.renderPdfPage(pdf(),1,{maxPixels:10}),code('RENDER'))
  await assert.rejects(api.renderPdfPage(pdf(),1,{dpi:0}),code('INVALID_ARGUMENT'))
  await assert.rejects(api.renderPdfPage(pdf(),1,{maxOutputBytes:10}),code('OUTPUT_TOO_LARGE'))
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfcraft-render-'))
  try {
    const input=path.join(dir,'in.pdf'), output=path.join(dir,'out.png')
    await fs.writeFile(input,pdf()); await api.renderPdfPageFile(input,2,output,{dpi:72})
    png(await fs.readFile(output),300,400)
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
test('SVG local rasterization, transparency, dimensions and hostile XML/resources', async () => {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="red" fill-opacity="0.5"/></svg>'
  const b=png(await api.renderSvgToPng(svg),20,10)
  const data=raw(b)
  // PNG's first scanline uses its first byte as the filter type; first red is straight alpha.
  assert.equal(data[1],255); assert.ok(data[4]>=127 && data[4]<=128)
  png(await api.renderSvgToPng(svg,{width:40}),40,20)
  await assert.rejects(api.renderSvgToPng(svg,{maxPixels:1}),code('RENDER'))
  for (const content of [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<?xml-stylesheet href="file:///etc/passwd"?><svg/>',
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><style>@import "https://example.com/a.css";</style></svg>',
    '<svg><rect fill="url(https://example.com/x)"/></svg>',
    '<svg><foreignObject/></svg>',
  ]) await assert.rejects(api.renderSvgToPng(content),code('UNSUPPORTED'))
  await assert.rejects(api.renderSvgToPng('<svg>'),code('UNSUPPORTED'))
})

test('embedded Chinese font PDF can be compressed and rendered', async () => {
  const input=await fs.readFile(path.join(__dirname,'fixtures/chinese.pdf'))
  const compressed=await api.compressPdf(input,{mode:'lossless'})
  assert.equal((await api.getPdfInfo(compressed)).pageCount,1)
  const b=await api.renderPdfPage(compressed,1,{dpi:72})
  assert.ok(b.length>3000)
})
