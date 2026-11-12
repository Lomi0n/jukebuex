/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { Check } from 'lucide-react'

// Verfügbare Skins. Das eigentliche Aussehen steckt in skins.css (:root[data-skin="…"]).
// Die Farben hier sind nur für die kleine Vorschau in der Auswahl.
export const SKINS = [
  { key: 'standard', name: 'JUKEBÜX', hint: 'Der klassische Look',
    preview: { bg: '#000', panel: '#1b1b1f', accent: '#b7f36b', text: '#f4f4f6' } },
  { key: 'retro', name: 'Retro 50er', hint: 'Holz, Bernstein und Chrom',
    preview: { bg: '#170c06', panel: '#3a2012', accent: '#ffb238', text: '#fff3dc' } },
  { key: 'synthwave', name: '80er Synthwave', hint: 'Neon-Pink und Cyan auf Violett',
    preview: { bg: '#0d0221', panel: '#26104d', accent: '#ff2fb9', text: '#29f0ff' } },
  { key: 'swiss', name: 'Swiss Edition', hint: 'Rot-Weiss, klare Typografie',
    preview: { bg: '#e9e7e3', panel: '#ffffff', accent: '#e2001a', text: '#141414' } },
  { key: 'kritzel', name: 'Kritzelbuch', hint: 'Wachsmalstift auf Papier',
    preview: { bg: '#f6efe0', panel: '#fffdf7', accent: '#3c7be0', text: '#ff8a3d' } },
  { key: 'kritzel-dark', name: 'Kritzelbuch Nacht', hint: 'Kreide und Wachsmalstift im dunklen Heft',
    preview: { bg: '#121419', panel: '#272b33', accent: '#6ea8ff', text: '#ffe066' } },
]

export function SkinPicker({ value, onPick, busy }) {
  return (
    <div className="skin-picker">
      {SKINS.map(skin => {
        const p = skin.preview
        return (
          <button key={skin.key} className={`skin-tile ${value === skin.key ? 'active' : ''}`} disabled={busy}
            onClick={() => onPick(skin.key)} title={skin.hint}>
            <span className="skin-mini" style={{ background: p.bg }}>
              <i style={{ background: p.panel }} />
              <i style={{ background: p.panel }}><b style={{ background: p.accent }} /><b style={{ background: p.text }} /></i>
              {value === skin.key && <em><Check size={14} strokeWidth={3} /></em>}
            </span>
            <strong>{skin.name}</strong>
            <span>{skin.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
