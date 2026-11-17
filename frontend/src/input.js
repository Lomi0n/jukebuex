/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useSyncExternalStore } from 'react'

// Wie wird die Jukebox gerade bedient? 'touch', 'mouse' oder 'key' (echte Tastatur).
// Danach richtet sich z. B., ob die Bildschirmtastatur erscheint. Am <html> stehen
// data-input (letzte Eingabe) und data-pointer (touch/mouse) für die Styles.

const listeners = new Set()
let mode = window.matchMedia('(any-pointer: coarse)').matches ? 'touch' : 'mouse'
let pointer = mode

function apply(next, nextPointer = pointer) {
  if (next === mode && nextPointer === pointer) return
  mode = next
  pointer = nextPointer
  document.documentElement.dataset.input = mode
  document.documentElement.dataset.pointer = pointer
  listeners.forEach(fn => fn())
}

document.documentElement.dataset.input = mode
document.documentElement.dataset.pointer = pointer

document.addEventListener('pointerdown', event => {
  const kind = event.pointerType === 'mouse' ? 'mouse' : 'touch'
  apply(kind, kind)
}, true)

// Nur echte Tasten zählen (die Bildschirmtastatur arbeitet mit Pointer-Ereignissen)
document.addEventListener('keydown', event => {
  if (event.isTrusted && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) apply('key')
}, true)

export function useInputMode() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => mode)
}

// Bildschirmtastatur nur, wenn zuletzt per Touch bedient wurde
export function useTouchInput() {
  return useInputMode() === 'touch'
}

// Ist gerade ein Textfeld aktiv? Dann gehören Tasten dem Feld, nicht den Kürzeln.
export function typingInField(target = document.activeElement) {
  if (!target) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true
  return tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes(target.type)
}

// Mausrad über einem Regler ändert seinen Wert (z. B. Lautstärke)
export function useWheelValue(ref, value, onChange, { min = 0, max = 100, step = 5 } = {}) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    function wheel(event) {
      event.preventDefault()
      const delta = event.deltaY < 0 ? step : -step
      onChange(Math.max(min, Math.min(max, Math.round((value + delta) / step) * step)))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [ref, value, onChange, min, max, step])
}
