const api=require('../npm')
async function main() {
  const [input,output,op]=process.argv.slice(2)
  if(op==='batches') console.log(JSON.stringify(await api.extractPdfRangesFile(input,output,[{start:1,end:264}],{maxRangePages:128})))
  else if(op==='render') await api.renderPdfPageFile(input,1,output,{dpi:72})
  else await api.compressPdfFile(input,output,{mode:op})
}
main().catch(e=>{console.error(e.code,e.message);process.exitCode=1})
