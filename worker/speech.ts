// Natural AI voice (Deepgram Aura-2 on Workers AI) and word cards (Vietnamese meaning from Workers AI).
import { Hono } from "hono";
import { AiError, runJson } from "./ai";
import type { AppEnv } from "./env";

export const speech = new Hono<AppEnv>();

const TTS_MODEL = "@cf/deepgram/aura-2-en";
export const VOICES = ["asteria", "luna", "athena", "orion", "arcas", "apollo"] as const;
const DEFAULT_VOICE = "asteria";
const MAX_TTS_CHARS = 400;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Audio for `t` in voice `v`. Kept in Cloudflare's cache and the browser, so each text is synthesised once. */
speech.get("/tts", async (c) => {
  const user = c.get("user");
  if (user.role === "blocked") return c.json({ error: "Tài khoản đã bị khoá.", code: "blocked" }, 403);
  const text = (c.req.query("t") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
  if (!text) return c.json({ error: "Thiếu nội dung." }, 400);
  const voice = (VOICES as readonly string[]).includes(c.req.query("v") ?? "") ? c.req.query("v")! : DEFAULT_VOICE;

  const key = new Request(`https://tts.wancha.cache/${TTS_MODEL}/${voice}/${await sha256(text)}.mp3`);
  const cache = (caches as unknown as { default: Cache }).default;
  const browserCache = "private, max-age=31536000, immutable";
  const hit = await cache.match(key);
  if (hit) {
    return new Response(hit.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": browserCache, "X-TTS": "cache" } });
  }

  // New speech costs money: a daily cap per account (the admin has none).
  if (user.role !== "admin") {
    const cap = Number(c.env.TTS_DAILY_CHARS) || 20000;
    const ok = await c.env.DB.prepare(
      `INSERT INTO tts_usage (user_id, day, chars) VALUES (?1, date('now', '+7 hours'), ?2)
       ON CONFLICT(user_id, day) DO UPDATE SET chars = chars + ?2 WHERE chars + ?2 <= ?3
       RETURNING chars`,
    )
      .bind(user.id, text.length, cap)
      .first();
    if (!ok) return c.json({ error: "Hôm nay bạn đã nghe rất nhiều câu mới. Giọng máy của trình duyệt sẽ đọc thay.", code: "tts_limit" }, 429);
  }

  let audio: ArrayBuffer;
  try {
    const out = (await c.env.AI.run(TTS_MODEL as keyof AiModels, { text, speaker: voice, encoding: "mp3" } as never)) as unknown;
    if (out instanceof ReadableStream) audio = await new Response(out).arrayBuffer();
    else if (out instanceof ArrayBuffer) audio = out;
    else if (typeof (out as { audio?: unknown })?.audio === "string") {
      audio = Uint8Array.from(atob((out as { audio: string }).audio), (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer;
    } else throw new Error("unexpected TTS output");
  } catch (err) {
    console.error("tts", err);
    // Nothing was synthesised: give the characters back.
    if (user.role !== "admin") {
      await c.env.DB.prepare("UPDATE tts_usage SET chars = MAX(0, chars - ?2) WHERE user_id = ?1 AND day = date('now', '+7 hours')")
        .bind(user.id, text.length)
        .run();
    }
    return c.json({ error: "Không tạo được giọng đọc.", code: "tts_failed" }, 502);
  }
  const res = new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": browserCache, "X-TTS": "new" } });
});

// ---- Word cards ------------------------------------------------------------------------------

export interface WordInfo {
  word: string;
  lemma: string;
  ipa: string;
  senses: { pos: string; meaning_vi: string; example: string; example_vi: string }[];
}

const WORD_SYSTEM = "You are an English–Vietnamese learner's dictionary. Answer in short, natural Vietnamese for learners.";

const wordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lemma", "ipa", "senses"],
  properties: {
    lemma: { type: "string" },
    ipa: { type: "string" },
    senses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pos", "meaning_vi", "example", "example_vi"],
        properties: {
          pos: { type: "string" },
          meaning_vi: { type: "string" },
          example: { type: "string" },
          example_vi: { type: "string" },
        },
      },
    },
  },
} as const;

const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");

/** Lower-case English word, or "" when it is not one. */
function cleanWord(w: unknown): string {
  const s = (typeof w === "string" ? w : "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .slice(0, 40);
  return /^[a-z][a-z'-]*$/.test(s) ? s : "";
}

function cleanCard(word: string, raw: Partial<WordInfo> | undefined): WordInfo {
  return {
    word,
    lemma: str(raw?.lemma).toLowerCase() || word,
    ipa: str(raw?.ipa),
    senses: (Array.isArray(raw?.senses) ? raw!.senses! : [])
      .slice(0, 3)
      .map((s) => ({ pos: str(s?.pos), meaning_vi: str(s?.meaning_vi), example: str(s?.example), example_vi: str(s?.example_vi) }))
      .filter((s) => s.meaning_vi),
  };
}

const SENSES_RULE = `"senses": its 1-3 most common senses for a learner, most common first. For each: "pos" (noun, verb, adjective, adverb, preposition, conjunction, pronoun, determiner, phrase), "meaning_vi" (short Vietnamese meaning, a few words), "example" (a short, simple English sentence using the word), "example_vi" (its Vietnamese translation).`;

const wordsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["words"],
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "lemma", "ipa", "senses"],
        properties: { word: { type: "string" }, ...wordSchema.properties },
      },
    },
  },
} as const;

/** Cached cards for `words`; the missing ones are written by Workers AI in one call and cached in D1. */
async function cards(env: AppEnv["Bindings"], words: string[]): Promise<Record<string, WordInfo>> {
  const out: Record<string, WordInfo> = {};
  if (words.length === 0) return out;
  const { results } = await env.DB.prepare(`SELECT word, data FROM word_info WHERE word IN (${words.map((_, k) => `?${k + 1}`).join(",")})`)
    .bind(...words)
    .all<{ word: string; data: string }>();
  for (const r of results) out[r.word] = JSON.parse(r.data) as WordInfo;
  const missing = words.filter((w) => !out[w]);
  if (missing.length === 0) return out;

  const made: Record<string, Partial<WordInfo>> = {};
  if (missing.length === 1) {
    const w = missing[0];
    made[w] = (
      await runJson<Partial<WordInfo>>(env, {
        system: WORD_SYSTEM,
        prompt: `English word: "${w}"\n\nReturn:\n- "lemma": its base form (e.g. "went" -> "go", "children" -> "child"; the word itself if already basic).\n- "ipa": American IPA of "${w}" between slashes.\n- ${SENSES_RULE}`,
        schema: wordSchema,
        maxTokens: 600,
      })
    ).data;
  } else {
    const list =
      (
        await runJson<{ words?: (Partial<WordInfo> & { word?: string })[] }>(env, {
          system: WORD_SYSTEM,
          prompt: `English words: ${missing.map((w) => `"${w}"`).join(", ")}\n\nReturn "words": one entry per word, in the same order, each with:\n- "word": the word exactly as given.\n- "lemma": its base form (e.g. "went" -> "go"; the word itself if already basic).\n- "ipa": American IPA between slashes.\n- ${SENSES_RULE}`,
          schema: wordsSchema,
          maxTokens: Math.min(4000, 380 * missing.length),
        })
      ).data.words ?? [];
    list.forEach((item, k) => {
      const w = cleanWord(item?.word) || missing[k];
      if (missing.includes(w)) made[w] = item;
    });
  }
  const stmts: D1PreparedStatement[] = [];
  for (const w of missing) {
    const info = cleanCard(w, made[w]);
    if (!info.senses.length) continue;
    out[w] = info;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO word_info (word, data) VALUES (?1, ?2)").bind(w, JSON.stringify(info)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

/** A learner's word card: base form, IPA and up to three common senses with a Vietnamese meaning and an example. */
speech.get("/word", async (c) => {
  const word = cleanWord(c.req.query("w"));
  if (!word) return c.json({ error: "Không phải một từ tiếng Anh." }, 400);
  try {
    const card = (await cards(c.env, [word]))[word];
    return card ? c.json(card) : c.json({ error: "Chưa tra được từ này." }, 404);
  } catch (err) {
    if (err instanceof AiError) return c.json({ error: err.message }, err.status as 429 | 502);
    throw err;
  }
});

/** Several cards at once (up to 12): an exercise prefetches the words of its sentence so a tap is instant. */
speech.post("/words", async (c) => {
  const body = await c.req.json<{ words?: unknown }>().catch(() => ({}) as { words?: unknown });
  const words = [...new Set((Array.isArray(body.words) ? body.words : []).map(cleanWord).filter(Boolean))].slice(0, 12);
  try {
    return c.json({ cards: await cards(c.env, words) });
  } catch (err) {
    if (err instanceof AiError) return c.json({ error: err.message, cards: {} }, err.status as 429 | 502);
    throw err;
  }
});
