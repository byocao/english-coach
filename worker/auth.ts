import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, User } from "./env";

const SESSION_COOKIE = "ec_sid";
const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-z0-9._-]{3,24}$/;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 10;
// PBKDF2-SHA256. 20k iterations is ~6 ms of CPU, which fits the Workers Free
// 10 ms CPU budget. The count is stored in each hash so it can be raised later.
const PBKDF2_ITERATIONS = 20_000;

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...u8));
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, unb64(salt), Number(iter));
  const expected = unb64(hash);
  if (actual.byteLength !== expected.byteLength) return false;
  return (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(
    actual,
    expected.buffer,
  );
}

async function startSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, datetime('now', '+${SESSION_DAYS} days'))`,
  )
    .bind(token, userId)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

async function readCredentials(c: Context<AppEnv>) {
  const body = await c.req.json<{ username?: unknown; password?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  return { username, password };
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", async (c) => {
  const { username, password } = await readCredentials(c);
  if (!USERNAME_RE.test(username)) {
    return c.json({ error: "Tên đăng nhập 3–24 ký tự, chỉ gồm chữ thường, số và . _ -" }, 400);
  }
  if (password.length < 8 || password.length > 128) return c.json({ error: "Mật khẩu cần từ 8 đến 128 ký tự." }, 400);
  if (username === c.env.ADMIN_LOGIN.toLowerCase()) return c.json({ error: "Tên đăng nhập này đã có người dùng." }, 409);

  const hash = await hashPassword(password);
  const row = await c.env.DB.prepare(
    `INSERT INTO users (login, name, role, password_hash, last_seen_at)
     VALUES (?1, ?1, 'trial', ?2, datetime('now'))
     ON CONFLICT(login) DO NOTHING RETURNING id`,
  )
    .bind(username, hash)
    .first<{ id: number }>();
  if (!row) return c.json({ error: "Tên đăng nhập này đã có người dùng." }, 409);
  await startSession(c, row.id);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const { username, password } = await readCredentials(c);
  const bad = () => c.json({ error: "Sai tên đăng nhập hoặc mật khẩu." }, 401);
  if (!username || !password || password.length > 128) return bad();

  const isAdmin = username === c.env.ADMIN_LOGIN.toLowerCase();
  let user = await c.env.DB.prepare(
    `SELECT id, password_hash, failed_logins, locked_until > datetime('now') AS locked
       FROM users WHERE login = ?1`,
  )
    .bind(username)
    .first<{ id: number; password_hash: string | null; failed_logins: number; locked: number | null }>();

  if (user?.locked) return c.json({ error: `Đăng nhập sai quá nhiều lần. Thử lại sau ${LOCK_MINUTES} phút.` }, 429);

  // The admin's password is the ADMIN_PASSWORD secret, never stored in D1.
  let ok: boolean;
  if (isAdmin) {
    ok = !!c.env.ADMIN_PASSWORD && (await sameString(password, c.env.ADMIN_PASSWORD));
    if (ok && !user) {
      user = await c.env.DB.prepare(
        `INSERT INTO users (login, name, role, last_seen_at) VALUES (?1, ?1, 'admin', datetime('now')) RETURNING id, NULL AS password_hash, 0 AS failed_logins, 0 AS locked`,
      )
        .bind(username)
        .first();
    }
  } else {
    ok = !!user?.password_hash && (await verifyPassword(password, user.password_hash));
  }

  if (!user) return bad();
  if (!ok) {
    const failures = user.failed_logins + 1;
    const lock = failures >= MAX_FAILURES;
    await c.env.DB.prepare(
      `UPDATE users SET failed_logins = ?1,
              locked_until = CASE WHEN ?2 THEN datetime('now', '+${LOCK_MINUTES} minutes') ELSE locked_until END
        WHERE id = ?3`,
    )
      .bind(lock ? 0 : failures, lock ? 1 : 0, user.id)
      .run();
    return bad();
  }

  await c.env.DB.prepare(
    `UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = datetime('now'),
            role = CASE WHEN ?2 THEN 'admin' WHEN role = 'admin' THEN 'trial' ELSE role END
      WHERE id = ?1`,
  )
    .bind(user.id, isAdmin ? 1 : 0)
    .run();
  await startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Loads the signed-in user; 401 when there is none. */
export async function requireUser(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Chưa đăng nhập", code: "unauthenticated" }, 401);
  const user = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.name, NULL AS avatar_url, u.role, u.ai_used, u.level, u.mascot, u.placed_at, u.placement_score
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?1 AND s.expires_at > datetime('now')`,
  )
    .bind(token)
    .first<User>();
  if (!user) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ error: "Phiên đăng nhập đã hết hạn", code: "unauthenticated" }, 401);
  }
  c.set("user", user);
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (c.get("user").role !== "admin") return c.json({ error: "Chỉ dành cho quản trị viên" }, 403);
  await next();
}

export async function sameString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(ha, hb);
}
