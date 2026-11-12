import { Hono } from "hono";
import type { Context } from "hono";
import { AiError, runJson, transcribe, wordMatchRatio } from "./ai";
import { authRoutes, requireAdmin, requireUser, sameString } from "./auth";
import { learn } from "./learn";
import { quota, trialLimit } from "./quota";
import type { AppEnv, Env, Role, User } from "./env";
import {
  EXPLAIN_SYSTEM,
  GRADE_SYSTEM,
  LENGTHS,
  LESSON_SYSTEM,
  LEVELS,
  explainPrompt,
  explainSchema,
  gradePrompt,
  gradeSchema,
  lessonPrompt,
  lessonSchema,
  type Explain,
  type Grade,
  type LengthKey,
  type Lesson,
  type Level,
} from "./prompts";

export { BridgeHub } from "./bridge-hub";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof AiError) return c.json({ error: err.message }, err.status as 429 | 502);
  console.error(err);
  return c.json({ error: "Lỗi máy chủ, hãy thử lại." }, 500);
});

app.route("/auth", authRoutes);

// ---- Local Claude bridge (WebSocket from `npm run bridge`) -------------------

app.get("/api/bridge/ws", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!c.env.BRIDGE_TOKEN || !(await sameString(token, c.env.BRIDGE_TOKEN))) return c.text("forbidden", 403);
  const stub = c.env.BRIDGE.get(c.env.BRIDGE.idFromName("bridge"));
  return stub.fetch(c.req.raw);
});

// ---- Everything below needs a signed-in user ---------------------------------

const api = new Hono<AppEnv>();
api.use("*", requireUser);

/** Stops trial users who have used up their AI actions, and blocked users. */
function gate(c: Context<AppEnv>) {
  const user = c.get("user");
  if (user.role === "blocked") {
    return c.json({ error: "Tài khoản đã bị khoá.", code: "blocked", contact: c.env.CONTACT_URL }, 403);
  }
  if (user.role === "trial" && user.ai_used >= trialLimit(c.env)) {
    return c.json(
      { error: "Bạn đã dùng hết lượt dùng thử.", code: "trial_exhausted", contact: c.env.CONTACT_URL },
      402,
    );
  }
  return null;
}

async function recordAi(env: Env, user: User, kind: string, provider: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET ai_used = ai_used + 1, last_seen_at = datetime('now') WHERE id = ?1").bind(user.id),
    env.DB.prepare("INSERT INTO ai_events (user_id, kind, provider) VALUES (?1, ?2, ?3)").bind(user.id, kind, provider),
  ]);
  user.ai_used += 1;
}

const CATEGORIES = ["daily", "food", "travel", "work", "study", "tech", "health", "fun", "nature", "people"];

// ---- Lessons -----------------------------------------------------------------

api.post("/lessons", async (c) => {
  const blocked = gate(c);
  if (blocked) return blocked;
  const user = c.get("user");
  const body = await c.req.json<{ topic?: string; level?: string; length?: string; category?: string }>().catch(() => ({}) as never);
  const category = CATEGORIES.includes(body.category ?? "") ? body.category! : null;
  const topic = (body.topic ?? "").trim().slice(0, 200);
  const level = (LEVELS as readonly string[]).includes(body.level ?? "") ? (body.level as Level) : "B1";
  const length: LengthKey = body.length && body.length in LENGTHS ? (body.length as LengthKey) : "medium";
  if (!topic) return c.json({ error: "Hãy nhập chủ đề." }, 400);

  const result = await runJson<Lesson>(c.env, user, {
    system: LESSON_SYSTEM,
    prompt: lessonPrompt(topic, level, length),
    schema: lessonSchema,
    maxTokens: 4000,
  });
  const lesson = cleanLesson(result.data);
  if (lesson.sentences.length === 0) return c.json({ error: "AI không tạo được bài, hãy thử lại." }, 502);

  const row = await c.env.DB.prepare(
    "INSERT INTO lessons (user_id, title, topic, level, content, provider, is_public, category) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7) RETURNING id",
  )
    .bind(user.id, lesson.title || topic, topic, level, JSON.stringify(lesson), result.provider, category)
    .first<{ id: number }>();
  await recordAi(c.env, user, "lesson", result.provider);
  return c.json({ id: row!.id, provider: result.provider, note: result.note, quota: quota(c.env, user) });
});

// ---- Speaking: Whisper + grader ------------------------------------------------

const MAX_AUDIO_B64 = 2_800_000; // ~2 MB of WAV, about 60 s at 16 kHz mono

api.post("/speak", async (c) => {
  const blocked = gate(c);
  if (blocked) return blocked;
  const user = c.get("user");
  const body = await c.req
    .json<{ target?: string; audio?: string; lessonId?: number; sentenceIndex?: number }>()
    .catch(() => ({}) as never);
  const target = (body.target ?? "").trim().slice(0, 400);
  const audio = body.audio ?? "";
  if (!target || !audio) return c.json({ error: "Thiếu câu mẫu hoặc bản ghi âm." }, 400);
  if (audio.length > MAX_AUDIO_B64) return c.json({ error: "Bản ghi quá dài (tối đa khoảng 60 giây)." }, 413);

  const transcript = await transcribe(c.env, audio);
  const ratio = wordMatchRatio(target, transcript);
  const result = await runJson<Grade>(c.env, user, {
    system: GRADE_SYSTEM,
    prompt: gradePrompt(target, transcript, ratio),
    schema: gradeSchema,
    maxTokens: 1500,
  });
  const grade = cleanGrade(result.data, ratio);

  await c.env.DB.prepare(
    `INSERT INTO attempts (user_id, lesson_id, sentence_index, target, transcript, score, feedback, provider)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      user.id,
      Number.isInteger(body.lessonId) ? body.lessonId : null,
      Number.isInteger(body.sentenceIndex) ? body.sentenceIndex : null,
      target,
      transcript,
      grade.score,
      JSON.stringify(grade),
      result.provider,
    )
    .run();
  await recordAi(c.env, user, "grade", result.provider);
  return c.json({ transcript, ratio, grade, provider: result.provider, note: result.note, quota: quota(c.env, user) });
});

// ---- Reading: explain a sentence ------------------------------------------------

api.post("/explain", async (c) => {
  const blocked = gate(c);
  if (blocked) return blocked;
  const user = c.get("user");
  const body = await c.req.json<{ sentence?: string; context?: string }>().catch(() => ({}) as never);
  const sentence = (body.sentence ?? "").trim().slice(0, 400);
  if (!sentence) return c.json({ error: "Thiếu câu cần giải thích." }, 400);
  const result = await runJson<Explain>(c.env, user, {
    system: EXPLAIN_SYSTEM,
    prompt: explainPrompt(sentence, (body.context ?? "").slice(0, 3000)),
    schema: explainSchema,
    maxTokens: 1200,
  });
  await recordAi(c.env, user, "explain", result.provider);
  return c.json({ explain: result.data, provider: result.provider, note: result.note, quota: quota(c.env, user) });
});

// ---- Admin ------------------------------------------------------------------------

api.get("/admin/users", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.role, u.ai_used, u.xp, u.streak, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
       FROM users u ORDER BY u.last_seen_at DESC NULLS LAST LIMIT 500`,
  ).all();
  const bridge = await c.env.BRIDGE.get(c.env.BRIDGE.idFromName("bridge")).status();
  return c.json({ users: results, trialLimit: trialLimit(c.env), bridgeOnline: bridge.online });
});

api.patch("/admin/users/:id", requireAdmin, async (c) => {
  const body = await c.req.json<{ role?: Role; resetUsage?: boolean }>().catch(() => ({}) as never);
  const id = Number(c.req.param("id"));
  if (id === c.get("user").id) return c.json({ error: "Không đổi quyền của chính mình." }, 400);
  if (body.role && ["member", "trial", "blocked"].includes(body.role)) {
    await c.env.DB.prepare("UPDATE users SET role = ?1 WHERE id = ?2").bind(body.role, id).run();
  }
  if (body.resetUsage) await c.env.DB.prepare("UPDATE users SET ai_used = 0 WHERE id = ?1").bind(id).run();
  return c.json({ ok: true });
});

api.route("/", learn);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// ---- helpers ----------------------------------------------------------------------

function cleanLesson(l: Lesson): Lesson {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    title: str(l?.title),
    summary_vi: str(l?.summary_vi),
    sentences: (Array.isArray(l?.sentences) ? l.sentences : []).map(str).filter(Boolean).slice(0, 30),
    vocabulary: (Array.isArray(l?.vocabulary) ? l.vocabulary : []).slice(0, 15).map((v) => ({
      word: str(v?.word),
      ipa: str(v?.ipa),
      pos: str(v?.pos),
      meaning_vi: str(v?.meaning_vi),
      example: str(v?.example),
    })),
    questions: (Array.isArray(l?.questions) ? l.questions : [])
      .filter((q) => Array.isArray(q?.options) && q.options.length >= 2)
      .slice(0, 8)
      .map((q) => ({
        question: str(q.question),
        options: q.options.map(str),
        answer_index: Math.min(Math.max(0, Math.trunc(Number(q.answer_index) || 0)), q.options.length - 1),
        explanation_vi: str(q.explanation_vi),
      })),
  };
}

function cleanGrade(g: Grade, ratio: number): Grade {
  const score = Number.isFinite(Number(g?.score)) ? Math.round(Number(g.score)) : Math.round(ratio * 100);
  return {
    score: Math.min(100, Math.max(0, score)),
    words: (Array.isArray(g?.words) ? g.words : []).slice(0, 80).map((w) => ({
      word: String(w?.word ?? ""),
      status: ["ok", "unclear", "missing", "extra"].includes(w?.status) ? w.status : "ok",
      tip_vi: String(w?.tip_vi ?? ""),
    })),
    feedback_vi: String(g?.feedback_vi ?? ""),
    next_step_vi: String(g?.next_step_vi ?? ""),
  };
}

export default app;
