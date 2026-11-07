import { useRef, useState } from 'react'
import { Delete, CornerDownLeft, ChevronDown, ArrowBigUp, X } from 'lucide-react'

// Eigene Bildschirmtastatur für das Surface (Schweizer QWERTZ-Anordnung)
const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
  ['y', 'x', 'c', 'v', 'b', 'n', 'm', '-', "'", '&', 'é'],
]
// Zusätzliche Zeile für Schlüssel und Adressen (Einrichtung)
const EXTRA = ['_', '.', ':', '/', '@', '+', '!', '?', '#', '=']

export default function Keyboard({ value, onChange, onEnter, onClose, enterLabel = 'Suchen', full = false }) {
  const [caps, setCaps] = useState(false)
  const rows = full ? [...ROWS, EXTRA] : ROWS
  const repeat = useRef(null)
  const valueRef = useRef(value)
  valueRef.current = value

  // Tastendruck auslösen, ohne dem Suchfeld den Fokus zu nehmen
  function press(event, action) {
    event.preventDefault()
    action()
  }

  function type(char) {
    onChange(valueRef.current + (caps ? char.toUpperCase() : char))
  }

  function backspace() {
    onChange(valueRef.current.slice(0, -1))
  }

  // Löschen gedrückt halten = wiederholt löschen
  function startBackspace(event) {
    event.preventDefault()
    backspace()
    clearInterval(repeat.current)
    const started = Date.now()
    repeat.current = setInterval(() => {
      if (Date.now() - started > 400) backspace()
    }, 70)
  }

  function stopBackspace() {
    clearInterval(repeat.current)
  }

  return (
    <div className="keyboard" onPointerDown={e => e.preventDefault()}>
      {rows.map((row, i) => (
        <div className="kb-row" key={i}>
          {row.map(key => (
            <button key={key} className="kb-key" onPointerDown={e => press(e, () => type(key))}>
              {caps ? key.toUpperCase() : key}
            </button>
          ))}
          {i === 0 && (
            <button className="kb-key kb-wide" aria-label="Löschen"
              onPointerDown={startBackspace} onPointerUp={stopBackspace}
              onPointerLeave={stopBackspace} onPointerCancel={stopBackspace}>
              <Delete size={24} />
            </button>
          )}
        </div>
      ))}
      <div className="kb-row">
        {full && (
          <button className={`kb-key kb-wide ${caps ? 'kb-on' : ''}`} aria-label="Grossbuchstaben"
            onPointerDown={e => press(e, () => setCaps(c => !c))}>
            <ArrowBigUp size={24} /> {caps ? 'ABC' : 'abc'}
          </button>
        )}
        <button className="kb-key kb-wide" onPointerDown={e => press(e, () => onChange(''))}>
          <X size={20} /> Leeren
        </button>
        <button className="kb-key kb-space" onPointerDown={e => press(e, () => type(' '))}>
          Leerschlag
        </button>
        <button className="kb-key kb-wide kb-enter" onPointerDown={e => press(e, onEnter)}>
          <CornerDownLeft size={20} /> {enterLabel}
        </button>
        <button className="kb-key kb-wide" aria-label="Tastatur schliessen" onPointerDown={e => press(e, onClose)}>
          <ChevronDown size={26} />
        </button>
      </div>
    </div>
  )
}
