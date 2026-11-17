/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import { RotateCw, Minimize, Power, PowerOff, RefreshCcw, Settings2, X, Palette, ChevronRight, ArrowLeft, AppWindow, Maximize } from 'lucide-react'
import { API, getJson, applySkin } from './jukebox'
import { SkinPicker, SKINS } from './Skins'
import { COPYRIGHT } from './Brand'

// Verstecktes Wartungsmenü (nur am Jukebox-Gerät): Logo oben links 2 Sekunden gedrückt halten,
// mit der Maus auch Rechtsklick aufs Logo, mit der Tastatur F2

export function useLongPress(onLongPress, ms = 2000) {
  const timer = useRef(null)
  const pointerType = useRef('touch')
  const [pressing, setPressing] = useState(false)
  function cancel() {
    clearTimeout(timer.current)
    setPressing(false)
  }
  return {
    pressing,
    handlers: {
      onPointerDown: event => {
        pointerType.current = event.pointerType
        if (event.button === 2) return
        setPressing(true)
        timer.current = setTimeout(() => { setPressing(false); onLongPress() }, ms)
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // Rechtsklick öffnet sofort (bei Touch löst langes Drücken ebenfalls contextmenu aus – dort zählen die 2 Sekunden)
      onContextMenu: e => {
        e.preventDefault()
        if (pointerType.current === 'mouse') { cancel(); onLongPress() }
      },
    },
  }
}

const ITEMS = [
  { key: 'reload', icon: RefreshCcw, label: 'Oberfläche neu laden', hint: 'Lädt die Seite neu, die Musik läuft weiter.' },
  { key: 'setup', icon: Settings2, label: 'Einrichtung erneut starten', hint: 'Name, Spotify, YouTube, Lautsprecher ändern.' },
  { key: 'window', icon: AppWindow, label: 'Im Fenster anzeigen', hint: 'Für PC und Laptop mit Maus. Die Oberfläche startet kurz neu.' },
  { key: 'fullscreen', icon: Maximize, label: 'Im Vollbild anzeigen', hint: 'Wie ein Jukebox-Bildschirm. Die Oberfläche startet kurz neu.' },
  { key: 'exit-kiosk', icon: Minimize, label: 'Vollbild beenden', hint: 'Zum Ubuntu-Desktop. Der Server läuft weiter.' },
  { key: 'stop', icon: PowerOff, label: 'Jukebox komplett beenden', hint: 'Schliesst Vollbild und Server.' },
  { key: 'reboot', icon: RotateCw, label: 'Gerät neu starten', hint: 'Danach startet die Jukebox automatisch.' },
  { key: 'poweroff', icon: Power, label: 'Gerät ausschalten', hint: 'Zum Einschalten den Power-Knopf drücken.' },
]

const DONE = {
  window: 'Wechselt ins Fenster …',
  fullscreen: 'Wechselt ins Vollbild …',
  'exit-kiosk': 'Vollbild wird beendet …',
  stop: 'Jukebox wird beendet …',
  reboot: 'Gerät startet neu …',
  poweroff: 'Gerät wird ausgeschaltet …',
}

export function AdminMenu({ onClose }) {
  const [armed, setArmed] = useState(null)   // erster Tipp = scharf machen, zweiter = ausführen
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [maintenance, setMaintenance] = useState(null)
  const [skin, setSkin] = useState(document.documentElement.dataset.skin || 'standard')
  const [page, setPage] = useState('main')     // 'main' = Liste, 'skins' = Aussehen wählen
  const [windowMode, setWindowMode] = useState(null)
  useEffect(() => { getJson('/api/info').then(info => info && setWindowMode(!!info.window)) }, [])
  const items = ITEMS
    .filter(item => item.key !== (windowMode ? 'window' : 'fullscreen') && !(windowMode === null && ['window', 'fullscreen'].includes(item.key)))
    .map(item => item.key === 'exit-kiosk' && windowMode
      ? { ...item, label: 'Oberfläche schliessen', hint: 'Schliesst das Fenster. Der Server läuft weiter.' }
      : item)
  const skinName = SKINS.find(s => s.key === skin)?.name || 'JUKEBÜX'
  useEffect(() => { getJson('/api/system/maintenance').then(setMaintenance) }, [])

  async function pickSkin(key) {
    setSkin(key); applySkin(key)
    try {
      const response = await fetch(`${API}/api/skin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: key }) })
      if (!response.ok) throw new Error((await response.json()).detail)
    } catch (e) {
      setError(e.message || 'Skin konnte nicht gespeichert werden')
    }
  }

  async function run(key) {
    if (armed !== key) { setArmed(key); return }
    if (key === 'reload') { window.location.reload(); return }
    if (key === 'setup') {
      await fetch(`${API}/api/setup/reopen`, { method: 'POST' })
      window.location.href = '/'
      return
    }
    try {
      const display = ['window', 'fullscreen'].includes(key)
      const response = await fetch(`${API}/api/system/${display ? 'window' : key}`, display
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ window: key === 'window' }) }
        : { method: 'POST' })
      if (!response.ok) throw new Error((await response.json()).detail)
      setDone(DONE[key])
    } catch (e) {
      setError(e.message || 'Aktion fehlgeschlagen')
      setArmed(null)
    }
  }

  if (done) {
    return <div className="dialog-backdrop admin-done"><div><Power size={48} /><h2>{done}</h2></div></div>
  }

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog admin">
        <div className="admin-head">
          {page === 'skins'
            ? <button className="admin-back" onClick={() => setPage('main')}><ArrowLeft size={20} /> <h2>Aussehen</h2></button>
            : <h2>Wartung</h2>}
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        {page === 'skins' ? (
          <>
            <p className="muted">Gilt sofort für den Jukebox-Bildschirm und alle Fernbedienungen.</p>
            <SkinPicker value={skin} onPick={pickSkin} />
            {error && <p className="muted error">{error}</p>}
          </>
        ) : (<>
        <button className="admin-item" onClick={() => { setArmed(null); setPage('skins') }}>
          <Palette size={22} />
          <div>
            <strong>Aussehen</strong>
            <span>Skin: {skinName}</span>
          </div>
          <ChevronRight size={20} className="admin-chevron" />
        </button>
        <h3 className="admin-sub">System <span>Zum Ausführen zweimal tippen.</span></h3>
        {items.map(({ key, icon: Icon, label, hint }) => (
          <button key={key} className={`admin-item ${armed === key ? 'armed' : ''} ${['stop', 'reboot', 'poweroff'].includes(key) ? 'risky' : ''}`}
            onClick={() => run(key)}>
            <Icon size={22} />
            <div>
              <strong>{armed === key ? `${label}? Nochmals tippen` : label}</strong>
              <span>{hint}</span>
            </div>
          </button>
        ))}
        {error && <p className="muted error">{error}</p>}
        <p className="muted small admin-maintenance">
          {maintenance?.time
            ? <>Letzte Wartung{maintenance.auto ? ' (automatisch)' : ''}: {new Date(maintenance.time).toLocaleString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} – <span className={maintenance.ok ? '' : 'error'}>{maintenance.text}</span></>
            : 'Noch keine Wartung durchgeführt. Automatisch jeden Sonntag um 4 Uhr.'}
        </p>
        <p className="muted small admin-copyright">{COPYRIGHT} · PolyForm Strict License 1.0.0</p>
        </>)}
      </div>
    </div>
  )
}
