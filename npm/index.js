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
    const env = { ...process.env, UV_THREADPOOL_SIZE: '1', MALLOC_ARENA_MAX: '2' }
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
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfcraft-node-'))
    const stages = []
    try {
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
      const buffers = []
      for (const [i, destination] of destinations.entries()) {
        if (destination) await fs.rename(outputs[i], destination)
        else buffers.push(await fs.readFile(outputs[i]))
      }
      return destinations.every(Boolean) ? undefined : buffers.length === 1 ? buffers[0] : buffers
    } catch (e) {
      if (e.code?.startsWith('ERR_PDFCRAFT_')) throw e
      throw error('IO', e.message)
    } finally {
      await Promise.all(stages.map(p => fs.rm(p, { force: true }).catch(() => {})))
      await fs.rm(temp, { recursive: true, force: true })
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
