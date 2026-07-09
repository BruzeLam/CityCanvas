import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import { db, type DbUser } from './db.js';
import type { AppEnv, AuthUser } from './types.js';

export type { AuthUser };

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'citycanvas-dev-secret-change-in-production',
);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function toAuthUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
}

export function getUserById(id: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}

export function getUserByEmail(email: string): DbUser | undefined {
  return db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim().toLowerCase()) as DbUser | undefined;
}

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: '请先登录' }, 401);
  }

  const userId = await verifyToken(header.slice(7));
  if (!userId) {
    return c.json({ error: '登录已过期，请重新登录' }, 401);
  }

  const user = getUserById(userId);
  if (!user) {
    return c.json({ error: '用户不存在' }, 401);
  }

  c.set('userId', userId);
  c.set('user', toAuthUser(user));
  await next();
}
