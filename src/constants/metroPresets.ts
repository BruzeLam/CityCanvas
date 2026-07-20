/**
 * 成都地铁 / 有轨电车线路色（维基「成都轨道交通颜色」· 已开通主线）。
 * 另附「大红」自定义色，方便非成都场景。
 */

export type LineColorPreset = {
  id: string;
  /** 短标签（色块 title / 自动填线路名） */
  label: string;
  color: string;
};

/** 已开通地铁线 + 大红 */
export const CHENGDU_METRO_PRESETS: LineColorPreset[] = [
  { id: 'cd1', label: '1号线', color: '#0f0f96' },
  { id: 'cd2', label: '2号线', color: '#fe633d' },
  { id: 'cd3', label: '3号线', color: '#d60f6b' },
  { id: 'cd4', label: '4号线', color: '#1cad64' },
  { id: 'cd5', label: '5号线', color: '#a03f92' },
  { id: 'cd6', label: '6号线', color: '#be7331' },
  { id: 'cd7', label: '7号线', color: '#65d0de' },
  { id: 'cd8', label: '8号线', color: '#a6c215' },
  { id: 'cd9', label: '9号线', color: '#f1ad17' },
  { id: 'cd10', label: '10号线', color: '#0054bb' },
  { id: 'cd17', label: '17号线', color: '#87e0aa' },
  { id: 'cd18', label: '18号线', color: '#1a686e' },
  { id: 'cd19', label: '19号线', color: '#94a2dc' },
  { id: 'cd27', label: '27号线', color: '#00a4e0' },
  { id: 'cd30', label: '30号线', color: '#e3718f' },
  { id: 'red', label: '大红', color: '#e60012' },
];

/** 有轨电车配色（蓉1 / 蓉2 + 常用绿） */
export const CHENGDU_TRAM_PRESETS: LineColorPreset[] = [
  { id: 'tram-r1', label: '蓉1号线', color: '#ff671f' },
  { id: 'tram-r2', label: '蓉2号线', color: '#7ebb28' },
  { id: 'tram-green', label: '有轨绿', color: '#5b8c5a' },
  { id: 'tram-teal', label: '青绿', color: '#0f766e' },
  { id: 'red', label: '大红', color: '#e60012' },
];

export function presetLabelsOf(presets: LineColorPreset[]): Set<string> {
  return new Set(presets.map((p) => p.label));
}
