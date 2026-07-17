const http = require('http')

function start(api) {
  const server = http.createServer(async (req, res) => {
    if (req.headers['origin'] || req.headers['sec-fetch-site']) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    const url = new URL(req.url, 'http://localhost')
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const params = body ? JSON.parse(body) : {}
      if (url.pathname === '/state') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(api.getState()))
        return
      }
      if (url.pathname === '/key') {
        const wc = api.targetWebContents(params.target || 'active')
        wc.focus()
        wc.sendInputEvent({ type: 'keyDown', keyCode: params.keyCode, modifiers: params.modifiers || [] })
        wc.sendInputEvent({ type: 'keyUp', keyCode: params.keyCode, modifiers: params.modifiers || [] })
        res.end('ok')
        return
      }
      if (url.pathname === '/eval') {
        const wc = api.targetWebContents(params.target || 'active')
        const result = await wc.executeJavaScript(params.code, true)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ result }))
        return
      }
      if (url.pathname === '/main') {
        const result = await api.evalMain(params.code)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ result }))
        return
      }
      if (url.pathname === '/shot') {
        const wc = api.targetWebContents(url.searchParams.get('target') || 'active')
        const image = await wc.capturePage()
        res.setHeader('content-type', 'image/png')
        res.end(image.toPNG())
        return
      }
      res.statusCode = 404
      res.end('unknown endpoint')
    } catch (err) {
      res.statusCode = 500
      res.end(String(err && err.stack ? err.stack : err))
    }
  })
  server.listen(Number(process.env.BMUX_DEBUG_PORT) || 9223, '127.0.0.1')
}

module.exports = { start }
