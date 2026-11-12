/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2, X, LoaderCircle } from 'lucide-react'
import { API } from './jukebox'

// Versteckte Funktion an der Fernbedienung: eigenes Hintergrundbild für die Jukebox.
// Öffnen: 5× schnell auf den Urheber-Vermerk unten links tippen.

export function useSecretTaps(onUnlock, taps = 5, windowMs = 2500) {
  const hits = useRef([])
  return () => {
    const now = Date.now()
    hits.current = [...hits.current.filter(t => now - t < windowMs), now]
    if (hits.current.length >= taps) {
      hits.current = []
      onUnlock()
    }
  }
}

async function send(method, path, body, json = true) {
  try {
    const response = await fetch(`${API}${path}`, {
      method, body: json && body !== undefined ? JSON.stringify(body) : body,
      headers: json && body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) return { error: (typeof data?.detail === 'string' && data.detail) || `Fehler ${response.status}` }
    return data
  } catch {
    return { error: 'Server nicht erreichbar.' }
  }
}

export function BackgroundDialog({ background, onClose, notify }) {
  const [dim, setDim] = useState(background.dim ?? 55)
  const [blur, setBlur] = useState(background.blur ?? 0)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)
  const saveTimer = useRef(null)
  const light = ['swiss', 'kritzel'].includes(document.documentElement.dataset.skin)

  // Regler: kurz nach dem Loslassen speichern, die Jukebox übernimmt es sofort
  useEffect(() => {
    if (dim === background.dim && blur === background.blur) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const result = await send('PATCH', '/api/background', { dim, blur })
      if (result.error) notify(result.error, 'warn')
    }, 250)
    return () => clearTimeout(saveTimer.current)
  }, [dim, blur])

  async function upload(file) {
    if (!file) return
    setBusy(true)
    const result = await send('PUT', `/api/background?filename=${encodeURIComponent(file.name)}`, file, false)
    setBusy(false)
    if (result.error) notify(result.error, 'warn')
    else notify('Hintergrund gesetzt')
  }

  async function remove() {
    const result = await send('DELETE', '/api/background')
    if (result.error) notify(result.error, 'warn')
    else notify('Hintergrund entfernt')
  }

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog bg-dialog">
        <div className="admin-head">
          <h2>Eigener Hintergrund</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <p className="muted">Erscheint auf der Jukebox hinter der Oberfläche, auf dem Startbildschirm und dem Bildschirmschoner.
          Das Bild bleibt auf diesem Gerät.</p>

        <div className="bg-preview" style={background.url ? { backgroundImage: `url("${API}${background.url}")` } : undefined}>
          {background.url
            ? <div className="bg-preview-shade" style={{ opacity: dim / 100, backdropFilter: blur ? `blur(${Math.round(blur / 3)}px)` : undefined }} />
            : <span>Kein Hintergrund gesetzt</span>}
          {busy && <div className="bg-preview-busy"><LoaderCircle className="spin" size={28} /></div>}
        </div>

        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
        <div className="bg-actions">
          <button className="btn-primary" disabled={busy} onClick={() => fileInput.current.click()}>
            <ImagePlus size={19} /> {background.url ? 'Anderes Bild' : 'Bild auswählen'}
          </button>
          {background.url && (
            <button className="btn-secondary danger" onClick={remove}><Trash2 size={17} /> Entfernen</button>
          )}
        </div>

        {background.url && (
          <div className="bg-sliders">
            <label>
              <span>{light ? 'Aufhellen' : 'Abdunkeln'} <b>{dim} %</b></span>
              <input type="range" min="0" max="90" value={dim} onChange={e => setDim(Number(e.target.value))} />
            </label>
            <label>
              <span>Weichzeichnen <b>{blur}</b></span>
              <input type="range" min="0" max="30" value={blur} onChange={e => setBlur(Number(e.target.value))} />
            </label>
          </div>
        )}
        <p className="muted small">JPG, PNG oder WebP, höchstens 15 MB. Grosse Bilder werden automatisch verkleinert.</p>
      </div>
    </div>
  )
}
