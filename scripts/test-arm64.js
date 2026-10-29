// Run with an ARM64 Node binary (on hardware or under QEMU); tests the packaged addon directly.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pdf } = require('../tests/fixture')
async function main() {
  assert.equal(process.arch,'arm64')
  const dir = await fs.mkdtemp('/tmp/pdfcraft-arm-')
  const binding = require(process.env.PDFCRAFT_ARM_ADDON || '../npm/pdfcraft-node.linux-arm64-gnu.node')
  const input=path.join(dir,'input.pdf'); await fs.writeFile(input,pdf())
  const base={inputs:[input],outputs:[],maxInputBytes:512*1024*1024,maxOutputBytes:256*1024*1024}
  async function execute(op,extra={}) { return JSON.parse(await binding.execute(JSON.stringify({...base,op,...extra}))) }
  try {
    assert.equal((await execute('info')).pageCount,3)
    const output=path.join(dir,'compressed.pdf')
    await execute('compress',{outputs:[output],mode:'balanced'})
    assert.ok((await fs.stat(output)).size < pdf().length)
    const selected=path.join(dir,'selected.pdf')
    await execute('select',{outputs:[selected],pages:[3,1,3]})
    assert.deepEqual((await execute('info',{inputs:[selected]})).pages.map(p=>p.width),[400,200,400])
    const png=path.join(dir,'page.png')
    await execute('render',{outputs:[png],pages:[1],dpi:72})
    assert.equal((await fs.readFile(png)).readUInt32BE(16),200)
    const svg=path.join(dir,'input.svg'), raster=path.join(dir,'svg.png')
    await fs.writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>')
    await execute('svg',{inputs:[svg],outputs:[raster]})
    assert.equal((await fs.readFile(raster)).readUInt32BE(16),20)
    console.log('ARM64 native compression, info, duplicate selection, PDF and SVG render passed')
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
}
main().catch(e=>{console.error(e);process.exitCode=1})
