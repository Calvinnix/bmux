const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const only = process.argv[2]
const files = fs.readdirSync(__dirname)
  .filter((f) => f.startsWith('test-') && f.endsWith('.js'))
  .filter((f) => !only || f.includes(only))
  .sort()

let failed = 0
for (const file of files) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', timeout: 120000 })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  if (res.status === 0) {
    console.log(`\x1b[32mPASS\x1b[0m ${file} (${secs}s)`)
  } else {
    failed++
    console.log(`\x1b[31mFAIL\x1b[0m ${file} (${secs}s)`)
  }
}
console.log(failed ? `\n${failed}/${files.length} failed` : `\nall ${files.length} passed`)
process.exit(failed ? 1 : 0)
