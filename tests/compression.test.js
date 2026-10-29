const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const api = require(process.env.PDFCRAFT_TEST_PACKAGE || '../npm')
const { pdf } = require('./fixture')
const code = expected => e => e.code === `ERR_PDFCRAFT_${expected}`
for (const mode of ['lossless', 'balanced', 'strong']) {
  test(`compress ${mode}, text, images, versions and rich catalog`, async () => {
    for (const spec of [{ version: '1.4' }, { version: '1.5' }, { version: '1.7' }, { rich: true }, { image: true }]) {
      const input = pdf(spec), result = await api.compressPdf(input, { mode })
      assert.ok(result.length < input.length)
      assert.match(result.toString('latin1', 0, 8), /%PDF-1\.[57]/)
    }
  })
}
test('strict version policy, validation and output cap', async () => {
  const input = pdf({ version: '1.4' })
  const result = await api.compressPdf(input, { compatibility: '1.4' })
  assert.equal(result.subarray(0, 8).toString(), '%PDF-1.4')
  assert.doesNotMatch(result.toString('latin1'), /\/ObjStm/)
  await assert.rejects(api.compressPdf(pdf(), { compatibility: '1.4' }), code('UNSUPPORTED'))
  await assert.rejects(api.compressPdf(input, { maxInputBytes: 10 }), code('INPUT_TOO_LARGE'))
  await assert.rejects(api.compressPdf(input, { maxOutputBytes: 10 }), code('OUTPUT_TOO_LARGE'))
  await assert.rejects(api.compressPdf(input, { mode: 'bad' }), code('INVALID_ARGUMENT'))
  await assert.rejects(api.compressPdf(Buffer.alloc(0)), code('INVALID_PDF'))
  await assert.rejects(api.compressPdf(Buffer.from('broken')), code('INVALID_PDF'))
  await assert.rejects(api.compressPdf(pdf({ signed: true })), code('UNSUPPORTED'))
})
test('file API, atomic failure and safe same-path replacement', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfcraft-test-'))
  try {
    const input = path.join(dir, 'input.pdf'), output = path.join(dir, 'output.pdf')
    await fs.writeFile(input, pdf()); await fs.writeFile(output, 'keep')
    await assert.rejects(api.compressPdfFile(input, output, { maxOutputBytes: 1 }), code('OUTPUT_TOO_LARGE'))
    assert.equal(await fs.readFile(output, 'utf8'), 'keep')
    await api.compressPdfFile(input, output)
    await api.compressPdfFile(input, input)
    assert.ok((await fs.stat(input)).size < pdf().length)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
test('hard cancellation, timeout, concurrency and caller buffer ownership', async () => {
  const c = new AbortController(); c.abort()
  await assert.rejects(api.compressPdf(pdf(), { signal: c.signal }), code('CANCELLED'))
  const active = new AbortController()
  const work = api.compressPdf(pdf({ image: true }), { signal: active.signal })
  setTimeout(() => active.abort(), 5)
  await assert.rejects(work, code('CANCELLED'))
  await assert.rejects(api.compressPdf(pdf(), { timeoutMs: 1 }), code('TIMEOUT'))
  const input = pdf(); const work2 = api.compressPdf(input); input.fill(0)
  assert.ok((await work2).length)
  const results = await Promise.all(Array.from({ length: 6 }, () => api.compressPdf(pdf())))
  assert.equal(results.length, 6)
})

test('queue capacity rejects excess work and queued cancellation releases its slot', async () => {
  const input=pdf()
  const jobs=Array.from({length:20},()=>api.compressPdf(input))
  const results=await Promise.allSettled(jobs)
  assert.equal(results.filter(r=>r.status==='fulfilled').length,18)
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>code('BUSY')(r.reason)))
  const c=new AbortController()
  const active=[api.compressPdf(input),api.compressPdf(input)]
  const queued=api.compressPdf(input,{signal:c.signal})
  c.abort()
  await assert.rejects(queued,code('CANCELLED'))
  await Promise.all(active)
})
