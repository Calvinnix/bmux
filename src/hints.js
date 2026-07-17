const HINT_CHARS = 'asdfghjkl'

const CLICKABLE = `[...document.querySelectorAll('a[href], button, input, select, textarea, summary, [onclick], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]')]
  .map((el) => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ el, r }) =>
    r.width > 3 && r.height > 3 &&
    r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth &&
    getComputedStyle(el).visibility !== 'hidden')`

function makeLabels(total) {
  const chars = HINT_CHARS
  const len = total <= chars.length ? 1 : total <= chars.length ** 2 ? 2 : 3
  const labels = []
  for (let i = 0; i < total; i++) {
    let s = ''
    let n = i
    for (let k = 0; k < len; k++) {
      s = chars[n % chars.length] + s
      n = Math.floor(n / chars.length)
    }
    labels.push(s)
  }
  return labels
}

function countScript() {
  return `(() => {
    const els = ${CLICKABLE}
    return els.length
  })()`
}

function setupScript(labels, openInNewTab) {
  return `(() => {
    if (window.__bmuxHints) window.__bmuxHints.cancel()
    const labels = ${JSON.stringify(labels)}
    const els = ${CLICKABLE}
    if (!els.length || !labels.length) return 0
    const root = document.createElement('div')
    root.id = '__bmux-hints'
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Menlo,monospace'
    const hints = els.slice(0, labels.length).map(({ el, r }, i) => {
      const tag = document.createElement('span')
      tag.textContent = labels[i]
      tag.style.cssText = 'position:fixed;left:' + Math.max(0, r.left) + 'px;top:' + Math.max(0, r.top - 13) +
        'px;background:#1a1b26;color:#e0af68;border:1px solid #3b4261;border-radius:3px;padding:0 3px;font-size:10px;line-height:14px;font-weight:700'
      root.appendChild(tag)
      return { el, tag, label: labels[i] }
    })
    document.documentElement.appendChild(root)
    let raf = null
    const reposition = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        for (const h of hints) {
          const r = h.el.getBoundingClientRect()
          const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth
          h.tag.style.left = Math.max(0, r.left) + 'px'
          h.tag.style.top = Math.max(0, r.top - 13) + 'px'
          if (off) h.tag.style.opacity = '0'
          else h.tag.style.removeProperty('opacity')
        }
      })
    }
    addEventListener('scroll', reposition, { capture: true, passive: true })
    addEventListener('resize', reposition, { passive: true })
    let buffer = ''
    window.__bmuxHints = {
      key(ch) {
        buffer += ch
        let live = 0
        for (const h of hints) {
          if (h.label === buffer) {
            this.cancel()
            const href = h.el.tagName === 'A' ? h.el.href : null
            if (${!!openInNewTab} && href) return { status: 'hit', href }
            if (h.el.matches('input, textarea, select, [contenteditable="true"]')) h.el.focus()
            else { h.el.focus(); h.el.click() }
            return { status: 'hit', href: null }
          }
          const match = h.label.startsWith(buffer)
          h.tag.style.display = match ? '' : 'none'
          if (match) live++
        }
        if (!live) { this.cancel(); return { status: 'miss' } }
        return { status: 'pending' }
      },
      cancel() {
        removeEventListener('scroll', reposition, { capture: true })
        removeEventListener('resize', reposition)
        root.remove()
        delete window.__bmuxHints
      },
    }
    return hints.length
  })()`
}

module.exports = { makeLabels, countScript, setupScript }
