import { createElement, useMemo, type ReactNode } from 'react'

const richTag = /<\/?(?:a|b|blockquote|br|code|del|div|em|font|h[1-6]|hr|i|ins|li|ol|p|pre|s|span|strike|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)\b/i
const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math', 'form', 'input', 'button', 'video', 'audio'])
const allowedTags = new Set(['blockquote', 'code', 'div', 'em', 'li', 'ol', 'p', 'pre', 's', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'])

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const element = node as Element
  const tag = element.localName.toLowerCase()
  if (blockedTags.has(tag)) return null
  if (tag === 'br' || tag === 'hr') return createElement(tag, { key })
  const children = Array.from(element.childNodes, (child, index) => renderNode(child, `${key}-${index}`))
  if (tag === 'a') return createElement('span', { key }, ...children)
  if (tag === 'b' || tag === 'i' || tag === 'strike' || tag === 'del' || tag === 'ins') {
    return createElement(tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag === 'ins' ? 'u' : 's', { key }, ...children)
  }
  if (/^h[1-6]$/.test(tag)) return createElement('h3', { key }, ...children)
  if (allowedTags.has(tag)) return createElement(tag, { key }, ...children)
  if (tag === 'span' || tag === 'font') {
    const style = element.getAttribute('style') || ''
    let content: ReactNode = createElement('span', { key }, ...children)
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) content = createElement('strong', { key }, content)
    if (/font-style\s*:\s*italic/i.test(style)) content = createElement('em', { key }, content)
    if (/text-decoration(?:-line)?\s*:\s*underline/i.test(style)) content = createElement('u', { key }, content)
    if (/text-decoration(?:-line)?\s*:\s*line-through/i.test(style)) content = createElement('s', { key }, content)
    return content
  }
  return createElement('span', { key }, ...children)
}

export function EventDescription({ text }: { text: string }) {
  const rich = richTag.test(text)
  const content = useMemo(() => {
    if (!rich) return text
    const document = new DOMParser().parseFromString(text, 'text/html')
    return Array.from(document.body.childNodes, (node, index) => renderNode(node, String(index)))
  }, [text, rich])
  return <div className={`event-description${rich ? ' is-rich' : ' is-plain'}`}>{content}</div>
}
