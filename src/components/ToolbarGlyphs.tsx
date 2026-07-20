/** 工具栏小圆标内简图（无外框，由 CSS 圆框承托） */

type GlyphProps = { active?: boolean };

const ink = (active?: boolean) => (active ? '#fff' : '#3d3a36');
const soft = (active?: boolean) => (active ? 'rgba(255,255,255,0.7)' : '#8a8580');

export function GlyphLand({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M1 9 Q5 4 10 7 T19 5" fill="none" stroke={ink(active)} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphWater({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M2 4h4M8 7h5M14 3h4" stroke={active ? '#9ed8ea' : '#5aa0b8'} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphGreen({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <circle cx="7" cy="6" r="3" fill={active ? '#b7df9f' : '#7aab68'} />
      <circle cx="13" cy="7" r="2.2" fill={active ? '#dff0d4' : '#8fbc7a'} />
    </svg>
  );
}

export function GlyphEraser({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M5 9 L9 3 L15 9 Z" fill={active ? '#f0a090' : '#e8b4a8'} stroke={ink(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphRiverLine({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M1 9 C4 2 8 11 11 5 S18 4 19 8" fill="none" stroke={active ? '#9ed0e0' : '#5a9fc4'} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRoad({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M1 6 H19" stroke={active ? '#f5c14a' : '#d4a017'} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M4 6 H7 M10 6 H13 M16 6 H18" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRail({
  active,
  kind = 'railway',
}: GlyphProps & { kind?: 'railway' | 'hsr' | 'metro' | 'tram' }) {
  const color =
    kind === 'hsr' ? '#4d8fd6' : kind === 'metro' ? '#e85d4c' : kind === 'tram' ? '#6aa05f' : ink(active);
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M1 6 H19" stroke={color} strokeWidth={kind === 'tram' ? 1.6 : 2.4} strokeLinecap="round" />
      {(kind === 'railway' || kind === 'hsr') && (
        <path d="M2 6 H18" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" strokeDasharray="2.2 1.8" />
      )}
    </svg>
  );
}

export function GlyphFerry({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M1 7 H19" stroke={active ? '#8ec8e0' : '#4a90c4'} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2.5 2" />
    </svg>
  );
}

export function GlyphStationRect({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <rect x="5" y="3.5" width="10" height="5" fill={active ? '#fff' : '#2a2a2a'} stroke={ink(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphStationRound({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <rect x="4" y="3.5" width="12" height="5" rx="2.5" fill="#e85d4c" stroke={ink(active)} strokeWidth="1" />
    </svg>
  );
}

export function GlyphLabel({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <text x="10" y="9.5" textAnchor="middle" fontSize="9" fontWeight="700" fill={ink(active)}>
        Aa
      </text>
    </svg>
  );
}

export function GlyphFacility({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <rect x="4" y="3" width="4" height="7" fill={soft(active)} />
      <rect x="10" y="5" width="5" height="5" fill={soft(active)} />
    </svg>
  );
}

export function GlyphUndo({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 20 12" aria-hidden>
      <path d="M14 3.5a4.2 4.2 0 1 1-4.2 4.2" fill="none" stroke={active ? '#9ec5ff' : '#4a7ab5'} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 4.5 L5.5 7 L9 7.5" fill="none" stroke={active ? '#9ec5ff' : '#4a7ab5'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
