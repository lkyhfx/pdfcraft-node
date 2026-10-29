'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { fork } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const INPUT = 512 * 1024 * 1024
const OUTPUT = 256 * 1024 * 1024
let running = 0
let retained = 0
const queue = []
function error(code, message) { return Object.assign(new Error(message), { code: `ERR_PDFCRAFT_${code}` }) }
function integer(value, fallback, max, name) {
  value ??= fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw error('INVALID_ARGUMENT', `${name} must be 1..${max}`)
  return value
}
function options(o = {}) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw error('INVALID_ARGUMENT', 'options must be an object')
  if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) throw error('INVALID_ARGUMENT', 'signal must be an AbortSignal')
  if (o.signal?.aborted) throw error('CANCELLED', 'operation cancelled')
  return { ...o, maxInputBytes: integer(o.maxInputBytes, INPUT, INPUT, 'maxInputBytes'), maxOutputBytes: integer(o.maxOutputBytes, OUTPUT, OUTPUT, 'maxOutputBytes'), timeoutMs: integer(o.timeoutMs, 120000, 300000, 'timeoutMs') }
}
function filename(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw error('INVALID_ARGUMENT', 'invalid file path')
  return path.resolve(p)
}
function snapshot(b, max) {
  if (!(b instanceof Uint8Array)) throw error('INVALID_ARGUMENT', 'input must be Buffer or Uint8Array')
  if (b.buffer instanceof SharedArrayBuffer) throw error('INVALID_ARGUMENT', 'shared input memory is unsupported')
  if (b.byteLength > max) throw error('INPUT_TOO_LARGE', 'input exceeds limit')
  if (queue.length >= 16 || retained + b.byteLength > INPUT) throw error('BUSY', 'native queue capacity exceeded')
  return Buffer.from(b)
}
function drain() {
  while (running < 2 && queue.length) {
    const job = queue.shift()
    job.signal?.removeEventListener('abort', job.abort)
    running++
    job.run().then(job.resolve, job.reject).finally(() => { running--; retained -= job.bytes; drain() })
  }
}
function schedule(run, signal, bytes) {
  if (signal?.aborted) return Promise.reject(error('CANCELLED', 'operation cancelled'))
  if (queue.length >= 16 || retained + bytes > INPUT) return Promise.reject(error('BUSY', 'native queue capacity exceeded'))
  retained += bytes
  return new Promise((resolve, reject) => {
    const job = { run, signal, bytes, resolve, reject }
    job.abort = () => {
      const i = queue.indexOf(job)
      if (i >= 0) { queue.splice(i, 1); retained -= bytes; reject(error('CANCELLED', 'operation cancelled')) }
    }
    signal?.addEventListener('abort', job.abort, { once: true })
    queue.push(job)
    drain()
  })
}
function execute(request, o) {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(error('CANCELLED', 'operation cancelled'))
    const env = { ...process.env, UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1', MALLOC_ARENA_MAX: '2' }
    delete env.NODE_TEST_CONTEXT
    const child = fork(path.join(__dirname, 'worker.js'), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'],
      env,
    })
    let message, failure
    function stop(e) { failure ??= e; child.kill('SIGKILL') }
    const abort = () => stop(error('CANCELLED', 'operation cancelled'))
    o.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop(error('TIMEOUT', 'native operation timed out')), o.timeoutMs)
    const memory = setInterval(async () => {
      try {
        const status = await fs.readFile(`/proc/${child.pid}/status`, 'utf8')
        const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] || 0) * 1024
        if (rss > 1536 * 1024 * 1024) stop(error('RESOURCE_LIMIT', 'worker memory limit exceeded'))
      } catch { /* worker may already have exited */ }
    }, 25)
    child.on('message', value => { message = value })
    child.on('error', e => { failure ??= error('IO', e.message) })
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearInterval(memory); o.signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (message?.error) reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
      else if (code !== 0 || signal || !message) reject(error('RESOURCE_LIMIT', 'native worker terminated without a result'))
      else resolve(message.result)
    })
    child.send(request, e => { if (e) stop(error('IO', e.message)) })
  })
}
async function run(op, sources, destinations, extra, o) {
  const bytes = sources.reduce((n, s) => n + (Buffer.isBuffer(s) ? s.length : 0), 0)
  return schedule(async () => {
    let temp
    const stages = []
    const published = []
    try {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfcraft-node-'))
      if (o.signal?.aborted) throw error('CANCELLED', 'operation cancelled')
      const inputs = []
      for (const [i, s] of sources.entries()) {
        if (Buffer.isBuffer(s)) { const p = path.join(temp, `input-${i}.pdf`); await fs.writeFile(p, s); inputs.push(p) }
        else inputs.push(s)
      }
      const outputs = destinations.map((p, i) => {
        const stage = p ? path.join(path.dirname(p), `.pdfcraft-${randomUUID()}.tmp`) : path.join(temp, `output-${i}`)
        stages.push(stage)
        return stage
      })
      const result = await execute({ op, inputs, outputs, maxInputBytes: o.maxInputBytes, maxOutputBytes: o.maxOutputBytes, ...extra }, o)
      if (o.signal?.aborted) throw error('CANCELLED', 'operation cancelled')
      if (!destinations.length) return result
      if (op === 'batches') {
        const manifest = []
        for (const item of result) {
          const destination = destinations[item.index]
          await fs.rename(outputs[item.index], destination)
          published.push(destination)
          manifest.push({ path: destination, start: item.start, end: item.end, bytes: item.bytes })
        }
        return manifest
      }
      const buffers = []
      for (const [i, destination] of destinations.entries()) {
        if (destination) await fs.rename(outputs[i], destination)
        else buffers.push(await fs.readFile(outputs[i]))
      }
      return destinations.every(Boolean) ? undefined : buffers.length === 1 ? buffers[0] : buffers
    } catch (e) {
      await Promise.all(published.map(p => fs.rm(p, { force: true }).catch(() => {})))
      if (e.code?.startsWith('ERR_PDFCRAFT_')) throw e
      throw error('IO', e.message)
    } finally {
      await Promise.all(stages.map(p => fs.rm(p, { force: true }).catch(() => {})))
      if (temp) await fs.rm(temp, { recursive: true, force: true })
    }
  }, o.signal, bytes)
}
function compressOptions(o) {
  o = options(o)
  const mode = o.mode ?? 'balanced', compatibility = o.compatibility ?? 'retain'
  if (!['lossless', 'balanced', 'strong'].includes(mode) || !['retain', '1.4', '1.5', '1.6', '1.7', '2.0'].includes(compatibility)) throw error('INVALID_ARGUMENT', 'invalid compression mode or compatibility')
  return [o, { mode, compatibility }]
}
exports.compressPdf = async (input, opts) => {
  const [o, extra] = compressOptions(opts)
  return run('compress', [snapshot(input, o.maxInputBytes)], [null], extra, o)
}
exports.compressPdfFile = async (input, output, opts) => {
  const [o, extra] = compressOptions(opts)
  return run('compress', [filename(input)], [filename(output)], extra, o)
}

function pages(value) {
  if (!Array.isArray(value) || !value.length || value.length > 10000 || value.some(p => !Number.isInteger(p) || p < 1 || p > 10000)) throw error('PAGE_RANGE', 'provide 1..10000 integer page numbers')
  return [...value]
}
function ranges(value) {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw error('PAGE_RANGE', 'provide 1..128 inclusive ranges')
  return value.map(r => {
    if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 1 || r.end < r.start || r.end > 10000) throw error('PAGE_RANGE', 'invalid page range')
    return { start: r.start, end: r.end }
  })
}
function sources(value, o, files) {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw error('INVALID_ARGUMENT', 'provide 1..128 inputs')
  if (!files && value.reduce((n,b) => n + (b?.byteLength || 0), 0) > o.maxInputBytes) throw error('INPUT_TOO_LARGE', 'aggregate input exceeds limit')
  if (!files && retained + value.reduce((n,b) => n + (b?.byteLength || 0), 0) > INPUT) throw error('BUSY', 'native queue capacity exceeded')
  return value.map(b => files ? filename(b) : snapshot(b, o.maxInputBytes))
}
exports.getPdfInfo = async (input, opts) => {
  const o = options(opts)
  return run('info', [snapshot(input, o.maxInputBytes)], [], {}, o)
}
exports.getPdfInfoFile = async (input, opts) => {
  const o = options(opts)
  return run('info', [filename(input)], [], {}, o)
}
exports.mergePdfs = async (inputs, opts) => {
  const o = options(opts)
  return run('merge', sources(inputs, o, false), [null], {}, o)
}
exports.mergePdfFiles = async (inputs, output, opts) => {
  const o = options(opts)
  return run('merge', sources(inputs, o, true), [filename(output)], {}, o)
}
exports.selectPdfPages = async (input, selected, opts) => {
  const o = options(opts), list = pages(selected)
  return run('select', [snapshot(input, o.maxInputBytes)], [null], { pages: list }, o)
}
exports.removePdfPages = async (input, selected, opts) => {
  const o = options(opts), list = pages(selected)
  return run('remove', [snapshot(input, o.maxInputBytes)], [null], { pages: list }, o)
}
exports.replacePdfPages = async (input, replacement, selected, opts) => {
  const o = options(opts), list = pages(selected)
  return run('replace', sources([input, replacement], o, false), [null], { pages: list }, o)
}
exports.splitPdf = async (input, selected, opts) => {
  const o = options(opts), list = ranges(selected)
  const result = await run('split', [snapshot(input, o.maxInputBytes)], list.map(() => null), { ranges: list }, o)
  return Array.isArray(result) ? result : [result]
}
exports.extractPdfPagesFile = async (input, output, selected, opts) => {
  const o = options(opts), list = pages(selected)
  return run('select', [filename(input)], [filename(output)], { pages: list }, o)
}
exports.extractPdfRangesFile = async (input, outputDirectory, selected, opts) => {
  const o = options(opts), list = ranges(selected)
  const maxBatchBytes = integer(o.maxBatchBytes, o.maxOutputBytes, o.maxOutputBytes, 'maxBatchBytes')
  const maxRangePages = integer(o.maxRangePages, 128, 128, 'maxRangePages')
  const maxOutputs = integer(o.maxOutputs, 128, 128, 'maxOutputs')
  const dir = filename(outputDirectory), prefix = `pdfcraft-${randomUUID()}`
  const destinations = Array.from({ length: maxOutputs }, (_,i) => path.join(dir, `${prefix}-${i + 1}.pdf`))
  return run('batches', [filename(input)], destinations, { ranges: list, maxBatchBytes, maxRangePages }, o)
}
function renderOptions(opts) {
  const o = options(opts)
  const extra = {
    maxWidth: integer(o.maxWidth, 8192, 8192, 'maxWidth'),
    maxHeight: integer(o.maxHeight, 8192, 8192, 'maxHeight'),
    maxPixels: integer(o.maxPixels, 32000000, 32000000, 'maxPixels'),
  }
  if (o.transparent !== undefined && typeof o.transparent !== 'boolean') throw error('INVALID_ARGUMENT', 'transparent must be boolean')
  extra.transparent = o.transparent ?? false
  return [o, extra]
}
exports.renderPdfPage = async (input, page, opts) => {
  const [o, extra] = renderOptions(opts)
  const dpi = o.dpi ?? 144
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 1200) throw error('INVALID_ARGUMENT', 'DPI must be >0 and <=1200')
  return run('render', [snapshot(input, o.maxInputBytes)], [null], { ...extra, pages: pages([page]), dpi }, o)
}
exports.renderPdfPageFile = async (input, page, output, opts) => {
  const [o, extra] = renderOptions(opts)
  const dpi = o.dpi ?? 144
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 1200) throw error('INVALID_ARGUMENT', 'DPI must be >0 and <=1200')
  return run('render', [filename(input)], [filename(output)], { ...extra, pages: pages([page]), dpi }, o)
}
exports.renderSvgToPng = async (input, opts) => {
  const [o, extra] = renderOptions(opts)
  const max = Math.min(o.maxInputBytes, 8 * 1024 * 1024)
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > max) throw error('INPUT_TOO_LARGE', 'SVG input exceeds limit')
    input = Buffer.from(input)
  }
  if (o.width !== undefined) extra.width = integer(o.width, undefined, 8192, 'width')
  if (o.height !== undefined) extra.height = integer(o.height, undefined, 8192, 'height')
  return run('svg', [snapshot(input, max)], [null], extra, o)
}
