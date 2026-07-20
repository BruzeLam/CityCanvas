/** 工具栏圆标 / 预览条：饱满色块简图，一眼能认 */

import type { RoadLevel } from '../types';
import { ROAD_STYLES } from '../types';

type GlyphProps = { active?: boolean };

/** 道路等级：画布上的粗细与配色预览 */
export function GlyphRoadLevel({
  level,
  active,
}: GlyphProps & { level: RoadLevel }) {
  const style = ROAD_STYLES[level];
  const strokeW = { expressway: 9, arterial: 7, collector: 5, local: 3.2 }[level];
  const dash = level === 'expressway' || level === 'arterial';
  return (
    <svg className="tb-preview-glyph" viewBox="0 0 56 28" aria-hidden>
      <rect x="1" y="1" width="54" height="26" rx="4" fill={active ? '#2f2c28' : '#f3efe8'} />
      <path
        d="M6 14h44"
        stroke={style.casing}
        strokeWidth={strokeW + 2.4}
        strokeLinecap="round"
      />
      <path
        d="M6 14h44"
        stroke={style.color}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {dash && (
        <path
          d="M10 14h36"
          stroke={active ? 'rgba(255,255,255,0.85)' : '#fff'}
          strokeWidth={Math.max(1.2, strokeW * 0.22)}
          strokeLinecap="round"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}

/** 直线画法 */
export function GlyphPathStraight({ active }: GlyphProps) {
  return (
    <svg className="tb-preview-glyph" viewBox="0 0 56 28" aria-hidden>
      <rect x="1" y="1" width="54" height="26" rx="4" fill={active ? '#2f2c28' : '#f3efe8'} />
      <path
        d="M8 14h40"
        stroke={active ? '#f0b429' : '#d4a017'}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M12 14h4M20 14h4M28 14h4M36 14h4"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="14" r="2.6" fill={active ? '#ffe08a' : '#fff'} stroke={active ? '#c47d12' : '#b8860b'} strokeWidth="1.2" />
      <circle cx="48" cy="14" r="2.6" fill={active ? '#ffe08a' : '#fff'} stroke={active ? '#c47d12' : '#b8860b'} strokeWidth="1.2" />
    </svg>
  );
}

/** 弯道画法：突出三点 A→B→C */
export function GlyphPathCurve({ active }: GlyphProps) {
  const ink = active ? '#ffe08a' : '#d4a017';
  const dot = active ? '#fff' : '#fff';
  const ring = active ? '#c47d12' : '#b8860b';
  const label = active ? '#2f2c28' : '#5a4a28';
  return (
    <svg className="tb-preview-glyph" viewBox="0 0 56 28" aria-hidden>
      <rect x="1" y="1" width="54" height="26" rx="4" fill={active ? '#2f2c28' : '#f3efe8'} />
      {/* 三点折线暗示，半透明 */}
      <path
        d="M8 20 L28 6 L48 20"
        fill="none"
        stroke={active ? 'rgba(255,224,138,0.35)' : 'rgba(180,140,40,0.35)'}
        strokeWidth="1.2"
        strokeDasharray="2.5 2"
      />
      {/* 劣弧弯道 */}
      <path
        d="M8 20 Q28 2 48 20"
        fill="none"
        stroke={ink}
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      {/* 点 A / B / C */}
      <circle cx="8" cy="20" r="3.2" fill={dot} stroke={ring} strokeWidth="1.3" />
      <circle cx="28" cy="6" r="3.4" fill="#ff7a45" stroke="#fff" strokeWidth="1.2" />
      <circle cx="48" cy="20" r="3.2" fill={dot} stroke={ring} strokeWidth="1.3" />
      <text x="8" y="21.2" textAnchor="middle" fontSize="5.5" fontWeight="800" fill={label}>
        1
      </text>
      <text x="28" y="7.4" textAnchor="middle" fontSize="5.5" fontWeight="800" fill="#fff">
        2
      </text>
      <text x="48" y="21.2" textAnchor="middle" fontSize="5.5" fontWeight="800" fill={label}>
        3
      </text>
    </svg>
  );
}

export function GlyphLand({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#e8e0d0' : '#f0ebe3'} />
      <path d="M2 15c3-4 6-2 9-3s5-4 11-2v8H2z" fill={active ? '#c4b59a' : '#d2c4a8'} />
      <path d="M3 18h18" stroke={active ? '#8a7a60' : '#a89878'} strokeWidth="1.2" />
    </svg>
  );
}

export function GlyphWater({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#5eb0c8' : '#7ec8da'} />
      <path d="M4 9c2 2 4 0 6 2s4 0 6 2 4 0 6 1" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <path d="M4 14c2 2 4 0 6 2s4 0 6 1 3 1 6 2" fill="none" stroke="#dff6fc" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

export function GlyphGreen({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#6f9e5e' : '#8fbc7a'} />
      <circle cx="9" cy="11" r="4.2" fill={active ? '#b7e09a' : '#c5e8ad'} />
      <circle cx="15.5" cy="13" r="3.4" fill={active ? '#9fd07e' : '#addf93'} />
      <rect x="10.5" y="14" width="2.2" height="5" rx="0.6" fill={active ? '#5a7a40' : '#6b8f4e'} />
    </svg>
  );
}

export function GlyphEraser({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#4a4540' : '#efeae4'} />
      <path d="M7 15l5-8 6 8H7z" fill={active ? '#f2a090' : '#efb0a0'} stroke={active ? '#fff' : '#c47868'} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 15h8" stroke={active ? '#fff' : '#a06050'} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRiverLine({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#3d6474' : '#e8f4f8'} />
      <path
        d="M4 16c3-8 5 2 8-4s4-6 8-2"
        fill="none"
        stroke={active ? '#9fe0f2' : '#3d9bb8'}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GlyphRoad({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#3a3834' : '#ebe7e0'} />
      <path d="M3 12h18" stroke={active ? '#f0b429' : '#e0a010'} strokeWidth="5" strokeLinecap="round" />
      <path d="M6 12h2.5M11 12h2.5M16 12h2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRail({
  active,
  kind = 'railway',
}: GlyphProps & { kind?: 'railway' | 'hsr' | 'metro' | 'tram' }) {
  const bg =
    kind === 'hsr'
      ? active
        ? '#1e4f86'
        : '#dceaf8'
      : kind === 'metro'
        ? active
          ? '#8b2e24'
          : '#fce8e6'
        : kind === 'tram'
          ? active
            ? '#3d6b3a'
            : '#e5f2e2'
          : active
            ? '#2c2a28'
            : '#eceae6';
  const line =
    kind === 'hsr' ? '#4d9be8' : kind === 'metro' ? '#e85d4c' : kind === 'tram' ? '#6db35f' : active ? '#ddd' : '#2a2a2a';
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={bg} />
      <path d="M3 12h18" stroke={line} strokeWidth={kind === 'tram' ? 3 : 4.2} strokeLinecap="round" />
      {(kind === 'railway' || kind === 'hsr') && (
        <path d="M5 12h14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2.2" />
      )}
      {kind === 'metro' && (
        <circle cx="12" cy="12" r="2.2" fill="#fff" />
      )}
    </svg>
  );
}

export function GlyphFerry({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#1f4f66' : '#e3f1f8'} />
      <path d="M4 13h16" stroke={active ? '#8fd0ea' : '#3b8db8'} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="3.5 2.5" />
      <path d="M8 9h4l3 4H9z" fill={active ? '#c5eaf6' : '#6eb0d0'} />
    </svg>
  );
}

export function GlyphStationRect({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#2c2a28' : '#eceae6'} />
      <rect x="6" y="8" width="12" height="7" fill={active ? '#fff' : '#2a2a2a'} stroke={active ? '#aaa' : '#111'} strokeWidth="1.2" />
      <path d="M8 11.5h8" stroke={active ? '#2c2a28' : '#fff'} strokeWidth="1.3" />
    </svg>
  );
}

export function GlyphStationRound({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#5a201c' : '#fce8e6'} />
      <rect x="5" y="8" width="14" height="7" rx="3.5" fill="#e85d4c" stroke={active ? '#fff' : '#b83d32'} strokeWidth="1.2" />
      <circle cx="12" cy="11.5" r="1.4" fill="#fff" />
    </svg>
  );
}

export function GlyphLabel({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#3d352c' : '#f3ede4'} />
      <rect x="5" y="7" width="14" height="10" rx="1.5" fill={active ? '#f5e6c8' : '#fff'} stroke={active ? '#c4a574' : '#cbb896'} strokeWidth="1.2" />
      <text x="12" y="14.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill={active ? '#5a4030' : '#4a3c30'}>
        Aa
      </text>
    </svg>
  );
}

export function GlyphFacility({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#3a3a38' : '#eeebe6'} strokeDasharray={active ? undefined : '2 2'} stroke={active ? 'none' : '#c4bfb8'} strokeWidth="1" />
      <rect x="6" y="8" width="5" height="10" fill={active ? '#d4c4a0' : '#b8a888'} />
      <rect x="13" y="11" width="5" height="7" fill={active ? '#c4b090' : '#a89878'} />
      <rect x="7.2" y="10" width="1.4" height="1.4" fill="#fff" opacity="0.7" />
      <rect x="9.2" y="10" width="1.4" height="1.4" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function GlyphUndo({ active }: GlyphProps) {
  return (
    <svg className="tb-glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="3" fill={active ? '#1e3a5f' : '#e8f0fa'} />
      <path d="M15 7a5 5 0 1 1-5 5" fill="none" stroke={active ? '#9ec5ff' : '#3b76c4'} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.5 8.5 L5.5 11.5 L9.5 12.2" fill="none" stroke={active ? '#9ec5ff' : '#3b76c4'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
