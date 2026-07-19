/**
 * 种子噪声（确定性 · 无外部依赖）
 * 用于开局海陆生成；同 seed 同结果。
 */

function hashInt(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** 0..1 */
export function hash2d(ix: number, iy: number, seed: number): number {
  return hashInt(ix * 374761393 + iy * 668265263 + seed * 1442695041) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 双线性平滑值噪声，输出约 0..1 */
export function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const v00 = hash2d(x0, y0, seed);
  const v10 = hash2d(x0 + 1, y0, seed);
  const v01 = hash2d(x0, y0 + 1, seed);
  const v11 = hash2d(x0 + 1, y0 + 1, seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

/** 分形布朗运动，输出约 0..1 */
export function fbm2d(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2d(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** 域扭曲：让岸线更弯 */
export function warpedFbm(
  x: number,
  y: number,
  seed: number,
  warp = 0.35,
): number {
  const wx = fbm2d(x * 0.9, y * 0.9, seed + 11, 3) * 2 - 1;
  const wy = fbm2d(x * 0.9, y * 0.9, seed + 29, 3) * 2 - 1;
  return fbm2d(x + wx * warp, y + wy * warp, seed, 5);
}
