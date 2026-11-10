import { useEffect, useRef, useState } from 'react'
import {
  Check, Copy, Bluetooth, Speaker, LoaderCircle, ChevronLeft, ChevronRight, Music2, KeyRound,
  MonitorPlay, FolderOpen, Sparkles, Laptop, LogIn, Radar, TriangleAlert, PartyPopper, Lock
} from 'lucide-react'
import { API } from './jukebox'
import { Logo } from './Brand'
import Keyboard from './Keyboard'
import './Setup.css'

// ---------- Einrichtungsassistent ----------
// Am Jukebox-Bildschirm (onDevice) beim ersten Start – oder am PC unter /setup mit Code.

const STEPS = [
  { title: 'Willkommen', icon: Sparkles },
  { title: 'Spotify-App', icon: KeyRound },
  { title: 'Spotify-Anmeldung', icon: LogIn },
  { title: 'YouTube', icon: MonitorPlay },
  { title: 'Lautsprecher', icon: Speaker },
  { title: 'Musik & Fertig', icon: FolderOpen },
]

const TOKEN_KEY = 'jukebux-setup-token'

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

function writeToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token) } catch { /* privates Fenster */ }
}

async function call(method, path, body) {
  try {
    const headers = { 'X-Setup-Token': readToken() }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = Array.isArray(data?.detail) ? 'Ungültige Eingabe.' : data?.detail
      return { error: detail || `Fehler ${response.status}`, status: response.status }
    }
    return { data }
  } catch {
    return { error: 'Jukebox-Server nicht erreichbar.' }
  }
}

export default function SetupWizard({ onDevice }) {
  const [status, setStatus] = useState(null)
  const [code, setCode] = useState(null)
  const [finished, setFinished] = useState(false)
  const [spotifyResult] = useState(() => new URLSearchParams(window.location.search).get('spotify'))

  async function refresh() {
    const result = await call('GET', '/api/setup')
    if (result.data) setStatus(result.data)
    return result.data
  }

  useEffect(() => {
    if (spotifyResult) window.history.replaceState(null, '', window.location.pathname)
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!onDevice || !status?.open) return
    fetch(`${API}/api/setup/code`).then(r => r.json()).then(d => setCode(d.code)).catch(() => {})
  }, [onDevice, status?.open])

  // Am PC abgeschlossen -> Jukebox-Bildschirm startet die Jukebox
  useEffect(() => {
    if (onDevice && status && !status.open) window.location.replace('/')
  }, [onDevice, status?.open])

  if (!status) return <div className="setup-boot"><LoaderCircle className="spin" size={36} /></div>
  if (finished || !status.open) return <SetupDone status={status} onDevice={onDevice} />
  if (!status.authorized) return <CodeGate onUnlocked={refresh} />

  async function go(step) {
    setStatus(s => ({ ...s, step }))
    await call('POST', '/api/setup/step', { step })
  }

  async function finish() {
    const result = await call('POST', '/api/setup/finish')
    if (result.error) return result.error
    if (onDevice) window.location.replace('/')
    else setFinished(true)
  }

  const step = status.step
  const done = [
    step > 0,
    status.spotify.configured,
    status.spotify.connected,
    status.youtube.configured,
    Boolean(status.bluetooth.mac),
    false,
  ]
  const props = { status, onDevice, go, refresh }

  return (
    <div className={`setup ${onDevice ? 'on-device' : 'on-pc'}`}>
      <aside className="setup-rail">
        <div className="setup-brand">
          <Logo size={52} />
          <div>
            <strong>{status.name}</strong>
            <span>Einrichtung</span>
          </div>
        </div>
        <ol className="setup-steps">
          {STEPS.map(({ title, icon: Icon }, i) => (
            <li key={title} className={`${i === step ? 'current' : ''} ${done[i] && i !== step ? 'done' : ''}`}>
              <button onClick={() => go(i)}>
                <span className="setup-step-icon">{done[i] && i !== step ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}</span>
                {title}
              </button>
            </li>
          ))}
        </ol>
        {onDevice ? (
          <div className="setup-pc-hint">
            <Laptop size={20} />
            <div>
              <b>Bequemer am PC</b>
              <span>Im Browser öffnen:</span>
              <code>{status.setup_url.replace(/^http:\/\//, '')}</code>
              <span>Code eingeben:</span>
              <div className="setup-code">{code ? `${code.slice(0, 3)} ${code.slice(3)}` : '…'}</div>
            </div>
          </div>
        ) : (
          <div className="setup-pc-hint subtle">
            <Laptop size={18} />
            <div><span>Einrichtung per PC – der Jukebox-Bildschirm zeigt dieselben Schritte.</span></div>
          </div>
        )}
        <span className="setup-version">Version {status.version}</span>
      </aside>

      <main className="setup-main">
        <div className="setup-card" key={step}>
          <div className="setup-eyebrow">Schritt {step + 1} von {STEPS.length}</div>
          {step === 0 && <StepWelcome {...props} />}
          {step === 1 && <StepSpotifyApp {...props} />}
          {step === 2 && <StepSpotifyLogin {...props} spotifyResult={spotifyResult} />}
          {step === 3 && <StepYouTube {...props} />}
          {step === 4 && <StepSpeaker {...props} />}
          {step === 5 && <StepFinish {...props} finish={finish} />}
        </div>
      </main>
    </div>
  )
}

// ---------- Bausteine ----------

function Nav({ back, next, nextLabel = 'Weiter', skip, busy, nextDisabled }) {
  return (
    <div className="setup-nav">
      {back && <button className="setup-btn ghost" onClick={back}><ChevronLeft size={18} /> Zurück</button>}
      <span className="flex" />
      {skip && <button className="setup-btn ghost" onClick={skip}>Überspringen</button>}
      {next && (
        <button className="setup-btn primary" onClick={next} disabled={busy || nextDisabled}>
          {busy ? <LoaderCircle className="spin" size={18} /> : null} {nextLabel} {!busy && <ChevronRight size={18} />}
        </button>
      )}
    </div>
  )
}

// Eingabefeld: am Jukebox-Bildschirm mit eigener Tastatur, am PC normal
function Field({ label, value, onChange, onDevice, placeholder, secret, onEnter, mono, maxLength }) {
  const [keyboard, setKeyboard] = useState(false)
  const [show, setShow] = useState(false)
  const input = useRef(null)
  return (
    <label className={`setup-field ${mono ? 'mono' : ''}`}>
      <span>{label}</span>
      <div className="setup-input">
        <input ref={input} value={value} placeholder={placeholder} maxLength={maxLength}
          type={secret && !show && !onDevice ? 'password' : 'text'}
          inputMode={onDevice ? 'none' : undefined} autoComplete="off" spellCheck={false}
          onFocus={() => {
            if (!onDevice) return
            setKeyboard(true)
            // Feld über der Bildschirmtastatur sichtbar machen
            setTimeout(() => input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
          }}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onEnter?.()} />
        {secret && !onDevice && (
          <button type="button" className="setup-show" onClick={() => setShow(s => !s)}>{show ? 'Verbergen' : 'Anzeigen'}</button>
        )}
      </div>
      {keyboard && (
        <Keyboard full value={value} onChange={onChange} enterLabel="Fertig"
          onEnter={() => { setKeyboard(false); input.current?.blur() }}
          onClose={() => { setKeyboard(false); input.current?.blur() }} />
      )}
    </label>
  )
}

function CopyBox({ text, onDevice }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
      else {
        // http:// im Heimnetz: Zwischenablage-API gesperrt -> klassisch kopieren
        const range = document.createRange()
        range.selectNodeContents(ref.current)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.execCommand('copy')
        selection.removeAllRanges()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* dann eben von Hand markieren */ }
  }
  return (
    <div className="setup-copy">
      <code ref={ref}>{text}</code>
      {!onDevice && <button type="button" onClick={copy}>{copied ? <><Check size={15} /> Kopiert</> : <><Copy size={15} /> Kopieren</>}</button>}
    </div>
  )
}

function Link({ href, children, onDevice }) {
  if (onDevice) return <b>{children}</b>
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
}

function Message({ error, ok, warn }) {
  if (error) return <p className="setup-msg error"><TriangleAlert size={16} /> {error}</p>
  if (warn) return <p className="setup-msg warn"><TriangleAlert size={16} /> {warn}</p>
  if (ok) return <p className="setup-msg ok"><Check size={16} strokeWidth={3} /> {ok}</p>
  return null
}

// ---------- Schritte ----------

function StepWelcome({ status, onDevice, go }) {
  const [name, setName] = useState(status.name)
  const [subtitle, setSubtitle] = useState(status.subtitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    const result = await call('POST', '/api/setup/name', { name, subtitle })
    setBusy(false)
    if (result.error) setError(result.error)
    else go(1)
  }
  return (
    <>
      <h1>Willkommen bei der JUKEBÜX</h1>
      <p className="setup-lead">
        In wenigen Schritten ist deine Jukebox bereit: Spotify, YouTube, Lautsprecher und lokale Musik.
        Jeder Schritt lässt sich überspringen und später im Wartungsmenü ändern
        (Logo oben links 2&nbsp;Sekunden gedrückt halten).
      </p>
      <div className="setup-fields">
        <Field label="Name der Jukebox" value={name} onChange={setName} onDevice={onDevice} maxLength={30} onEnter={save} />
        <Field label="Untertitel (optional)" value={subtitle} onChange={setSubtitle} onDevice={onDevice}
          placeholder="z. B. Partykeller-Edition" maxLength={40} onEnter={save} />
      </div>
      <Message error={error} />
      <Nav next={save} busy={busy} nextDisabled={!name.trim()} />
    </>
  )
}

function StepSpotifyApp({ status, onDevice, go, refresh }) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  async function save() {
    setBusy(true); setError(null); setOk(null)
    const result = await call('POST', '/api/setup/spotify', { client_id: clientId, client_secret: secret })
    setBusy(false)
    if (result.error) { setError(result.error); return }
    setOk('Spotify hat die Angaben bestätigt.')
    setClientId(''); setSecret('')
    await refresh()
  }
  const configured = status.spotify.configured
  const dev = 'https://developer.spotify.com/dashboard'
  return (
    <>
      <h1>Spotify-App anlegen</h1>
      <p className="setup-lead">
        Damit die JUKEBÜX Spotify abspielen darf, braucht sie eine eigene, kostenlose «App» im
        Spotify-Entwicklerbereich. Voraussetzung ist ein <b>Spotify-Premium</b>-Konto.
        {onDevice && ' Diesen Schritt machst du am besten am PC.'}
      </p>
      <ol className="setup-howto">
        <li><Link href={dev} onDevice={onDevice}>developer.spotify.com/dashboard</Link> öffnen und mit deinem Spotify-Konto anmelden.</li>
        <li><b>Create app</b> wählen. Name z.&nbsp;B. «JUKEBÜX», Beschreibung beliebig.</li>
        <li>Bei <b>Redirect URIs</b> genau diese Adresse eintragen und auf <b>Add</b> tippen:
          <CopyBox text={status.spotify.redirect_uri} onDevice={onDevice} /></li>
        <li>Bei den APIs <b>Web API</b> und <b>Web Playback SDK</b> ankreuzen, Bedingungen akzeptieren, <b>Save</b>.</li>
        <li>In der App unter <b>Settings</b> die <b>Client ID</b> kopieren, danach bei <b>View client secret</b> das <b>Client secret</b>.</li>
        <li>Nutzt die Jukebox ein anderes Spotify-Konto als deines: dieses unter <b>User Management</b> eintragen.</li>
      </ol>
      {configured && !ok && <Message ok={`Bereits eingerichtet (Client ID ${status.spotify.client_id}). Zum Ändern einfach neu eingeben.`} />}
      <div className="setup-fields two">
        <Field label="Client ID" value={clientId} onChange={setClientId} onDevice={onDevice} mono maxLength={64}
          placeholder="32 Zeichen, z. B. 8f3a…" />
        <Field label="Client Secret" value={secret} onChange={setSecret} onDevice={onDevice} mono secret maxLength={64}
          placeholder="32 Zeichen" onEnter={save} />
      </div>
      <Message error={error} ok={ok} />
      <div className="setup-inline">
        <button className="setup-btn" onClick={save} disabled={busy || !clientId || !secret}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} Prüfen & speichern
        </button>
      </div>
      <Nav back={() => go(0)} skip={configured ? null : () => go(3)} next={configured ? () => go(2) : null} />
    </>
  )
}

function StepSpotifyLogin({ status, onDevice, go, spotifyResult }) {
  const { configured, connected, user } = status.spotify
  return (
    <>
      <h1>Bei Spotify anmelden</h1>
      {!configured ? (
        <p className="setup-lead">Spotify wurde übersprungen. Du kannst es später über das Wartungsmenü nachholen.</p>
      ) : connected ? (
        <>
          <p className="setup-lead">Die JUKEBÜX ist mit Spotify verbunden und erscheint dort als Gerät «{status.name}{status.subtitle ? ` – ${status.subtitle}` : ''}».</p>
          <Message ok={`Angemeldet als ${user || 'Spotify-Konto'}`} />
          {onDevice && (
            <button className="setup-btn" onClick={() => { window.location.href = `${API}/api/spotify/login` }}>
              <LogIn size={18} /> Anderes Konto verwenden
            </button>
          )}
        </>
      ) : onDevice ? (
        <>
          <p className="setup-lead">
            Melde dich mit dem Spotify-Konto an, über das die Jukebox spielen soll. Danach kommst du
            automatisch hierher zurück.
          </p>
          {spotifyResult === 'error' && (
            <Message error="Die Anmeldung hat nicht geklappt. Stimmt die Redirect URI in der Spotify-App genau? Ist das Konto unter «User Management» eingetragen?" />
          )}
          <button className="setup-btn spotify big" onClick={() => { window.location.href = `${API}/api/spotify/login` }}>
            <Music2 size={22} /> Mit Spotify anmelden
          </button>
        </>
      ) : (
        <>
          <p className="setup-lead">
            Die Anmeldung muss <b>direkt am Jukebox-Bildschirm</b> erfolgen, weil Spotify nur dorthin
            zurückleitet. Tippe dort auf <b>Mit Spotify anmelden</b>. Diese Seite zeigt automatisch an,
            sobald es geklappt hat.
          </p>
          <p className="setup-waiting"><LoaderCircle className="spin" size={18} /> Warte auf die Anmeldung am Jukebox-Bildschirm …</p>
        </>
      )}
      <Nav back={() => go(1)} skip={configured && !connected ? () => go(3) : null}
        next={!configured || connected ? () => go(3) : null} />
    </>
  )
}

function StepYouTube({ status, onDevice, go, refresh }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const [warn, setWarn] = useState(null)
  async function save() {
    setBusy(true); setError(null); setOk(null); setWarn(null)
    const result = await call('POST', '/api/setup/youtube', { key })
    setBusy(false)
    if (result.error) { setError(result.error); return }
    if (result.data.warning) setWarn(result.data.warning)
    else setOk('Google hat den Schlüssel bestätigt.')
    setKey('')
    await refresh()
  }
  const configured = status.youtube.configured
  const console_ = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'
  return (
    <>
      <h1>YouTube einrichten</h1>
      <p className="setup-lead">
        Für die YouTube-Suche braucht die JUKEBÜX einen kostenlosen API-Schlüssel von Google.
        Das Gratis-Kontingent reicht für rund 100 Suchen pro Tag.
      </p>
      <ol className="setup-howto">
        <li><Link href={console_} onDevice={onDevice}>console.cloud.google.com</Link> öffnen, anmelden und oben ein <b>neues Projekt</b> anlegen (z.&nbsp;B. «JUKEBUX»).</li>
        <li>Unter <b>APIs & Dienste → Bibliothek</b> nach <b>YouTube Data API v3</b> suchen und <b>Aktivieren</b>.</li>
        <li>Unter <b>APIs & Dienste → Anmeldedaten</b>: <b>Anmeldedaten erstellen → API-Schlüssel</b>.</li>
        <li>Empfohlen: Schlüssel bearbeiten, bei <b>API-Einschränkungen</b> nur «YouTube Data API v3» erlauben.</li>
        <li>Schlüssel kopieren (beginnt mit «AIza») und hier einfügen.</li>
      </ol>
      {configured && !ok && !warn && <Message ok={`Bereits eingerichtet (Schlüssel ${status.youtube.key}). Zum Ändern einfach neu eingeben.`} />}
      <div className="setup-fields">
        <Field label="YouTube-API-Schlüssel" value={key} onChange={setKey} onDevice={onDevice} mono secret
          placeholder="AIza…" maxLength={80} onEnter={save} />
      </div>
      <Message error={error} ok={ok} warn={warn} />
      <div className="setup-inline">
        <button className="setup-btn" onClick={save} disabled={busy || !key}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} Prüfen & speichern
        </button>
      </div>
      <Nav back={() => go(2)} skip={configured ? null : () => go(4)} next={configured ? () => go(4) : null} />
    </>
  )
}

function StepSpeaker({ status, go, refresh }) {
  const bt = status.bluetooth
  const task = bt.task
  const [error, setError] = useState(null)
  const scanning = task?.action === 'scan' && ['pending', 'running'].includes(task.state)
  const pairing = task?.action === 'pair' && ['pending', 'running'].includes(task.state)
  const devices = task?.devices || []

  async function scan() {
    setError(null)
    const result = await call('POST', '/api/setup/bluetooth/scan')
    if (result.error) setError(result.error)
    await refresh()
  }
  async function select(mac) {
    setError(null)
    const result = await call('POST', '/api/setup/bluetooth/select', { mac })
    if (result.error) setError(result.error)
    await refresh()
  }

  return (
    <>
      <h1>Lautsprecher verbinden</h1>
      <p className="setup-lead">
        Die JUKEBÜX spielt über eine Bluetooth-Stereoanlage oder -Box und hält die Verbindung
        automatisch aufrecht. Gerät einschalten, in den <b>Kopplungsmodus</b> versetzen und suchen.
      </p>
      {!bt.watcher && <Message warn="Der Bluetooth-Wächter läuft nicht. Ist Bluetooth eingeschaltet? (systemctl --user status jukebox-bluetooth)" />}
      {bt.mac && (
        <div className={`setup-speaker current ${bt.connected ? 'on' : ''}`}>
          <Bluetooth size={22} />
          <div>
            <b>{bt.name || bt.mac}</b>
            <span>{pairing ? 'Wird gekoppelt …' : bt.connected ? 'Verbunden' : 'Ausgewählt – noch nicht verbunden'}</span>
          </div>
          {pairing && <LoaderCircle className="spin" size={20} />}
        </div>
      )}
      {task?.action === 'pair' && task.state === 'done' && <Message ok={task.message} />}
      {task?.state === 'failed' && <Message error={task.message} />}
      <Message error={error} />

      <div className="setup-inline">
        <button className="setup-btn" onClick={scan} disabled={scanning || pairing || !bt.watcher}>
          {scanning ? <LoaderCircle className="spin" size={18} /> : <Radar size={18} />}
          {scanning ? ' Suche läuft … (ca. 15 Sekunden)' : devices.length ? ' Nochmals suchen' : ' Geräte suchen'}
        </button>
      </div>

      {devices.length > 0 && (
        <div className="setup-devices">
          {devices.map(device => (
            <button key={device.mac} className={`setup-speaker ${device.mac === bt.mac ? 'chosen' : ''}`}
              onClick={() => select(device.mac)} disabled={pairing || scanning}>
              {device.audio ? <Speaker size={22} /> : <Bluetooth size={22} />}
              <div>
                <b>{device.name}</b>
                <span>{device.mac}{device.audio ? ' · Audio' : ''}{device.paired ? ' · gekoppelt' : ''}</span>
              </div>
              <em>{device.mac === bt.mac ? 'Gewählt' : 'Auswählen'}</em>
            </button>
          ))}
        </div>
      )}
      {task?.action === 'scan' && task.state === 'done' && devices.length === 0 && (
        <Message warn="Keine Geräte gefunden. Ist das Gerät im Kopplungsmodus und in der Nähe?" />
      )}
      <p className="setup-note">
        Kein Bluetooth-Lautsprecher? Einfach überspringen – der Ton kommt dann aus dem eingestellten
        Ausgang des Geräts (Lautsprecher, Kopfhörer, HDMI).
      </p>
      <Nav back={() => go(3)} skip={bt.mac ? null : () => go(5)} next={bt.mac ? () => go(5) : null} />
    </>
  )
}

function StepFinish({ status, go, finish }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function run() {
    setBusy(true)
    const problem = await finish()
    if (problem) { setError(problem); setBusy(false) }
  }
  const rows = [
    ['Name', status.name + (status.subtitle ? ` – ${status.subtitle}` : ''), true],
    ['Spotify', status.spotify.connected ? `Verbunden (${status.spotify.user || 'Konto'})`
      : status.spotify.configured ? 'App eingerichtet, noch nicht angemeldet' : 'Übersprungen', status.spotify.connected],
    ['YouTube', status.youtube.configured ? 'Eingerichtet' : 'Übersprungen', status.youtube.configured],
    ['Lautsprecher', status.bluetooth.mac ? (status.bluetooth.name || status.bluetooth.mac) : 'Übersprungen', Boolean(status.bluetooth.mac)],
    ['Lokale Musik', `${status.music.tracks} Titel`, status.music.tracks > 0],
  ]
  return (
    <>
      <h1>Lokale Musik & los geht's</h1>
      <p className="setup-lead">
        Eigene MP3- und FLAC-Dateien kopierst du in diesen Ordner (Unterordner sind erlaubt).
        Dateinamen wie «Interpret - Titel.mp3» werden automatisch erkannt.
      </p>
      <CopyBox text={status.music.dir} onDevice />
      <div className="setup-summary">
        {rows.map(([label, value, good]) => (
          <div key={label} className={good ? 'good' : ''}>
            <span>{label}</span>
            <b>{good && <Check size={15} strokeWidth={3} />} {value}</b>
          </div>
        ))}
        <div className="good">
          <span>Fernbedienung</span>
          <b><Laptop size={15} /> {status.remote_url.replace(/^http:\/\//, '')}</b>
        </div>
      </div>
      <Message error={error} />
      <Nav back={() => go(4)} next={run} nextLabel="Fertig – Jukebox starten" busy={busy} />
    </>
  )
}

// ---------- Code-Abfrage am PC ----------

function CodeGate({ onUnlocked }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function unlock(event) {
    event.preventDefault()
    setBusy(true); setError(null)
    const result = await call('POST', '/api/setup/unlock', { code: code.replace(/\s/g, '') })
    setBusy(false)
    if (result.error) { setError(result.error); return }
    writeToken(result.data.token)
    onUnlocked()
  }
  return (
    <div className="setup-center">
      <form className="setup-card narrow" onSubmit={unlock}>
        <div className="setup-gate-icon"><Lock size={28} /></div>
        <h1>Einrichtung freischalten</h1>
        <p className="setup-lead">Gib den 6-stelligen Code ein, der links unten auf dem Jukebox-Bildschirm steht.</p>
        <input className="setup-code-input" value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
          inputMode="numeric" autoFocus placeholder="000 000" />
        <Message error={error} />
        <button className="setup-btn primary wide" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} Freischalten
        </button>
      </form>
    </div>
  )
}

// ---------- Abgeschlossen ----------

function SetupDone({ status, onDevice }) {
  return (
    <div className="setup-center">
      <div className="setup-card narrow">
        <div className="setup-gate-icon done"><PartyPopper size={28} /></div>
        <h1>{status.name} ist bereit!</h1>
        <p className="setup-lead">
          {onDevice ? 'Die Jukebox startet …'
            : 'Die Einrichtung ist abgeschlossen. Ändern lässt sie sich am Jukebox-Bildschirm über das Wartungsmenü (Logo oben links 2 Sekunden gedrückt halten).'}
        </p>
        {!onDevice && <a className="setup-btn primary wide" href="/remote">Zur Fernbedienung</a>}
      </div>
    </div>
  )
}

// Fernbedienung, solange die Einrichtung noch läuft
export function SetupNotice() {
  return (
    <div className="setup-center">
      <div className="setup-card narrow">
        <div className="setup-gate-icon"><Sparkles size={28} /></div>
        <h1>Die JUKEBÜX wird eingerichtet</h1>
        <p className="setup-lead">Sobald die Einrichtung abgeschlossen ist, funktioniert hier die Fernbedienung.</p>
        <a className="setup-btn primary wide" href="/setup">Einrichtung am PC fortsetzen</a>
      </div>
    </div>
  )
}
