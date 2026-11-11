import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Music2, Play, Plus, Trash2, ListStart, Star, GripVertical, Radio as RadioIcon } from 'lucide-react'

// Favoriten: TrackRow zeigt den Stern automatisch, sobald dieser Kontext vorhanden ist
export const FavoritesContext = createContext(null)
export const useFavorites = () => useContext(FavoritesContext)
export const trackKey = t => `${t.source}|${t.ref || t.url || t.title}`

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

// Farbiger Platzhalter, solange ein Titel kein Cover hat
function hue(text = '') {
  let h = 0
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function Cover({ track, size = 48, className = '' }) {
  const style = { width: size, height: size }
  const [broken, setBroken] = useState(null)   // Bild lässt sich nicht laden (z. B. Senderlogo)
  if (track?.image && broken !== track.image) {
    return <img className={`cover ${track.source === 'radio' ? 'cover-logo' : ''} ${className}`} style={style}
      src={track.image} alt="" onError={() => setBroken(track.image)} />
  }
  if (track?.source === 'radio') {
    const h = hue(track?.title)
    return (
      <div className={`cover cover-empty ${className}`}
        style={{ ...style, background: `linear-gradient(135deg, hsl(${h} 45% 32%), hsl(${(h + 50) % 360} 40% 14%))` }}>
        <RadioIcon size={Math.round(size * 0.4)} />
      </div>
    )
  }
  const h = hue(`${track?.artist}${track?.title}`)
  return (
    <div className={`cover cover-empty ${className}`}
      style={{ ...style, background: `linear-gradient(135deg, hsl(${h} 45% 32%), hsl(${(h + 50) % 360} 40% 14%))` }}>
      <Music2 size={Math.round(size * 0.38)} />
    </div>
  )
}

const SOURCES = { local: 'Lokal', spotify: 'Spotify', youtube: 'YouTube', radio: 'Radio' }

export function SourceBadge({ source }) {
  return <span className={`badge badge-${source}`}>{SOURCES[source] || source}</span>
}

export function TrackRow({ track, index, onPlay, onAdd, onNext, onRemove, handle, style, className = '', noFavorite }) {
  const fav = useFavorites()
  const isFav = fav?.keys.has(trackKey(track))
  return (
    <div className={`row ${className}`} style={style}>
      {handle}
      {index !== undefined && <span className="row-index">{index}</span>}
      <button className="row-cover" onClick={onPlay} title="Jetzt abspielen">
        <Cover track={track} size={44} />
        <span className="row-play"><Play size={18} fill="currentColor" /></span>
      </button>
      <div className="row-info">
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>
      <SourceBadge source={track.source} />
      <span className="row-time">{track.duration ? formatTime(track.duration) : ''}</span>
      {fav && !noFavorite && (
        <button className={`icon-btn fav ${isFav ? 'on' : ''}`} onClick={e => fav.pick(track, e.currentTarget)}
          title="Zu Favoriten hinzufügen">
          <Star size={19} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      )}
      {onNext && (
        <button className="icon-btn" onClick={onNext} title="Als Nächstes spielen">
          <ListStart size={19} />
        </button>
      )}
      {onAdd && (
        <button className="icon-btn accent" onClick={onAdd} title="Zur Warteschlange hinzufügen">
          <Plus size={20} />
        </button>
      )}
      {onRemove && (
        <button className="icon-btn danger" onClick={onRemove} title="Entfernen">
          <Trash2 size={18} />
        </button>
      )}
    </div>
  )
}

// Liste zum Umsortieren per Ziehen (Maus und Touch) am Griff links.
// children(item, index, { handle, style, className }) zeichnet eine Zeile.
export function SortableList({ items, onMove, children }) {
  const [local, setLocal] = useState(null)   // neue Reihenfolge, bis der Server sie bestätigt
  const [drag, setDrag] = useState(null)
  const listRef = useRef(null)
  useEffect(() => setLocal(null), [items])
  const shown = local || items

  function startDrag(event, index) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rects = [...listRef.current.children].map(el => el.getBoundingClientRect())
    const step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height
    setDrag({ from: index, to: index, startY: event.clientY, dy: 0, rects, step })
  }

  function moveDrag(event) {
    if (!drag) return
    const dy = event.clientY - drag.startY
    const rect = drag.rects[drag.from]
    const center = rect.top + rect.height / 2 + dy
    let to = 0
    drag.rects.forEach((r, i) => { if (i !== drag.from && r.top + r.height / 2 < center) to++ })
    setDrag({ ...drag, dy, to })
  }

  function endDrag() {
    if (!drag) return
    const { from, to } = drag
    setDrag(null)
    if (from === to) return
    const reordered = [...shown]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setLocal(reordered)
    onMove(moved, to)
  }

  function rowStyle(i) {
    if (!drag) return undefined
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 5 }
    let shift = 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.step
    if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = drag.step
    return { transform: `translateY(${shift}px)`, transition: 'transform .15s ease' }
  }

  return (
    <div className="sortable" ref={listRef}>
      {shown.map((item, i) => children(item, i, {
        className: drag?.from === i ? 'dragging' : '',
        style: rowStyle(i),
        handle: (
          <span className="drag-handle" title="Ziehen zum Verschieben"
            onPointerDown={e => startDrag(e, i)} onPointerMove={moveDrag}
            onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
            <GripVertical size={18} />
          </span>
        ),
      }))}
    </div>
  )
}
