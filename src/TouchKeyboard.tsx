import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type TextField = HTMLInputElement | HTMLTextAreaElement

const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

function isTextField(element: EventTarget | null): element is TextField {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  return element instanceof HTMLInputElement &&
    ['text', 'search', 'email', 'tel', 'url', 'number'].includes(element.type) && !element.disabled && !element.readOnly
}

function changeField(field: TextField, replacement: string, backspace = false) {
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const from = backspace && start === end ? Math.max(0, start - 1) : start
  if (backspace && from === end) return
  const next = field.value.slice(0, from) + replacement + field.value.slice(end)
  if (field.maxLength >= 0 && next.length > field.maxLength) return
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value',
  )?.set
  setter?.call(field, next)
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: backspace ? 'deleteContentBackward' : 'insertText', data: replacement }))
  field.focus()
  field.setSelectionRange(from + replacement.length, from + replacement.length)
}

export function TouchKeyboard() {
  const [field, setField] = useState<TextField | null>(null)
  const [shift, setShift] = useState(false)

  useEffect(() => {
    function revealField(target: TextField) {
      window.setTimeout(() => {
        if (document.activeElement !== target) return
        const keyboard = document.querySelector('.touch-keyboard')
        if (!keyboard) return
        const overlap = target.getBoundingClientRect().bottom - keyboard.getBoundingClientRect().top + 12
        if (overlap > 0) (target.closest('.dialog-inner') || document.scrollingElement)?.scrollBy({ top: overlap })
      }, 80)
    }
    function onFocus(event: FocusEvent) {
      if (isTextField(event.target)) {
        const target = event.target
        // Wait for the tap to finish before the keyboard can cover its target.
        window.setTimeout(() => {
          if (document.activeElement === target) { setField(target); revealField(target) }
        }, 160)
      }
    }
    function onPointer(event: PointerEvent) {
      if (!isTextField(event.target) && !(event.target instanceof Element && event.target.closest('.touch-keyboard')))
        window.setTimeout(() => setField(null), 0)
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('focusin', onFocus); document.removeEventListener('pointerdown', onPointer) }
  }, [])

  if (!field || !field.isConnected) return null
  const host = field.closest('dialog[open]') || document.body

  function press(key: string) {
    if (!field?.isConnected) { setField(null); return }
    if (key === 'Close') { setField(null); field.blur(); return }
    if (key === 'Shift') { setShift(value => !value); return }
    if (key === 'Backspace') { changeField(field, '', true); return }
    if (key === 'Enter') {
      if (field instanceof HTMLTextAreaElement) changeField(field, '\n')
      else { field.form?.requestSubmit(); setField(null); field.blur() }
      return
    }
    changeField(field, key === 'Space' ? ' ' : shift ? key.toUpperCase() : key)
    if (shift) setShift(false)
  }

  return createPortal(<div className="touch-keyboard" role="group" aria-label="On-screen keyboard"
    onPointerDown={event => event.preventDefault()}>
    <div className="touch-keyboard-top"><span>Keyboard</span><button type="button" onClick={() => press('Close')} aria-label="Close keyboard">Done</button></div>
    <div className="touch-keyboard-row">{'1234567890'.split('').map(key => <button type="button" key={key} onClick={() => press(key)}>{key}</button>)}</div>
    {rows.map((row, index) => <div className="touch-keyboard-row" key={row}>
      {index === 2 && <button type="button" className="touch-keyboard-wide" aria-pressed={shift} onClick={() => press('Shift')}>Shift</button>}
      {row.split('').map(key => <button type="button" key={key} onClick={() => press(key)}>{shift ? key.toUpperCase() : key}</button>)}
      {index === 2 && <button type="button" className="touch-keyboard-wide" aria-label="Backspace" onClick={() => press('Backspace')}>⌫</button>}
    </div>)}
    <div className="touch-keyboard-row"><button type="button" onClick={() => press(',')}>,</button><button type="button" onClick={() => press('.')}>.</button>
      <button type="button" className="touch-keyboard-space" onClick={() => press('Space')}>Space</button>
      <button type="button" onClick={() => press('-')}>-</button><button type="button" onClick={() => press("'")}>'</button>
      <button type="button" className="touch-keyboard-wide" onClick={() => press('Enter')}>Enter</button></div>
  </div>, host)
}
