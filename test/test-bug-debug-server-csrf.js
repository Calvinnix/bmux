const assert = require('assert')
const { launch } = require('./harness')

async function main() {
  const app = await launch()
  try {
    const attack = { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ code: '1 + 1' }) }

    const withOrigin = await fetch(`${app.base}/main`, { ...attack, headers: { ...attack.headers, origin: 'https://evil.example' } })
    assert.equal(withOrigin.status, 403, 'a request carrying Origin is rejected before eval')

    const withSecFetch = await fetch(`${app.base}/main`, { ...attack, headers: { ...attack.headers, 'sec-fetch-site': 'cross-site' } })
    assert.equal(withSecFetch.status, 403, 'a request carrying Sec-Fetch-Site is rejected before eval')

    assert.equal(await app.evalMain('2 + 2'), 4, 'the Node harness (no browser headers) still works')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
