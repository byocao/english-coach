import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env, Role, User } from "./env";

const SESSION_COOKIE = "ec_sid";
const STATE_COOKIE = "ec_oauth_state";
const SESSION_DAYS = 30;

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

async function upsertUser(
  env: Env,
  gh: { id: number | null; login: string; name: string | null; avatar_url: string | null },
): Promise<number> {
  const isAdmin = gh.login.toLowerCase() === env.ADMIN_LOGIN.toLowerCase();
  const existing = await env.DB.prepare("SELECT id, role FROM users WHERE login = ?1 COLLATE NOCASE")
    .bind(gh.login)
    .first<{ id: number; role: Role }>();
  if (existing) {
    const role: Role = isAdmin ? "admin" : existing.role === "admin" ? "trial" : existing.role;
    await env.DB.prepare(
      "UPDATE users SET github_id = COALESCE(?1, github_id), name = ?2, avatar_url = ?3, role = ?4, last_seen_at = datetime('now') WHERE id = ?5",
    )
      .bind(gh.id, gh.name, gh.avatar_url, role, existing.id)
      .run();
    return existing.id;
  }
  const row = await env.DB.prepare(
    "INSERT INTO users (github_id, login, name, avatar_url, role, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now')) RETURNING id",
  )
    .bind(gh.id, gh.login, gh.name, gh.avatar_url, isAdmin ? "admin" : "trial")
    .first<{ id: number }>();
  return row!.id;
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
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/github", (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.text("GitHub login is not configured (GITHUB_CLIENT_ID).", 500);
  const state = randomToken(16);
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: isSecure(c), sameSite: "Lax", path: "/auth", maxAge: 600 });
  const redirect = new URL("/auth/github/callback", c.req.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return c.redirect(url.toString());
});

authRoutes.get("/github/callback", async (c) => {
  const { code, state } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (!code || !state || state !== expected) return c.redirect("/?login_error=state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/auth/github/callback", c.req.url).toString(),
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return c.redirect("/?login_error=token");

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "english-coach",
    },
  });
  if (!userRes.ok) return c.redirect("/?login_error=user");
  const gh = (await userRes.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };

  const userId = await upsertUser(c.env, gh);
  await startSession(c, userId);
  return c.redirect("/");
});

// Local development only: log in as any GitHub login without OAuth.
authRoutes.get("/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.notFound();
  const login = c.req.query("login") || c.env.ADMIN_LOGIN;
  const userId = await upsertUser(c.env, { id: null, login, name: login, avatar_url: null });
  await startSession(c, userId);
  return c.redirect("/");
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
    `SELECT u.id, u.login, u.name, u.avatar_url, u.role, u.ai_used
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
