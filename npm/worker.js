'use strict'
const { arch, platform } = process
process.once('message', async (request) => {
  try {
    if (platform !== 'linux' || !['x64', 'arm64'].includes(arch) || !process.report.getReport().header.glibcVersionRuntime) {
      throw new Error('ERR_PDFCRAFT_UNSUPPORTED: Linux x64/arm64 glibc required')
    }
    const name = `pdfcraft-node.linux-${arch}-gnu.node`
    let binding
    try { binding = require(`./${name}`) } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e
      binding = require(`@lkyhfx/pdfcraft-node-linux-${arch}-gnu`)
    }
    const result = await binding.execute(JSON.stringify(request))
    process.send({ result: JSON.parse(result) }, () => process.exit(0))
  } catch (e) {
    const code = /^ERR_PDFCRAFT_[A-Z_]+/.exec(e.message)?.[0] || 'ERR_PDFCRAFT_IO'
    process.send({ error: { code, message: e.message } }, () => process.exit(1))
  }
})
