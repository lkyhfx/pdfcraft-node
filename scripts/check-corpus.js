// Optional local acceptance tool; no document corpus is bundled or downloaded.
const fs=require('node:fs/promises'), path=require('node:path')
const api=require('../npm')
async function main() {
  const dir=process.argv[2]
  if(!dir) throw new Error('usage: node scripts/check-corpus.js <pdf-directory>')
  const report=[]
  for(const name of (await fs.readdir(dir)).filter(n=>n.endsWith('.pdf'))) {
    const input=await fs.readFile(path.join(dir,name)), row={name,inputBytes:input.length}
    try {
      const info=await api.getPdfInfo(input); row.pages=info.pageCount
      row.compression=[]
      for(const mode of ['lossless','balanced','strong']) {
        const started=performance.now()
        try {
          const result=await api.compressPdf(input,{mode})
          const out=await api.getPdfInfo(result)
          if(out.pageCount!==info.pageCount) throw new Error('page count mismatch')
          row.compression.push({mode,bytes:result.length,ms:Math.round(performance.now()-started)})
        } catch(e) { row.compression.push({mode,error:e.code||e.message}) }
      }
      try { row.pngBytes=(await api.renderPdfPage(input,1,{dpi:72})).length } catch(e) {row.renderError=e.code||e.message}
    } catch(e) {row.error=e.code||e.message}
    report.push(row)
  }
  console.log(JSON.stringify(report,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
