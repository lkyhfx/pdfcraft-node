const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'npm-dist')
const base = require('../npm/package.json')
for (const arch of ['x64', 'arm64']) {
  const suffix = `linux-${arch}-gnu`, binary = `pdfcraft-node.${suffix}.node`
  const dir = path.join(dist, suffix)
  fs.mkdirSync(dir, { recursive: true })
  for (const name of [binary, 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'THIRD-PARTY-LICENSES.md']) fs.copyFileSync(path.join(root, 'npm', name), path.join(dir, name))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `${base.name}-${suffix}`, version: base.version, license: base.license, repository: base.repository, os: ['linux'], cpu: [arch], libc: ['glibc'], engines: base.engines, main: binary, files: [binary, 'LICENSE-*', 'NOTICE', 'THIRD-PARTY-LICENSES.md'] }, null, 2))
  execFileSync('npm', ['pack', '--pack-destination', dist], { cwd: dir, stdio: 'inherit' })
}
execFileSync('npm', ['pack', '--pack-destination', dist], { cwd: path.join(root, 'npm'), stdio: 'inherit' })
