/** 工具栏简图：小 SVG，便于快速辨认 */

type GlyphProps = { active?: boolean; className?: string };

const stroke = (active?: boolean) => (active ? '#fff' : '#3d3a36');
const muted = (active?: boolean) => (active ? 'rgba(255,255,255,0.55)' : '#9a9590');

export function GlyphLand({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#e8e4dc' : '#f2efe9'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M3 12 Q8 8 14 11 T25 9" fill="none" stroke={muted(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphWater({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#7eb8c9' : '#aad3df'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M4 8h4M12 11h5M20 7h4" stroke={active ? '#dff3f8' : '#fff'} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphGreen({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#8fbc7a' : '#add19e'} stroke={stroke(active)} strokeWidth="1" />
      <circle cx="10" cy="9" r="3.2" fill={active ? '#dff0d4' : '#c5e0b4'} />
      <circle cx="17" cy="11" r="2.4" fill={active ? '#dff0d4' : '#c5e0b4'} />
    </svg>
  );
}

export function GlyphEraser({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#4a4540' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M8 12 L14 5 L20 12 Z" fill={active ? '#c45c4a' : '#e8b4a8'} stroke={stroke(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphRiverLine({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#3d5a66' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M4 12 C8 4 12 14 16 7 S24 6 25 10" fill="none" stroke={active ? '#9ed0e0' : '#5a9fc4'} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRoad({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#3d3a36' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M4 9 H24" stroke={active ? '#f5a623' : '#d4a017'} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M8 9 H11 M15 9 H18 M21 9 H23" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  );
}

export function GlyphRail({ active, kind = 'railway' }: GlyphProps & { kind?: 'railway' | 'hsr' | 'metro' | 'tram' }) {
  const color =
    kind === 'hsr' ? '#2b6cb0' : kind === 'metro' ? '#e85d4c' : kind === 'tram' ? '#5b8c5a' : '#2a2a2a';
  const stripe = kind === 'metro' || kind === 'tram' ? null : '#fff';
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M4 9 H24" stroke={color} strokeWidth={kind === 'tram' ? 2 : 3.2} strokeLinecap="round" />
      {stripe && (
        <path d="M5 9 H23" stroke={stripe} strokeWidth="1.2" strokeLinecap="round" strokeDasharray="3 2.5" />
      )}
    </svg>
  );
}

export function GlyphFerry({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c4a5a' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M4 10 H24" stroke={active ? '#8ec8e0' : '#4a90c4'} strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2.5" />
      <path d="M12 6 L16 10 L12 13" fill="none" stroke={active ? '#cfe8f4' : '#7eb8c9'} strokeWidth="1.2" />
    </svg>
  );
}

export function GlyphStationRect({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <rect x="9" y="6" width="10" height="6" fill={active ? '#fff' : '#2a2a2a'} stroke={stroke(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphStationRound({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <rect x="8" y="6" width="12" height="6" rx="3" fill={active ? '#e85d4c' : '#e85d4c'} stroke={stroke(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphLabel({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <text x="14" y="12.5" textAnchor="middle" fontSize="9" fontWeight="700" fill={active ? '#fff' : '#3d3a36'}>
        Aa
      </text>
    </svg>
  );
}

export function GlyphFacility({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f0eeea'} stroke={muted(active)} strokeWidth="1" strokeDasharray="2 2" />
      <rect x="8" y="5" width="5" height="9" fill={muted(active)} />
      <rect x="15" y="8" width="5" height="6" fill={muted(active)} />
    </svg>
  );
}

export function GlyphUndo({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 28 18" aria-hidden>
      <rect x="1" y="1" width="26" height="16" rx="1" fill={active ? '#2c2a28' : '#f7f5f1'} stroke={stroke(active)} strokeWidth="1" />
      <path d="M18 6a5 5 0 1 1-5 5" fill="none" stroke={active ? '#9ec5ff' : '#4a7ab5'} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 8 L8 11 L12 12" fill="none" stroke={active ? '#9ec5ff' : '#4a7ab5'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
