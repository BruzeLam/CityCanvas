/** 架空国风城市名：两字为主，偶发三字 */

const PREFIXES = [
  '江',
  '京',
  '海',
  '杭',
  '澄',
  '浦',
  '澜',
  '滨',
  '临',
  '云',
  '星',
  '梧',
  '蓉',
  '锦',
  '徽',
  '宣',
  '润',
  '嘉',
  '甬',
  '温',
  '清',
  '宁',
  '安',
  '平',
  '昌',
  '兴',
  '华',
  '泰',
  '瑞',
  '永',
  '长',
  '远',
  '通',
  '和',
  '盛',
  '富',
  '德',
  '文',
  '武',
  '光',
  '明',
  '新',
  '东',
  '南',
  '北',
  '西',
  '燕',
  '吴',
  '越',
  '楚',
  '秦',
  '晋',
  '齐',
  '鲁',
  '蜀',
  '滇',
  '闽',
  '湘',
  '冀',
  '陇',
  '凉',
  '朔',
  '沧',
  '瀚',
  '渚',
  '汀',
  '浔',
  '沅',
  '洛',
  '津',
  '渝',
  '皖',
  '赣',
  '粤',
];

const MIDDLES = ['江', '海', '云', '山', '水', '风', '月', '星', '澜', '澄', '清', '明', '安', '和'];

const SUFFIXES = [
  '州',
  '城',
  '港',
  '湾',
  '都',
  '京',
  '海',
  '江',
  '河',
  '湖',
  '岛',
  '关',
  '口',
  '门',
  '阳',
  '阴',
  '安',
  '宁',
  '平',
  '昌',
  '兴',
  '华',
  '源',
  '川',
  '陵',
  '丘',
  '山',
  '谷',
  '滨',
  '浦',
  '津',
  '渡',
  '驿',
  '镇',
  '府',
  '邑',
  '墟',
  '圩',
  '塘',
  '洲',
];

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0]!;
}

/** 生成架空国风城市名，如「江州」「京海」「临江城」 */
export function randomCityName(avoid?: string): string {
  for (let i = 0; i < 24; i++) {
    let name: string;
    if (Math.random() < 0.18) {
      // 三字：临江城 / 东海港
      const a = pick(PREFIXES);
      let b = pick(MIDDLES);
      if (b === a) b = pick(MIDDLES);
      let c = pick(SUFFIXES);
      if (c === a || c === b) c = pick(SUFFIXES);
      name = `${a}${b}${c}`;
    } else {
      const a = pick(PREFIXES);
      let b = pick(SUFFIXES);
      // 避免「京京」「海海」等叠字
      if (b === a) b = pick(SUFFIXES.filter((s) => s !== a));
      name = `${a}${b}`;
    }
    if (name !== avoid && name !== '未命名城市') return name;
  }
  return '江州';
}
