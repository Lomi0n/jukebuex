/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useState } from 'react'
import { getJson, branding } from './jukebox'

// ---------- JUKEBÜX-Logo: Schallplatte mit Tonarm, "Ü" auf dem Etikett ----------

export function Logo({ size = 44, spinning = false }) {
  return (
    <svg className={`logo-svg ${spinning ? 'spinning-record' : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="0" y="0" width="64" height="64" rx="16" fill="var(--accent)" />
      <g className="record">
        <circle cx="30" cy="34" r="22" fill="#141414" />
        <circle cx="30" cy="34" r="18.5" fill="none" stroke="#2c2c2c" strokeWidth="1" />
        <circle cx="30" cy="34" r="15" fill="none" stroke="#2c2c2c" strokeWidth="1" />
        <circle cx="30" cy="34" r="11.5" fill="none" stroke="#2c2c2c" strokeWidth="1" />
        <path d="M14 26 A18 18 0 0 1 22 18" fill="none" stroke="#ffffff30" strokeWidth="2" strokeLinecap="round" />
        <path d="M46 42 A18 18 0 0 1 38 50" fill="none" stroke="#ffffff1c" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* Etikett mit "Ü" dreht sich nicht mit, damit es lesbar bleibt */}
      <circle cx="30" cy="34" r="8.5" fill="var(--accent)" />
      <text x="30" y="38.4" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#141414"
        fontFamily="'Space Grotesk', 'DM Sans', sans-serif">Ü</text>
      {/* Tonarm */}
      <circle cx="53" cy="12" r="4" fill="#141414" />
      <path d="M53 12 L50 33 L44 39" fill="none" stroke="#141414" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="40.5" y="37" width="6" height="4.5" rx="1" transform="rotate(40 43.5 39.25)" fill="#141414" />
    </svg>
  )
}

// ---------- Animierter Equalizer neben dem laufenden Titel ----------

export function Equalizer({ playing = true, size = 14 }) {
  return (
    <span className={`eq ${playing ? 'on' : ''}`} style={{ height: size }} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  )
}

// ---------- Startbildschirm beim Hochfahren (nur Surface) ----------

// Urheber-Vermerk: fest eingebaut, unabhängig vom einstellbaren Namen der Jukebox
export const COPYRIGHT = 'JUKEBÜX © 2026 Lomi0n'

export function Splash({ connected }) {
  const [phase, setPhase] = useState('show')   // show -> fade -> gone
  const [minTimeOver, setMinTimeOver] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMinTimeOver(true), 2200); return () => clearTimeout(t) }, [])
  // Spätestens nach 9 Sekunden verschwinden, auch ohne Verbindung
  useEffect(() => { const t = setTimeout(() => setPhase(p => (p === 'show' ? 'fade' : p)), 9000); return () => clearTimeout(t) }, [])
  useEffect(() => {
    if (minTimeOver && connected && phase === 'show') setPhase('fade')
  }, [minTimeOver, connected, phase])
  useEffect(() => {
    if (phase !== 'fade') return
    const t = setTimeout(() => setPhase('gone'), 700)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'gone') return null
  return (
    <div className={`splash ${phase === 'fade' ? 'fade' : ''}`}>
      <Logo size={150} spinning />
      <h1>{branding.name}</h1>
      {branding.subtitle && <p>{branding.subtitle}</p>}
      <span className="splash-status">{connected ? 'Bereit' : 'Starte …'}</span>
      <span className="splash-copyright">{COPYRIGHT}</span>
    </div>
  )
}

// ---------- Farbe vom aktuellen Cover ----------

function hueColor(track) {
  let h = 0
  for (const c of `${track.artist}${track.title}`) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 45% 40%)`
}

export function useCoverColor(track) {
  const [color, setColor] = useState(null)
  const image = track?.image
  const fallback = track ? hueColor(track) : null
  useEffect(() => {
    if (!track) { setColor(null); return }
    if (!image || !image.startsWith('https://')) { setColor(fallback); return }
    let cancelled = false
    getJson(`/api/color?url=${encodeURIComponent(image)}`).then(result => {
      if (!cancelled) setColor(result?.color || fallback)
    })
    return () => { cancelled = true }
  }, [image, fallback])
  return color
}
