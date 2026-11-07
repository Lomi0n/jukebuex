import { useEffect, useRef, useState } from 'react'
import { RotateCw, Minimize, Power, PowerOff, RefreshCcw, Settings2, X } from 'lucide-react'
import { API, getJson } from './jukebox'

// Verstecktes Wartungsmenü (nur am Jukebox-Gerät): Logo oben links 2 Sekunden gedrückt halten

export function useLongPress(onLongPress, ms = 2000) {
  const timer = useRef(null)
  const [pressing, setPressing] = useState(false)
  function cancel() {
    clearTimeout(timer.current)
    setPressing(false)
  }
  return {
    pressing,
    handlers: {
      onPointerDown: () => {
        setPressing(true)
        timer.current = setTimeout(() => { setPressing(false); onLongPress() }, ms)
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: e => e.preventDefault(),
    },
  }
}

const ITEMS = [
  { key: 'reload', icon: RefreshCcw, label: 'Oberfläche neu laden', hint: 'Lädt die Seite neu, die Musik läuft weiter.' },
  { key: 'setup', icon: Settings2, label: 'Einrichtung erneut starten', hint: 'Name, Spotify, YouTube, Lautsprecher ändern.' },
  { key: 'exit-kiosk', icon: Minimize, label: 'Vollbild beenden', hint: 'Zum Ubuntu-Desktop. Der Server läuft weiter.' },
  { key: 'stop', icon: PowerOff, label: 'Jukebox komplett beenden', hint: 'Schliesst Vollbild und Server.' },
  { key: 'reboot', icon: RotateCw, label: 'Gerät neu starten', hint: 'Danach startet die Jukebox automatisch.' },
  { key: 'poweroff', icon: Power, label: 'Gerät ausschalten', hint: 'Zum Einschalten den Power-Knopf drücken.' },
]

const DONE = {
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
  useEffect(() => { getJson('/api/system/maintenance').then(setMaintenance) }, [])

  async function run(key) {
    if (armed !== key) { setArmed(key); return }
    if (key === 'reload') { window.location.reload(); return }
    if (key === 'setup') {
      await fetch(`${API}/api/setup/reopen`, { method: 'POST' })
      window.location.href = '/'
      return
    }
    try {
      const response = await fetch(`${API}/api/system/${key}`, { method: 'POST' })
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
          <h2>Wartung</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <p className="muted">Zum Ausführen zweimal tippen.</p>
        {ITEMS.map(({ key, icon: Icon, label, hint }) => (
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
      </div>
    </div>
  )
}
