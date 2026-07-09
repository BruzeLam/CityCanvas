import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  authMiddleware,
  getUserByEmail,
  hashPassword,
  signToken,
  toAuthUser,
  verifyPassword,
} from './auth.js';
import { db, type DbMap } from './db.js';
import type { AppEnv } from './types.js';

type MapPayload = {
  version: number;
  name: string;
  settings: { widthM: number; heightM: number; scale: number };
  mapStyle: string;
  features: unknown[];
};

const app = new Hono<AppEnv>();

app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; displayName?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: '请输入有效邮箱' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: '密码至少 6 位' }, 400);
  }
  if (getUserByEmail(email)) {
    return c.json({ error: '该邮箱已注册' }, 409);
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
  ).run(id, email, passwordHash, body.displayName?.trim() || null);

  const token = await signToken(id);
  return c.json({ token, user: toAuthUser(getUserByEmail(email)!) });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !password) {
    return c.json({ error: '请输入邮箱和密码' }, 400);
  }

  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: '邮箱或密码错误' }, 401);
  }

  const token = await signToken(user.id);
  return c.json({ token, user: toAuthUser(user) });
});

app.get('/api/auth/me', authMiddleware, (c) => {
  return c.json({ user: c.get('user') });
});

const maps = new Hono<AppEnv>();
maps.use('*', authMiddleware);

maps.get('/', (c) => {
  const userId = c.get('userId');
  const rows = db
    .prepare(
      `SELECT id, name, updated_at, created_at,
        json_extract(payload, '$.settings.widthM') AS width_m,
        json_extract(payload, '$.settings.heightM') AS height_m,
        json_extract(payload, '$.settings.scale') AS scale,
        json_array_length(json_extract(payload, '$.features')) AS feature_count
       FROM maps WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    updated_at: string;
    created_at: string;
    width_m: number;
    height_m: number;
    scale: number;
    feature_count: number;
  }>;

  return c.json({
    maps: rows.map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      widthM: r.width_m,
      heightM: r.height_m,
      scale: r.scale,
      featureCount: r.feature_count ?? 0,
    })),
  });
});

maps.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name?: string; payload?: MapPayload }>();

  if (!body.name?.trim()) {
    return c.json({ error: '地图名称不能为空' }, 400);
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return c.json({ error: '地图数据无效' }, 400);
  }

  const id = randomUUID();
  const payload = JSON.stringify({ ...body.payload, version: 1, name: body.name.trim() });

  db.prepare('INSERT INTO maps (id, user_id, name, payload) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    body.name.trim(),
    payload,
  );

  const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as DbMap;
  return c.json({ map: serializeMap(row) }, 201);
});

maps.get('/:id', (c) => {
  const userId = c.get('userId');
  const row = db.prepare('SELECT * FROM maps WHERE id = ? AND user_id = ?').get(
    c.req.param('id'),
    userId,
  ) as DbMap | undefined;

  if (!row) return c.json({ error: '地图不存在' }, 404);
  return c.json({ map: serializeMap(row) });
});

maps.put('/:id', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name?: string; payload?: MapPayload }>();
  const id = c.req.param('id');

  const existing = db.prepare('SELECT * FROM maps WHERE id = ? AND user_id = ?').get(id, userId) as
    | DbMap
    | undefined;
  if (!existing) return c.json({ error: '地图不存在' }, 404);

  const name = body.name?.trim() || existing.name;
  const payload = body.payload
    ? JSON.stringify({ ...body.payload, version: 1, name })
    : existing.payload;

  db.prepare(
    `UPDATE maps SET name = ?, payload = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).run(name, payload, id, userId);

  const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as DbMap;
  return c.json({ map: serializeMap(row) });
});

maps.delete('/:id', (c) => {
  const userId = c.get('userId');
  const result = db
    .prepare('DELETE FROM maps WHERE id = ? AND user_id = ?')
    .run(c.req.param('id'), userId);
  if (result.changes === 0) return c.json({ error: '地图不存在' }, 404);
  return c.json({ ok: true });
});

app.route('/api/maps', maps);

function serializeMap(row: DbMap) {
  const payload = JSON.parse(row.payload) as MapPayload;
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    payload,
  };
}

const distPath = path.join(process.cwd(), 'dist');
const isProd = process.env.NODE_ENV === 'production';

if (isProd && fs.existsSync(distPath)) {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.use('/favicon.svg', serveStatic({ path: './dist/favicon.svg' }));
  app.use('/icons.svg', serveStatic({ path: './dist/icons.svg' }));
  app.get('/', serveStatic({ path: './dist/index.html' }));
  app.get('/*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOST || '0.0.0.0';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`CityCanvas server http://${hostname}:${info.port}`);
  if (isProd) console.log('Serving static frontend from dist/');
});
