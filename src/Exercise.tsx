// Full-screen exercises, one item at a time: vocabulary (flashcards, match pairs, fill the gap,
// listen and pick), word bank, dictation, speaking (ELSA style), reading and quiz,
// then a completion screen with XP.
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowsIn,
  ArrowsOut,
  Check,
  Eraser,
  Lightbulb,
  MagnifyingGlass,
  Microphone,
  Play,
  Question,
  SpeakerHigh,
  Stop,
  Translate,
  X,
} from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type Grade, type LessonContent, type LessonDetail, type Me, type ProgressResult, type Quota, type Step } from "./api";
import { alignWords, norm, prefetchSpeech, speak, startRecording, stopSpeaking, words, type Recorder } from "./audio";
import { Mascot, useCompanion, type Mood } from "./Mascot";
import { Fx, STEPS } from "./meta";
import { sfx } from "./sound";

type Check = "idle" | "correct" | "wrong" | "reveal";

/** Vietnamese translation of sentence `i`, when the lesson has one. */
const viOf = (c: LessonContent, i: number) => c.sentences_vi?.[i]?.trim() || "";

const PRAISE = ["Tuyệt vời!", "Chính xác!", "Giỏi quá!", "Hay lắm!", "Đúng rồi!", "Xuất sắc!"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ---- Seeded shuffles and saved progress: a reloaded step continues where it was ----------------

/** The seed of the step being played; set by <Exercise> before its children render. */
let runSeed = 0;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random number generator. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles the same way for the same step seed and `salt`, so a reload sees the same order. */
function shuffle<T>(a: T[], salt: string): T[] {
  const rand = seeded(hashStr(`${runSeed}|${salt}`));
  const b = [...a];
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
}

/** A step's progress, kept for the browser session (sessionStorage). */
interface SavedRun {
  seed: number;
  total?: number;
  queue?: number[];
  pos?: number;
  scores?: (number | null)[];
  reviews?: number[];
  combo?: number;
}
function loadRun(key: string): SavedRun | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return v && typeof v.seed === "number" ? v : null;
  } catch {
    return null;
  }
}
function saveRun(key: string, patch: Partial<SavedRun>) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...loadRun(key), ...patch }));
  } catch {
    /* storage blocked: a reload just starts again */
  }
}
function clearRun(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** What every part of an exercise can reach: its saved-progress key, leaving, and the word lookup. */
interface ExApi {
  storeKey: string;
  leave: (href: string) => void;
  lookup: (word: string) => void;
  search: () => void;
}
const ExCtx = createContext<ExApi | null>(null);

// ---- Which sentences each step practises -------------------------------------------------------

/** At most this many sentences per step: shorter sessions, and each sentence practised in one way. */
const MAX_PER_STEP = 5;

/**
 * Listening, dictation and speaking each get their own third of the passage (sentences 0, 3, 6… / 1, 4, 7… /
 * 2, 5, 8…), so no sentence is ordered, typed and spoken in a row. Reading covers the whole passage.
 */
function sentencesFor(c: LessonContent, step: "listen" | "dictation" | "speak"): number[] {
  const all = c.sentences.map((_, k) => k);
  if (all.length < 3) return all;
  const r = { listen: 0, dictation: 1, speak: 2 }[step];
  return all.filter((k) => k % 3 === r).slice(0, MAX_PER_STEP);
}

/** A sentence's words, with the punctuation around each kept apart. */
interface Token {
  raw: string;
  pre: string;
  w: string;
  post: string;
}
function sentenceTokens(s: string): Token[] {
  return words(s).map((raw) => {
    const m = raw.match(/^([^\p{L}\p{N}']*)(.*?)([^\p{L}\p{N}']*)$/u)!;
    return { raw, pre: m[1], w: m[2], post: m[3] };
  });
}

const FUNCTION_WORDS = new Set(
  "a an the to of in on at for with from by my your his her its our their this that these those and but or so as than i you he she it we they me him us them is are was were be been am do does did have has had will would can could should not no".split(
    " ",
  ),
);

/**
 * Word-order tiles. Up to 8 words: one tile per word. Longer sentences are cut into phrases of 2 (or 3, above 14
 * words) at punctuation where possible, and a phrase never ends on a little word like "the" or "to".
 */
function phraseChunks(tokens: Token[]): string[] {
  const ws = tokens.filter((t) => t.w);
  if (ws.length <= 8) return ws.map((t) => t.w);
  const size = ws.length <= 14 ? 2 : 3;
  const out: string[][] = [];
  let cur: string[] = [];
  ws.forEach((t, k) => {
    cur.push(t.w);
    const last = k === ws.length - 1;
    const pause = /[,;:]/.test(t.post);
    const dangling = FUNCTION_WORDS.has(t.w.toLowerCase()) && !last && cur.length <= size;
    if (last || pause || (cur.length >= size && !dangling)) {
      out.push(cur);
      cur = [];
    }
  });
  // No lonely one-word phrase at the end.
  if (out.length > 1 && out[out.length - 1].length === 1) out[out.length - 2].push(...out.pop()!);
  return out.map((p) => p.join(" "));
}

export function Exercise({ lessonId, step, me, onGame }: { lessonId: number; step: string; me: Me; onGame: () => void }) {
  const [d, setD] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ score: number; res: ProgressResult } | null>(null);
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const info = STEPS.find((s) => s.key === step);
  const back = `#/lesson/${lessonId}`;

  // Progress of this step survives a reload (same browser tab): its seed fixes every shuffle.
  const storeKey = `wancha_run_${lessonId}_${step}`;
  const [seed] = useState(() => {
    const s = loadRun(storeKey)?.seed ?? Math.floor(Math.random() * 2 ** 31);
    saveRun(storeKey, { seed: s });
    return s;
  });
  runSeed = seed;

  useEffect(() => {
    api<LessonDetail>(`/api/lessons/${lessonId}`)
      .then(setD)
      .catch((e) => setError(e.message));
    return stopSpeaking;
  }, [lessonId]);

  // The browser's back button asks before leaving: an extra history entry catches it.
  const leaving = useRef<string | null>(null);
  const doneRef = useRef(false);
  doneRef.current = !!done;
  const leave = useCallback((href: string) => {
    stopSpeaking();
    // Fullscreen is for exercises; leave it when going back to the app.
    if (!/^#\/lesson\/\d+\/\w+/.test(href) && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (history.state?.exGuard) {
      // Drop the guard entry first, then replace the exercise entry: no stale exercise left in history.
      leaving.current = href;
      history.back();
    } else location.replace(href);
  }, []);
  useEffect(() => {
    const guard = `${lessonId}/${step}`;
    if (history.state?.exGuard !== guard) history.pushState({ exGuard: guard }, "", location.href);
    let gone = false;
    const own = location.hash;
    const onPop = () => {
      // A hash change made by location.replace() fires popstate too: once leaving, ignore the rest.
      if (gone) return;
      // Going somewhere else (a typed address, another link) is not the back button: let it go.
      if (location.hash !== own) {
        gone = true;
        return;
      }
      if (leaving.current !== null || doneRef.current) {
        gone = true;
        return location.replace(leaving.current ?? back);
      }
      history.pushState({ exGuard: guard }, "", location.href);
      setAsking(true);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [lessonId, step, back]);

  const ex = useMemo<ExApi>(
    () => ({ storeKey, leave, lookup: (w) => setWord(w), search: () => setSearching(true) }),
    [storeKey, leave],
  );

  const finish = async (score: number) => {
    try {
      const res = await api<ProgressResult>("/api/progress", { body: { lessonId, step, score } });
      clearRun(storeKey);
      sfx.complete();
      setDone({ score, res });
      onGame();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  let body: React.ReactNode;
  if (!info) body = <p className="error center">Không có bài tập “{step}”.</p>;
  else if (error)
    body = (
      <ExShell back={back} progress={0}>
        <p className="error center">{error}</p>
      </ExShell>
    );
  else if (!d)
    body = (
      <ExShell back={back} progress={0}>
        <div className="loading">
          <Fx name={info.fx} size={64} className="bob" />
        </div>
      </ExShell>
    );
  else if (done) body = <Complete lessonId={lessonId} stepKey={info.key} score={done.score} res={done.res} />;
  else {
    const c = d.lesson.content;
    const props = { c, back, lessonId, me, onFinish: finish };
    body = {
      words: <WordsRun {...props} />,
      listen: <WordBankRun {...props} />,
      dictation: <ClozeRun {...props} />,
      quiz: <QuizRun {...props} />,
      speak: <SpeakRun {...props} prior={d.sentences} />,
      read: <ReadRun {...props} />,
    }[info.key];
  }

  return (
    <ExCtx.Provider value={ex}>
      {body}
      {word && <WordPop raw={word} c={d?.lesson.content} onClose={() => setWord(null)} />}
      {searching && (
        <WordSearch
          onClose={() => setSearching(false)}
          onFind={(w) => {
            setSearching(false);
            setWord(w);
          }}
        />
      )}
      {asking && (
        <div className="overlay" onClick={() => setAsking(false)}>
          <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <Fx name="locked" size={56} tile className="dialog-fx" />
            <h2>Thoát bài tập?</h2>
            <p>Tiến độ được giữ lại: vào lại bài này, bạn sẽ học tiếp từ câu đang làm.</p>
            <div className="dialog-actions">
              <button className="btn ghost" onClick={() => leave(back)}>
                Thoát
              </button>
              <button className="btn primary" onClick={() => setAsking(false)} autoFocus>
                Học tiếp
              </button>
            </div>
          </div>
        </div>
      )}
    </ExCtx.Provider>
  );
}

interface RunProps {
  c: LessonContent;
  back: string;
  lessonId: number;
  me: Me;
  onFinish: (score: number) => void;
}

// ---- shell, footer, prompt ---------------------------------------------------------------

function ExShell({
  back,
  progress,
  combo = 0,
  review = null,
  children,
  footer,
}: {
  back: string;
  progress: number;
  combo?: number;
  review?: { left: number } | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ex = useContext(ExCtx);
  return (
    <div className="ex">
      <header className="ex-top">
        <a
          className="icon-btn"
          href={back}
          aria-label="Thoát"
          onClick={(e) => {
            if (!ex) return;
            e.preventDefault();
            ex.leave(back);
          }}
        >
          <X size={26} weight="bold" />
        </a>
        <div className="ex-progress grow">
          <span style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
        </div>
        {review && (
          <span className="review-pill" title="Ôn lại những câu chưa đúng">
            <ArrowCounterClockwise size={16} weight="bold" /> <span className="review-text">Ôn lại · còn</span> {review.left}
          </span>
        )}
        {combo >= 2 && (
          <span className="combo" key={combo}>
            <Fx name="fire" size={22} /> {combo}
          </span>
        )}
        {ex && (
          <button className="icon-btn" onClick={ex.search} aria-label="Tra từ" title="Tra từ">
            <MagnifyingGlass size={24} weight="bold" />
          </button>
        )}
        <FullscreenButton />
      </header>
      <div className="ex-scroll">
        <main className="ex-body">{children}</main>
      </div>
      {footer}
    </div>
  );
}

/** Fullscreen hides the browser's bars on phones. Hidden where the browser cannot do it (iPhone Safari). */
function FullscreenButton() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const fn = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fn);
    return () => document.removeEventListener("fullscreenchange", fn);
  }, []);
  if (!document.fullscreenEnabled) return null;
  return (
    <button
      className="icon-btn"
      onClick={() =>
        void (on ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: "hide" })).catch(() => {})
      }
      aria-label={on ? "Thoát toàn màn hình" : "Toàn màn hình"}
      title={on ? "Thoát toàn màn hình" : "Toàn màn hình"}
    >
      {on ? <ArrowsIn size={24} weight="bold" /> : <ArrowsOut size={24} weight="bold" />}
    </button>
  );
}

// ---- Word cards: fetched in batches before they are needed, kept for the visit ----------------

const cardCache = new Map<string, Promise<WordCard | null>>();
let pendingWords = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** "Hanoi." -> "hanoi"; "" when it is not an English word. */
function wordKey(raw: string): string {
  const w = raw.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, "");
  return /^[a-z][a-z'-]*$/.test(w) ? w : "";
}

/**
 * Words per request. The AI writes the words of one request one after another (8 new words took ~20 s on the live
 * site), so small requests run side by side: each word is ready about as fast as a single lookup (~6 s), and
 * cached ones come back in ~100 ms.
 */
const WORDS_PER_REQUEST = 2;

function flushWords() {
  flushTimer = null;
  const all = [...pendingWords];
  const list = all.slice(0, 12);
  pendingWords = new Set(all.slice(12));
  if (pendingWords.size) flushTimer = setTimeout(flushWords, 50);
  for (let k = 0; k < list.length; k += WORDS_PER_REQUEST) {
    const group = list.slice(k, k + WORDS_PER_REQUEST);
    const batch = api<{ cards: Record<string, WordCard> }>("/api/words", { body: { words: group } })
      .then((r) => r.cards ?? {})
      .catch(() => ({}) as Record<string, WordCard>);
    for (const w of group) {
      cardCache.set(
        w,
        batch.then((c) => {
          // Not written this time: forget it, so a tap asks again.
          if (!c[w]) cardCache.delete(w);
          return c[w] ?? null;
        }),
      );
    }
  }
}

/** Asks for the cards of the content words in `text` (batched), so tapping one of them is instant. */
function prefetchWords(text: string) {
  for (const tok of text.split(/\s+/)) {
    const w = wordKey(tok);
    if (w.length < 3 || FUNCTION_WORDS.has(w) || cardCache.has(w) || pendingWords.has(w)) continue;
    pendingWords.add(w);
  }
  if (pendingWords.size && !flushTimer) flushTimer = setTimeout(flushWords, 400);
}

/** One word's card: from the cache (or the batch writing it), else asked for on its own. */
function getCard(word: string): Promise<WordCard | null> {
  const w = wordKey(word);
  if (!w) return Promise.resolve(null);
  let p = cardCache.get(w);
  if (!p) {
    p = api<WordCard>(`/api/word?w=${encodeURIComponent(w)}`).catch(() => {
      cardCache.delete(w);
      return null;
    });
    cardCache.set(w, p);
  }
  return p;
}

/** English text whose words open the dictionary card when tapped (and are prefetched). */
function Say({ text }: { text: string }) {
  const ex = useContext(ExCtx);
  useEffect(() => {
    if (ex) prefetchWords(text);
  }, [ex, text]);
  return (
    <>
      {text.split(/(\s+)/).map((tok, j) =>
        !ex || /^\s*$/.test(tok) || !/[A-Za-z]/.test(tok) ? (
          tok
        ) : (
          <span
            key={j}
            className="lw"
            onClick={(e) => {
              e.stopPropagation();
              ex.lookup(tok);
            }}
          >
            {tok}
          </span>
        ),
      )}
    </>
  );
}

const NUDGE = ["Gần đúng rồi!", "Suýt nữa thôi!", "Chưa chuẩn lắm", "Thử lại nhé!"];

/**
 * The feedback card under an exercise. Correct: praise and "Tiếp tục". Wrong: a nudge with a hint,
 * "Thử lại" (fix your answer) or "Xem đáp án"; the answer stays hidden until then. Reveal: the answer
 * and "Tiếp tục". Enter triggers the main button.
 */
function Footer({
  state,
  canCheck,
  onCheck,
  onNext,
  onRetry,
  onReveal,
  detail,
  hint,
  checkLabel = "Kiểm tra",
  extra,
  retried = false,
}: {
  state: Check;
  canCheck: boolean;
  onCheck: () => void;
  onNext: () => void;
  onRetry?: () => void;
  onReveal?: () => void;
  /** Shown once the answer is known (correct or revealed). */
  detail?: React.ReactNode;
  /** Shown on a wrong answer, before the answer is revealed. */
  hint?: React.ReactNode;
  checkLabel?: string;
  extra?: React.ReactNode;
  retried?: boolean;
}) {
  const [praise, setPraise] = useState(() => pick(PRAISE));
  const [nudge, setNudge] = useState(() => pick(NUDGE));
  const main = state === "wrong" ? onRetry ?? onNext : onNext;
  useEffect(() => {
    if (state === "idle") {
      setPraise(pick(PRAISE));
      setNudge(pick(NUDGE));
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Enter" && main();
    const t = setTimeout(() => addEventListener("keydown", onKey), 150);
    return () => {
      clearTimeout(t);
      removeEventListener("keydown", onKey);
    };
  }, [state, main]);

  if (state === "idle") {
    return (
      <footer className="ex-foot idle">
        <div className="ex-foot-inner">
          {extra ?? <span />}
          <button className="btn primary wide" disabled={!canCheck} onClick={onCheck}>
            {checkLabel}
          </button>
        </div>
      </footer>
    );
  }

  const title = state === "correct" ? (retried ? "Sửa đúng rồi!" : praise) : state === "wrong" ? nudge : "Đáp án đây";
  const Icon = state === "correct" ? Check : state === "wrong" ? ArrowCounterClockwise : Lightbulb;
  return (
    <footer className={`ex-foot ${state}`}>
      <div className="ex-foot-inner">
        <div className="feedback-card" role="status">
          <span className="feedback-icon">
            <Icon size={24} weight="bold" />
          </span>
          <div className="feedback-text">
            <b>{title}</b>
            {state === "wrong" ? hint && <div className="feedback-detail">{hint}</div> : detail && <div className="feedback-detail">{detail}</div>}
          </div>
        </div>
        <div className="feedback-actions">
          {state === "wrong" && onReveal && (
            <button className="btn ghost" onClick={onReveal}>
              Xem đáp án
            </button>
          )}
          <button className={`btn wide ${state === "wrong" ? "warm" : "primary"}`} onClick={main} autoFocus>
            {state === "wrong" && onRetry ? (
              <>
                <ArrowCounterClockwise size={18} weight="bold" /> Thử lại
              </>
            ) : (
              "Tiếp tục"
            )}
          </button>
        </div>
      </div>
    </footer>
  );
}

/** Title, companion and speech bubble. `en` is English text (its words open the dictionary); `say` is anything else. */
function Prompt({ title, mood, say, en, children }: { title: string; mood: Mood; say?: React.ReactNode; en?: string; children?: React.ReactNode }) {
  const companion = useCompanion();
  return (
    <>
      <h1 className="ex-title">{title}</h1>
      <div className="ex-prompt">
        <div className="ex-mascot-frame">
          <Mascot name={companion} mood={mood} className="ex-mascot" shot="bust" />
        </div>
        <div className="ex-speech">
          {say && <div className="speech">{say}</div>}
          {en && (
            <div className="speech en">
              <Say text={en} />
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

function PlayButtons({ text, auto = true, size = "big" }: { text: string; auto?: boolean; size?: "big" | "small" }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => void speak(text, { rate: 0.95 }), 300);
    return () => clearTimeout(t);
  }, [text, auto]);
  return (
    <div className={`play-row ${size}`}>
      <button className="play" onClick={() => speak(text, { rate: 0.95 })} aria-label="Nghe">
        <SpeakerHigh size={size === "big" ? 34 : 22} weight="fill" />
      </button>
      <button className="play slow" onClick={() => speak(text, { rate: 0.6 })} aria-label="Nghe chậm">
        <span className="slow-label">0.6×</span>
      </button>
    </div>
  );
}

/** How many extra times a missed item comes back in the review round at the end. */
const MAX_REVIEWS = 2;

/**
 * Runs `total` items with check / continue. A wrong answer can be retried (the answer stays hidden),
 * then revealed; every item that was missed comes back in a review round at the end, until it is
 * answered right or has come back MAX_REVIEWS times. The score is the first appearance only: right
 * first time = full, right on a retry = 60 %, revealed = what the first try got.
 */
function useRunner(total: number, onFinish: (score: number) => void) {
  // A reload picks up the saved queue, position and scores of this step.
  const storeKey = useContext(ExCtx)?.storeKey ?? "";
  const [saved] = useState(() => {
    const r = storeKey ? loadRun(storeKey) : null;
    return r && r.total === total && r.queue && typeof r.pos === "number" && r.pos < r.queue.length ? r : null;
  });
  const [queue, setQueue] = useState(() => saved?.queue ?? Array.from({ length: total }, (_, k) => k));
  const [pos, setPos] = useState(saved?.pos ?? 0);
  const [state, setState] = useState<Check>("idle");
  const [attempt, setAttempt] = useState(0);
  const [combo, setCombo] = useState(saved?.combo ?? 0);
  const scores = useRef<(number | undefined)[]>((saved?.scores ?? []).map((x) => x ?? undefined));
  const reviews = useRef<number[]>(saved?.reviews ?? []);
  useEffect(() => {
    if (storeKey) saveRun(storeKey, { total, queue, pos, combo, scores: scores.current.map((x) => x ?? null), reviews: reviews.current });
    // Saved when the learner moves on, not on every keystroke inside an item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, total, queue, pos]);
  const i = queue[pos] ?? 0;
  const inReview = pos >= total;

  const mark = useCallback(
    (score: number, ok: boolean) => {
      if (!inReview) {
        const s = scores.current;
        if (attempt === 0) s[i] = score;
        else if (ok) s[i] = Math.max(s[i] ?? 0, Math.round(score * 0.6));
      }
      setState(ok ? "correct" : attempt >= 1 ? "reveal" : "wrong");
      setAttempt((a) => a + 1);
      setCombo((c) => (ok && attempt === 0 ? c + 1 : 0));
      if (ok) sfx.correct();
      else sfx.wrong();
    },
    [i, attempt, inReview],
  );
  const retry = useCallback(() => setState("idle"), []);
  const reveal = useCallback(() => setState("reveal"), []);
  const next = useCallback(() => {
    let q = queue;
    const missed = attempt > 1 || state === "reveal";
    if (missed && (reviews.current[i] ?? 0) < MAX_REVIEWS) {
      reviews.current[i] = (reviews.current[i] ?? 0) + 1;
      q = [...queue, i];
      setQueue(q);
    }
    if (pos + 1 >= q.length) {
      const avg = scores.current.slice(0, total).reduce<number>((a, b) => a + (b ?? 0), 0) / Math.max(1, total);
      onFinish(Math.round(avg));
      return;
    }
    setPos(pos + 1);
    setState("idle");
    setAttempt(0);
  }, [queue, pos, i, attempt, state, total, onFinish]);
  /** For items that are not graded (flashcards): count as full marks and move on. */
  const pass = useCallback(() => {
    scores.current[i] = 100;
    next();
  }, [i, next]);
  return {
    i,
    /** Changes for every appearance of an item, so a reviewed item starts fresh. */
    key: pos,
    state,
    mark,
    retry,
    reveal,
    next,
    pass,
    combo,
    retried: attempt > 1,
    review: inReview ? { left: queue.length - pos } : null,
    progress: (pos + (state === "idle" || state === "wrong" ? 0 : 1)) / queue.length,
  };
}

function moodFor(state: Check): Mood {
  return state === "correct" ? "happy" : state === "wrong" ? "think" : state === "reveal" ? "oops" : "idle";
}

// ---- Words: flashcards, match pairs, fill the gap, listen & pick -----------------------------

type Vocab = LessonContent["vocabulary"][number];
type WordItem =
  | { kind: "cards"; vocab: Vocab[] }
  | { kind: "match"; vocab: Vocab[] }
  | { kind: "gap"; v: Vocab; before: string; after: string; options: string[] }
  | { kind: "hear"; v: Vocab; options: string[] };

function buildWordItems(c: LessonContent): WordItem[] {
  const vocab = c.vocabulary.filter((v) => v.word.trim());
  if (vocab.length === 0) return [];
  const others = (v: Vocab, n: number, salt: string) =>
    shuffle(vocab.filter((o) => o.word.toLowerCase() !== v.word.toLowerCase()).map((o) => o.word), salt + v.word).slice(0, n);
  const items: WordItem[] = [{ kind: "cards", vocab }];
  const gaps: WordItem[] = [];
  for (const v of shuffle(vocab, "gaps")) {
    const at = v.example.toLowerCase().indexOf(v.word.toLowerCase());
    if (at < 0 || vocab.length < 3) continue;
    gaps.push({
      kind: "gap",
      v,
      before: v.example.slice(0, at),
      after: v.example.slice(at + v.word.length),
      options: shuffle([v.word, ...others(v, 3, "gap-o")], "gap" + v.word),
    });
  }
  if (vocab.length >= 3) items.push({ kind: "match", vocab: shuffle(vocab, "match").slice(0, 5) });
  items.push(...gaps.slice(0, 2));
  if (vocab.length >= 3) {
    for (const v of shuffle(vocab, "hear").slice(0, 2)) items.push({ kind: "hear", v, options: shuffle([v.word, ...others(v, 3, "hear-o")], "hear" + v.word) });
  }
  items.push(...gaps.slice(2, 4));
  return items;
}

function WordsRun({ c, back, onFinish }: RunProps) {
  const items = useMemo(() => buildWordItems(c), [c]);
  const run = useRunner(Math.max(1, items.length), onFinish);
  const item = items[run.i];
  if (!item)
    return (
      <ExShell back={back} progress={1}>
        <p className="muted center">Bài này chưa có từ vựng.</p>
      </ExShell>
    );
  if (item.kind === "cards") return <CardsItem key={run.key} vocab={item.vocab} back={back} run={run} total={items.length} />;
  if (item.kind === "match") return <MatchItem key={run.key} vocab={item.vocab} back={back} run={run} />;
  return <ChoiceItem key={run.key} item={item} back={back} run={run} />;
}

type Run = ReturnType<typeof useRunner>;

function CardsItem({ vocab, back, run, total }: { vocab: Vocab[]; back: string; run: Run; total: number }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const flip = (k: number) => {
    sfx.tap();
    if (!flipped.has(k)) void speak(vocab[k].word);
    setFlipped((f) => {
      const n = new Set(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  return (
    <ExShell
      back={back}
      progress={0.5 / total}
      footer={
        <footer className="ex-foot idle">
          <div className="ex-foot-inner">
            <span className="muted small">
              Đã lật {flipped.size}/{vocab.length} thẻ
            </span>
            <button className="btn primary wide" onClick={run.pass}>
              {flipped.size >= vocab.length ? "Đã nhớ hết" : "Tiếp tục"}
            </button>
          </div>
        </footer>
      }
    >
      <Prompt title="Làm quen từ mới" mood="happy" say="Bấm vào từng thẻ để nghe và xem nghĩa nhé!" />
      <div className="flash-grid">
        {vocab.map((v, k) => (
          <button key={v.word} className={flipped.has(k) ? "flash flipped" : "flash"} onClick={() => flip(k)} aria-pressed={flipped.has(k)}>
            <span className="flash-inner">
              <span className="flash-front">
                <b>{v.word}</b>
                <span className="ipa">{v.ipa}</span>
                <span className="pos">{v.pos}</span>
              </span>
              <span className="flash-back">
                <b>{v.meaning_vi}</b>
                <i>{v.example}</i>
                {v.example_vi && <em>{v.example_vi}</em>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </ExShell>
  );
}

function MatchItem({ vocab, back, run }: { vocab: Vocab[]; back: string; run: Run }) {
  const left = useMemo(() => shuffle(vocab.map((v, k) => ({ k, text: v.word })), "match-l"), [vocab]);
  const right = useMemo(() => shuffle(vocab.map((v, k) => ({ k, text: v.meaning_vi })), "match-r"), [vocab]);
  const [selL, setSelL] = useState<number | null>(null);
  const [selR, setSelR] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [shake, setShake] = useState<[number, number] | null>(null);
  const mistakes = useRef(0);

  const tryPair = (l: number | null, r: number | null) => {
    setSelL(l);
    setSelR(r);
    if (l === null || r === null) return;
    if (l === r) {
      sfx.correct();
      const n = new Set(matched).add(l);
      setMatched(n);
      setSelL(null);
      setSelR(null);
      if (n.size === vocab.length) {
        const score = Math.max(40, 100 - mistakes.current * 15);
        setTimeout(() => run.mark(score, true), 350);
      }
    } else {
      sfx.wrong();
      mistakes.current += 1;
      setShake([l, r]);
      setTimeout(() => {
        setShake(null);
        setSelL(null);
        setSelR(null);
      }, 450);
    }
  };

  const cls = (side: "l" | "r", k: number) => {
    const sel = side === "l" ? selL : selR;
    if (matched.has(k)) return "pair matched";
    if (shake && shake[side === "l" ? 0 : 1] === k) return "pair bad";
    return sel === k ? "pair sel" : "pair";
  };

  return (
    <ExShell
      back={back}
      progress={run.progress}
      combo={run.combo}
      footer={
        <Footer
          state={run.state}
          canCheck={false}
          onCheck={() => {}}
          onNext={run.next}
          checkLabel={`${matched.size}/${vocab.length} cặp`}
          detail={mistakes.current ? `Sai ${mistakes.current} lần` : "Không sai lần nào!"}
        />
      }
    >
      <Prompt title="Ghép từ với nghĩa" mood={run.state === "correct" ? "cheer" : "idle"} say="Chọn một từ bên trái rồi chọn nghĩa đúng bên phải." />
      <div className="match">
        <div className="match-col">
          {left.map(({ k, text }) => (
            <button
              key={k}
              className={cls("l", k)}
              disabled={matched.has(k) || run.state !== "idle"}
              onClick={() => {
                sfx.tap();
                void speak(text);
                if (!shake) tryPair(k, selR);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="match-col">
          {right.map(({ k, text }) => (
            <button
              key={k}
              className={cls("r", k)}
              disabled={matched.has(k) || run.state !== "idle"}
              onClick={() => {
                sfx.tap();
                if (!shake) tryPair(selL, k);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </ExShell>
  );
}

function ChoiceItem({ item, back, run }: { item: Extract<WordItem, { kind: "gap" | "hear" }>; back: string; run: Run }) {
  const [sel, setSel] = useState<string | null>(null);
  const answer = item.v.word;
  const check = () => {
    const ok = sel === answer;
    run.mark(ok ? 100 : 0, ok);
    if (item.kind === "gap") void speak(item.v.example, { rate: 0.95 });
  };
  return (
    <ExShell
      back={back}
      progress={run.progress}
      combo={run.combo}
      review={run.review}
      footer={
        <Footer
          state={run.state}
          canCheck={sel !== null}
          onCheck={check}
          onNext={run.next}
          onRetry={() => {
            setSel(null);
            run.retry();
          }}
          onReveal={run.reveal}
          retried={run.retried}
          hint={item.kind === "gap" ? "Đọc lại cả câu rồi chọn từ khác xem." : "Bấm loa nghe lại rồi chọn từ khác xem."}
          detail={
            <>
              {run.state === "reveal" && <div>Đáp án: {answer}</div>}
              <span>
                <b>{item.v.word}</b> {item.v.ipa}: {item.v.meaning_vi}
              </span>
              {item.kind === "gap" && (
                <span className="vi">
                  <Say text={item.v.example} />
                  {item.v.example_vi ? ` — ${item.v.example_vi}` : ""}
                </span>
              )}
            </>
          }
        />
      }
    >
      {item.kind === "gap" ? (
        <>
          <Prompt title="Điền từ còn thiếu" mood={moodFor(run.state)} />
          <p className="gap-sentence">
            <Say text={item.before} />
            <span className={`blank ${sel ? "filled" : ""} ${run.state}`}>{run.state === "reveal" ? answer : sel ?? " ".repeat(8)}</span>
            <Say text={item.after} />
          </p>
        </>
      ) : (
        <Prompt title="Nghe và chọn từ đúng" mood={moodFor(run.state)}>
          <PlayButtons text={answer} />
        </Prompt>
      )}
      <div className="options grid2">
        {item.options.map((o) => {
          const known = run.state === "correct" || run.state === "reveal";
          const cls = known && o === answer ? "right" : run.state !== "idle" && sel === o ? "wrong" : sel === o ? "sel" : "";
          return (
            <button
              key={o}
              className={`option ${cls}`}
              disabled={run.state !== "idle"}
              onClick={() => {
                sfx.tap();
                setSel(o);
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </ExShell>
  );
}

// ---- Listen: word bank -----------------------------------------------------------------------

interface Tile {
  id: number;
  text: string;
}

function tileWords(s: string): string[] {
  return words(s)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);
}

function WordBankRun({ c, back, onFinish }: RunProps) {
  // Only this step's third of the passage; long sentences come as phrase tiles.
  const order = useMemo(() => sentencesFor(c, "listen"), [c]);
  const run = useRunner(order.length, onFinish);
  const { i, state, mark, next, progress, combo } = run;
  const idx = order[i];
  const sentence = c.sentences[idx];
  const vi = viOf(c, idx);
  const wordCount = useMemo(() => sentenceTokens(sentence).filter((t) => t.w).length, [sentence]);
  const target = useMemo(() => phraseChunks(sentenceTokens(sentence)), [sentence]);
  const chunked = target.length < wordCount;
  const bank = useMemo<Tile[]>(() => {
    const have = new Set(target.flatMap((t) => t.split(" ")).map(norm));
    const pool = shuffle(
      c.sentences.flatMap(tileWords).filter((w) => !have.has(norm(w)) && w.length > 2),
      "pool" + idx,
    );
    const extras = [...new Set(pool.map((w) => w.toLowerCase()))].slice(0, chunked ? 2 : Math.min(3, Math.max(2, Math.floor(target.length / 4))));
    return shuffle([...target, ...extras], "bank" + idx).map((text, id) => ({ id, text }));
  }, [target, c.sentences, idx, chunked]);
  useEffect(() => {
    const nextIdx = order[i + 1];
    if (nextIdx !== undefined) prefetchSpeech(c.sentences[nextIdx]);
  }, [order, i, c.sentences]);
  const maxHints = Math.max(1, Math.floor(target.length / 3));

  // One slot per word of the sentence. A slot holds a bank tile id; hinted and confirmed slots are locked.
  // The state belongs to one appearance of a sentence: the next one (or its review) starts empty.
  const fresh = (): Board => ({
    key: run.key,
    slots: target.map(() => null),
    locked: target.map(() => false),
    hints: 0,
    sel: null,
    marks: null,
    showVi: false,
  });
  const [stored, setBoard] = useState<Board>(fresh);
  const b = stored.key === run.key && stored.slots.length === target.length ? stored : fresh();
  const update = (patch: Partial<Board>) => setBoard({ ...b, ...patch });
  const idle = state === "idle";
  const textOf = (id: number | null) => (id === null ? "" : bank[id].text);
  const placed = new Set(b.slots.filter((x): x is number => x !== null));
  const filled = placed.size;

  // ---- FLIP: every word that changes place glides from where it was ----
  const flipFrom = useRef<Map<number, DOMRect> | null>(null);
  const tileEl = (id: number) =>
    document.querySelector<HTMLElement>(`[data-slot-tile="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-bank-tile="${id}"]:not(.used)`);
  /** Remembers where each word is before a change; a dropped word starts from the floating copy instead. */
  const remember = (dropped?: Dropped) => {
    const m = new Map<number, DOMRect>();
    for (const t of bank) {
      const el = tileEl(t.id);
      if (el) m.set(t.id, el.getBoundingClientRect());
    }
    if (dropped) m.set(dropped.id, dropped.rect);
    flipFrom.current = m;
  };
  useLayoutEffect(() => {
    const m = flipFrom.current;
    flipFrom.current = null;
    if (!m || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, r] of m) {
      const el = tileEl(id);
      if (!el) continue;
      const n = el.getBoundingClientRect();
      const dx = r.left - n.left;
      const dy = r.top - n.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
        duration: 340,
        easing: "cubic-bezier(.2, .9, .3, 1.15)",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  /** Puts a tile into slot `to` (default: the selected slot, else the first empty one). Moving between slots swaps. */
  const put = (id: number, to: number | null = b.sel ?? b.slots.indexOf(null), dropped?: Dropped) => {
    if (to === null || to < 0 || b.locked[to]) return;
    const slots = [...b.slots];
    const from = slots.indexOf(id);
    if (from === to) return;
    if (from >= 0) {
      if (b.locked[from]) return;
      slots[from] = slots[to]; // swap (or leave the old slot empty)
    }
    slots[to] = id; // a tile pushed out of `to` by a bank tile simply goes back to the bank
    sfx.tap();
    remember(dropped);
    update({ slots, sel: null });
  };
  /**
   * Inserts a tile just before slot `before` (0..length). Locked slots stay put; the unlocked words from there on
   * shift towards the nearest empty slot (often the one the tile came from). With no empty slot, the last word
   * goes back to the bank.
   */
  const insertAt = (id: number, before: number, dropped?: Dropped) => {
    const free = target.map((_, k) => k).filter((k) => !b.locked[k]);
    const words = free.map((k) => b.slots[k]);
    const from = words.indexOf(id);
    if (from >= 0) words[from] = null; // leave a hole where it was
    const at = free.filter((k) => k < before).length;
    words.splice(at, 0, id);
    const after = words.indexOf(null, at + 1);
    const hole = after >= 0 ? after : words.lastIndexOf(null, at - 1);
    words.splice(hole >= 0 ? hole : words.length - 1, 1);
    const slots = [...b.slots];
    free.forEach((k, j) => (slots[k] = words[j]));
    if (slots.every((x, k) => x === b.slots[k])) return;
    sfx.tap();
    remember(dropped);
    update({ slots, sel: null });
  };
  const takeOut = (k: number, dropped?: Dropped) => {
    if (b.locked[k] || b.slots[k] === null) return;
    sfx.tap();
    remember(dropped);
    update({ slots: b.slots.map((x, j) => (j === k ? null : x)), sel: null });
  };
  const clearAll = () => {
    remember();
    update({ slots: b.slots.map((x, k) => (b.locked[k] ? x : null)), sel: null });
  };

  /** Fills one random empty or wrong slot with the right word and locks it. */
  const hint = () => {
    const open = target.map((_, k) => k).filter((k) => !b.locked[k] && norm(textOf(b.slots[k])) !== norm(target[k]));
    if (open.length === 0 || b.hints >= maxHints) return;
    const k = open[Math.floor(Math.random() * open.length)];
    const want = norm(target[k]);
    const candidates = bank.filter((t) => norm(t.text) === want).map((t) => t.id);
    // Prefer a tile still in the bank, then one sitting in a slot where it is wrong.
    const id =
      candidates.find((t) => !placed.has(t)) ??
      candidates.find((t) => {
        const j = b.slots.indexOf(t);
        return j >= 0 && !b.locked[j] && norm(target[j]) !== want;
      });
    if (id === undefined) return;
    const slots = b.slots.map((x) => (x === id ? null : x));
    slots[k] = id;
    sfx.correct();
    void speak(target[k], { rate: 0.95 });
    remember();
    update({ slots, locked: b.locked.map((l, j) => l || j === k), hints: b.hints + 1, sel: null });
  };

  const check = () => {
    const marks = target.map((w, k) => norm(textOf(b.slots[k])) === norm(w));
    const right = marks.filter(Boolean).length;
    const ok = right === target.length;
    update({ marks, sel: null });
    // Each hint costs 15 points; a wrong first try earns credit for the words in the right place.
    mark(ok ? Math.max(40, 100 - 15 * b.hints) : Math.round((right / target.length) * 60), ok);
  };
  /** Try again: the words already in the right place stay (locked); only the red ones go back to the bank. */
  const retry = () => {
    const m = b.marks ?? [];
    remember();
    update({ slots: b.slots.map((x, k) => (m[k] ? x : null)), locked: b.locked.map((l, k) => l || !!m[k]), marks: null, sel: null });
    run.retry();
  };

  // ---- Drag and drop (mouse and touch, via pointer events) ----
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const [over, setOver] = useState<Drop>(null);
  const dragged = useRef(false);
  const ghost = useRef<HTMLDivElement>(null);
  /**
   * Where a drop at (x, y) lands: an empty slot is filled; on a word, its left half inserts before it and its right
   * half after it; in a gap between slots, the nearest slot decides.
   */
  const dropAt = (x: number, y: number, id: number): Drop => {
    const el = document.elementFromPoint(x, y);
    if (el?.closest(".wb-bank")) return "bank";
    let slot = el?.closest<HTMLElement>("[data-slot]") ?? null;
    if (!slot && el?.closest(".wb-slots")) {
      let best = Infinity;
      for (const s of document.querySelectorAll<HTMLElement>("[data-slot]")) {
        const r = s.getBoundingClientRect();
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom) * 3);
        if (d < best) [best, slot] = [d, s];
      }
    }
    if (!slot) return null;
    const k = Number(slot.dataset.slot);
    if (b.slots[k] === null) return b.locked[k] ? null : { slot: k };
    if (b.slots[k] === id) return null;
    const r = slot.getBoundingClientRect();
    return { before: x < r.left + r.width / 2 ? k : k + 1 };
  };
  const startDrag = (e: React.PointerEvent, id: number) => {
    if (!idle || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moving = false;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
      moving = true;
      dragged.current = true;
      ev.preventDefault();
      setDrag({ id, x: ev.clientX, y: ev.clientY });
      setOver(dropAt(ev.clientX, ev.clientY, id));
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      // The floating copy is still on screen here: the dropped word glides on from where it was let go.
      const box = ghost.current?.getBoundingClientRect();
      const dropped = box ? { id, rect: box } : undefined;
      setDrag(null);
      setOver(null);
      if (!moving) return;
      // The click that may follow this pointerup is swallowed by `tapped`; after that, taps count again.
      setTimeout(() => (dragged.current = false), 0);
      const to = dropAt(ev.clientX, ev.clientY, id);
      const from = b.slots.indexOf(id);
      if (to === "bank") {
        if (from >= 0) takeOut(from, dropped);
      } else if (to && "slot" in to) put(id, to.slot, dropped);
      else if (to) insertAt(id, to.before, dropped);
    };
    addEventListener("pointermove", move, { passive: false });
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };
  /** A click that ends a drag is not a tap. */
  const tapped = (fn: () => void) => () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    fn();
  };

  const hintsLeft = maxHints - b.hints;
  return (
    <ExShell
      back={back}
      progress={progress}
      combo={combo}
      review={run.review}
      footer={
        <Footer
          state={state}
          canCheck={filled === target.length}
          checkLabel={filled === target.length ? "Kiểm tra" : `Còn ${target.length - filled} ô trống`}
          onCheck={check}
          onNext={next}
          onRetry={retry}
          onReveal={run.reveal}
          retried={run.retried}
          hint="Ô màu đỏ chưa đúng chỗ. Bấm “Thử lại”: từ đúng được giữ lại, bạn chỉ cần xếp lại các ô đỏ."
          detail={
            <>
              <div>
                {state === "reveal" ? "Đáp án: " : ""}
                <Say text={sentence} />
              </div>
              {vi && <span className="vi">{vi}</span>}
            </>
          }
          extra={
            <button
              className="btn ghost"
              onClick={() => {
                mark(0, false);
                run.reveal();
              }}
            >
              Bỏ qua
            </button>
          }
        />
      }
    >
      <Prompt title="Nghe và xếp lại câu" mood={moodFor(state)}>
        <PlayButtons text={sentence} />
      </Prompt>

      <p className="wb-help small muted">
        Câu có <b>{wordCount} từ</b>
        {chunked && (
          <>
            , chia thành <b>{target.length} cụm</b>
          </>
        )}
        . Bấm hoặc kéo {chunked ? "cụm từ" : "từ"} vào ô; bấm vào ô để bỏ ra.
      </p>
      <div className="wb-slots" role="group" aria-label={`Câu có ${target.length} từ`}>
        {target.map((_, k) => {
          const id = b.slots[k];
          // While inserting: a caret in the gap, and the two neighbours step aside.
          const ins = over && over !== "bank" && "before" in over ? over.before : -1;
          const cls = [
            "wb-slot",
            id === null ? "empty" : "tile",
            b.locked[k] ? "locked" : "",
            b.sel === k ? "sel" : "",
            over && over !== "bank" && "slot" in over && over.slot === k ? "over" : "",
            ins === k ? "push-right ins-before" : "",
            ins === k + 1 ? (k === target.length - 1 ? "push-left ins-after" : "push-left") : "",
            b.marks ? (b.marks[k] ? "right" : "wrong") : "",
            drag && drag.id === id ? "dragging" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={k}
              data-slot={k}
              data-slot-tile={id ?? undefined}
              className={cls}
              disabled={!idle || b.locked[k]}
              aria-label={id === null ? `Ô ${k + 1}, trống` : `Ô ${k + 1}: ${textOf(id)}`}
              onPointerDown={id !== null && !b.locked[k] ? (e) => startDrag(e, id) : undefined}
              onClick={tapped(() => (id === null ? update({ sel: b.sel === k ? null : k }) : takeOut(k)))}
            >
              {id === null ? target[k].split(" ").map(() => "…").join(" ") : textOf(id)}
            </button>
          );
        })}
      </div>

      <div className="wb-tools">
        <button className="btn small ghost" disabled={!idle || hintsLeft <= 0} onClick={hint}>
          <Lightbulb size={16} weight="fill" /> Gợi ý {hintsLeft > 0 ? `(còn ${hintsLeft})` : "(hết lượt)"}
        </button>
        {vi && (
          <button className={b.showVi ? "btn small ghost on" : "btn small ghost"} onClick={() => update({ showVi: !b.showVi })} aria-pressed={b.showVi}>
            <Translate size={16} weight="bold" /> Nghĩa tiếng Việt
          </button>
        )}
        <button className="btn small ghost" disabled={!idle || b.slots.every((x, k) => x === null || b.locked[k])} onClick={clearAll}>
          <Eraser size={16} weight="bold" /> Xoá hết
        </button>
      </div>
      {b.showVi && vi && <p className="wb-vi">{vi}</p>}

      <div className={over === "bank" ? "bank wb-bank over" : "bank wb-bank"}>
        {bank.map((t) => {
          const used = placed.has(t.id);
          return (
            <button
              key={t.id}
              data-bank-tile={t.id}
              className={used ? "tile used" : drag?.id === t.id ? "tile dragging" : "tile"}
              disabled={used || !idle}
              onPointerDown={(e) => startDrag(e, t.id)}
              onClick={tapped(() => {
                void speak(t.text, { rate: 0.95 });
                put(t.id);
              })}
            >
              {t.text}
            </button>
          );
        })}
      </div>


      {drag && (
        <div ref={ghost} className="tile wb-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {bank[drag.id].text}
        </div>
      )}
    </ExShell>
  );
}

/** Where a dragged word would land: fill an empty slot, insert before slot `before` (0..length), or the bank. */
type Drop = { slot: number } | { before: number } | "bank" | null;
/** A word just dropped, and the box of its floating copy at that moment. */
type Dropped = { id: number; rect: DOMRect };

interface Board {
  key: number;
  slots: (number | null)[];
  locked: boolean[];
  hints: number;
  /** The empty slot the next tapped word goes into. */
  sel: number | null;
  /** After "Kiểm tra": which slots are right. */
  marks: boolean[] | null;
  showVi: boolean;
}

// ---- Dictation ---------------------------------------------------------------------------------

// Dictation: hear the sentence, type only the 2-4 missing key words (lesson vocabulary first).
const CLOZE_STOP = new Set([...FUNCTION_WORDS, ..."there here then when what which who how very just also into about".split(" ")]);

/** The words to blank: lesson vocabulary first, then the longest content words; 2-4 per sentence, in order. */
function pickBlanks(tokens: Token[], c: LessonContent, salt: string): number[] {
  const vocab = new Set(c.vocabulary.flatMap((v) => v.word.toLowerCase().split(/\s+/)));
  const cand = tokens.map((t, k) => ({ k, w: t.w.toLowerCase() })).filter((t) => t.w.length >= 3 && !CLOZE_STOP.has(t.w));
  const fromVocab = shuffle(
    cand.filter((t) => vocab.has(t.w)),
    salt + "v",
  );
  const rest = shuffle(
    cand.filter((t) => !vocab.has(t.w)),
    salt + "r",
  ).sort((a, b) => b.w.length - a.w.length);
  const count = Math.max(2, Math.min(4, Math.round(tokens.length / 5)));
  const picked = [...new Set([...fromVocab, ...rest].map((t) => t.k))].slice(0, count);
  if (picked.length === 0 && tokens.some((t) => t.w)) picked.push(tokens.findIndex((t) => t.w));
  return picked.sort((a, b) => a - b);
}

interface Cloze {
  key: number;
  vals: Record<number, string>;
  locked: Record<number, boolean>;
  marks: Record<number, boolean> | null;
}

function ClozeRun({ c, back, onFinish }: RunProps) {
  const order = useMemo(() => sentencesFor(c, "dictation"), [c]);
  const run = useRunner(order.length, onFinish);
  const { i, state, mark, next, progress, combo } = run;
  const idx = order[i];
  const sentence = c.sentences[idx];
  const vi = viOf(c, idx);
  const tokens = useMemo(() => sentenceTokens(sentence), [sentence]);
  const blanks = useMemo(() => pickBlanks(tokens, c, "cloze" + idx), [tokens, c, idx]);
  const fresh = (): Cloze => ({ key: run.key, vals: {}, locked: {}, marks: null });
  const [stored, setCloze] = useState<Cloze>(fresh);
  const z = stored.key === run.key ? stored : fresh();
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  const idle = state === "idle";
  const open = blanks.filter((k) => !z.locked[k]);
  const filled = open.every((k) => (z.vals[k] ?? "").trim());

  useEffect(() => {
    const nextIdx = order[i + 1];
    if (nextIdx !== undefined) prefetchSpeech(c.sentences[nextIdx]);
  }, [order, i, c.sentences]);
  // Focus the first empty blank when a sentence (or a retry) starts.
  useEffect(() => {
    if (!idle) return;
    const k = blanks.find((b) => !z.locked[b] && !(z.vals[b] ?? "").trim());
    if (k !== undefined) setTimeout(() => inputs.current[k]?.focus({ preventScroll: true }), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.key, idle]);

  const focusNext = (from: number) => {
    const k = blanks.find((b) => b > from && !z.locked[b]) ?? blanks.find((b) => !z.locked[b] && !(z.vals[b] ?? "").trim());
    if (k !== undefined && k !== from) inputs.current[k]?.focus();
  };
  const check = () => {
    const marks = Object.fromEntries(blanks.map((k) => [k, norm(z.vals[k] ?? "") === norm(tokens[k].w)]));
    const right = blanks.filter((k) => marks[k]).length;
    setCloze({ ...z, marks });
    mark(Math.round((right / blanks.length) * 100), right === blanks.length);
  };
  /** Try again: the right words stay (locked), the wrong ones are cleared. */
  const retry = () => {
    const m = z.marks ?? {};
    setCloze({
      ...z,
      vals: Object.fromEntries(blanks.filter((k) => m[k] || z.locked[k]).map((k) => [k, z.vals[k] ?? ""])),
      locked: Object.fromEntries(blanks.map((k) => [k, !!(m[k] || z.locked[k])])),
      marks: null,
    });
    run.retry();
  };
  const right = z.marks ? blanks.filter((k) => z.marks![k]).length : 0;

  return (
    <ExShell
      back={back}
      progress={progress}
      combo={combo}
      review={run.review}
      footer={
        <Footer
          state={state}
          canCheck={filled}
          checkLabel={filled ? "Kiểm tra" : `Điền ${open.filter((k) => !(z.vals[k] ?? "").trim()).length} ô còn trống`}
          onCheck={check}
          onNext={next}
          onRetry={retry}
          onReveal={run.reveal}
          retried={run.retried}
          hint={`Đúng ${right}/${blanks.length} từ. Nghe lại rồi sửa các ô đỏ nhé.`}
          detail={
            <>
              <div>
                <Say text={sentence} />
              </div>
              {vi && <span className="vi">{vi}</span>}
            </>
          }
          extra={
            <button
              className="btn ghost"
              onClick={() => {
                mark(0, false);
                run.reveal();
              }}
            >
              Bỏ qua
            </button>
          }
        />
      }
    >
      <Prompt title="Nghe và điền từ còn thiếu" mood={moodFor(state)}>
        <PlayButtons text={sentence} />
      </Prompt>
      <p className="cloze">
        {tokens.map((t, k) => {
          const space = k < tokens.length - 1 ? " " : "";
          if (!blanks.includes(k)) {
            return (
              <span key={k}>
                <Say text={t.raw} />
                {space}
              </span>
            );
          }
          const shown = state === "reveal" && !z.locked[k] && !z.marks?.[k] ? t.w : (z.vals[k] ?? "");
          const cls = z.locked[k] ? "locked" : z.marks ? (z.marks[k] ? "right" : "wrong") : state === "reveal" ? "reveal" : "";
          return (
            <span key={k} className="cloze-item">
              {t.pre}
              <input
                ref={(el) => {
                  inputs.current[k] = el;
                }}
                className={`cloze-input ${cls}`}
                value={shown}
                size={Math.max(3, t.w.length)}
                style={{ width: `${Math.max(3, t.w.length) + 1.2}ch` }}
                disabled={!idle || z.locked[k]}
                onChange={(e) => setCloze({ ...z, vals: { ...z.vals, [k]: e.target.value.replace(/\s/g, "") } })}
                onKeyDown={(e) => {
                  if (e.key === " " || (e.key === "Enter" && !filled)) {
                    e.preventDefault();
                    focusNext(k);
                  } else if (e.key === "Enter" && filled && idle) {
                    e.preventDefault();
                    check();
                  }
                }}
                aria-label={`Từ còn thiếu số ${blanks.indexOf(k) + 1}`}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="next"
              />
              {t.post}
              {space}
            </span>
          );
        })}
      </p>
      <p className="wb-help small muted">Gõ từ bạn nghe được vào mỗi ô. Dấu cách hoặc Enter để sang ô tiếp theo.</p>
    </ExShell>
  );
}

// ---- Quiz --------------------------------------------------------------------------------------

function QuizRun({ c, back, onFinish }: RunProps) {
  const total = Math.max(1, c.questions.length);
  const run = useRunner(total, onFinish);
  const { i, state, mark, next, progress, combo } = run;
  const q = c.questions[i];
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [run.key]);
  if (!q)
    return (
      <ExShell back={back} progress={1}>
        <p className="muted center">Bài này không có câu hỏi.</p>
      </ExShell>
    );

  return (
    <ExShell
      back={back}
      progress={progress}
      combo={combo}
      review={run.review}
      footer={
        <Footer
          state={state}
          canCheck={sel !== null}
          onCheck={() => mark(sel === q.answer_index ? 100 : 0, sel === q.answer_index)}
          onNext={next}
          onRetry={() => {
            setSel(null);
            run.retry();
          }}
          onReveal={run.reveal}
          retried={run.retried}
          hint="Đọc lại câu hỏi và bài đọc rồi chọn lại xem."
          detail={
            <>
              {state === "reveal" && <div>Đáp án: {q.options[q.answer_index]}</div>}
              {q.explanation_vi}
            </>
          }
        />
      }
    >
      <Prompt title="Chọn đáp án đúng" mood={moodFor(state)} en={q.question} />
      <div className="options">
        {q.options.map((o, k) => {
          const known = state === "correct" || state === "reveal";
          const cls = known && k === q.answer_index ? "right" : state !== "idle" && sel === k ? "wrong" : sel === k ? "sel" : "";
          return (
            <button
              key={k}
              className={`option ${cls}`}
              disabled={state !== "idle"}
              onClick={() => {
                sfx.tap();
                setSel(k);
              }}
            >
              <span className="opt-key">{"ABCD"[k]}</span>
              {o}
            </button>
          );
        })}
      </div>
    </ExShell>
  );
}

// ---- Speak (ELSA-style) ------------------------------------------------------------------------

interface SpeakResult {
  transcript: string;
  grade: Grade;
  provider: string;
  quota: Quota;
  url: string;
}

function SpeakRun({ c, back, lessonId, me, onFinish, prior }: RunProps & { prior: LessonDetail["sentences"] }) {
  // Only this step's third of the passage.
  const order = useMemo(() => sentencesFor(c, "speak"), [c]);
  const total = order.length;
  const [i, setI] = useState(0);
  const idx = order[i];
  const [phase, setPhase] = useState<"idle" | "rec" | "grading">("idle");
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [error, setError] = useState("");
  const [gradesLeft, setGradesLeft] = useState(me.quota.grades.left);
  const best = useRef<Record<number, number>>(Object.fromEntries(prior.map((p) => [p.sentence_index, p.best])));
  const rec = useRef<Recorder | null>(null);
  const sentence = c.sentences[idx];

  useEffect(() => {
    setResult(null);
    setError("");
  }, [i]);
  useEffect(() => () => rec.current?.cancel(), []);

  const start = async () => {
    setError("");
    stopSpeaking();
    try {
      rec.current = await startRecording(() => void stop());
      setPhase("rec");
    } catch {
      setError("Không mở được micro. Hãy cho phép trình duyệt dùng micro.");
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase("grading");
    try {
      const recording = await r.stop();
      if (recording.seconds < 0.4) throw new Error("Bản ghi quá ngắn, hãy thử lại.");
      const res = await api<Omit<SpeakResult, "url">>("/api/speak", {
        body: { target: sentence, audio: recording.wavBase64, lessonId, sentenceIndex: idx },
      });
      setResult({ ...res, url: recording.url });
      setGradesLeft(res.quota.grades.left);
      best.current[idx] = Math.max(best.current[idx] ?? 0, res.grade.score);
      if (res.grade.score >= 85) sfx.correct();
      else if (res.grade.score < 60) sfx.wrong();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  const next = () => {
    if (i + 1 >= total) {
      const scores = order.map((k) => best.current[k] ?? 0);
      onFinish(Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(1, total)));
      return;
    }
    setI(i + 1);
  };

  const score = result?.grade.score;
  const mood: Mood =
    phase === "grading" ? "think" : score === undefined ? "idle" : score >= 85 ? "happy" : score >= 60 ? "cheer" : "sad";
  const say =
    phase === "rec"
      ? "Mình đang nghe…"
      : phase === "grading"
        ? "Đợi mình chấm nhé…"
        : result
          ? result.grade.feedback_vi
          : "Nghe mẫu trước, rồi bấm micro và đọc to câu này.";

  return (
    <ExShell
      back={back}
      progress={(i + (result ? 1 : 0)) / total}
      footer={
        <footer className="ex-foot idle">
          <div className="ex-foot-inner">
            {result ? (
              <button className="btn ghost" onClick={start} disabled={phase !== "idle"}>
                <ArrowCounterClockwise size={18} weight="bold" /> Thử lại
              </button>
            ) : (
              <button className="btn ghost" onClick={next} disabled={phase !== "idle"}>
                Bỏ qua
              </button>
            )}
            {result ? (
              <button className="btn primary wide" onClick={next}>
                Tiếp tục
              </button>
            ) : (
              <span className="muted small">
                {me.maintenance
                  ? "Chấm điểm đang bảo trì"
                  : me.quota.limited
                    ? `Mỗi lần chấm tốn 1 lượt (còn ${gradesLeft}/${me.quota.grades.limit})`
                    : `Câu ${i + 1}/${total}`}
              </span>
            )}
          </div>
        </footer>
      }
    >
      <Prompt title="Đọc to câu này" mood={mood} say={say} />
      <div className="speak-card">
        <div className="speak-text">
          {result
            ? result.grade.words
                .filter((w) => w.status !== "extra")
                .map((w, k) => (
                  <span key={k} className={`sw ${w.status}`} title={w.tip_vi || undefined}>
                    {w.word}{" "}
                  </span>
                ))
            : <Say text={sentence} />}
          {viOf(c, idx) && <p className="speak-vi">{viOf(c, idx)}</p>}
        </div>
        <PlayButtons text={sentence} auto={false} size="small" />
      </div>

      <div className="mic-zone">
        {result ? <ScoreRing score={result.grade.score} /> : <span className="mic-side" />}
        <button
          className={`mic ${phase}`}
          onClick={phase === "rec" ? stop : start}
          disabled={phase === "grading"}
          aria-label={phase === "rec" ? "Dừng ghi âm" : "Ghi âm"}
        >
          {phase === "rec" ? <Stop size={40} weight="fill" /> : phase === "grading" ? <span className="dots" /> : <Microphone size={44} weight="fill" />}
        </button>
        {result ? (
          <button className="play" onClick={() => new Audio(result.url).play()} aria-label="Nghe lại giọng mình">
            <Play size={24} weight="fill" />
          </button>
        ) : (
          <span className="mic-side" />
        )}
      </div>
      {phase === "rec" && (
        <div className="wave" aria-hidden="true">
          {Array.from({ length: 18 }, (_, k) => (
            <i key={k} style={{ animationDelay: `${(k % 6) * 0.09}s` }} />
          ))}
        </div>
      )}
      {error && <p className="error center">{error}</p>}
      {result && (
        <div className="speak-detail">
          <p className="muted small">Máy nghe được: “{result.transcript || "…"}”</p>
          {result.grade.words.some((w) => w.status !== "ok" && w.tip_vi) && (
            <ul className="tips">
              {result.grade.words
                .filter((w) => w.status !== "ok" && w.tip_vi)
                .map((w, k) => (
                  <li key={k}>
                    <b>{w.word}</b>
                    <span>{w.tip_vi}</span>
                  </li>
                ))}
            </ul>
          )}
          {result.grade.next_step_vi && (
            <p className="next-tip">
              <Lightbulb size={20} weight="fill" /> {result.grade.next_step_vi}
            </p>
          )}
        </div>
      )}
    </ExShell>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const len = 2 * Math.PI * r;
  const tone = score >= 85 ? "good" : score >= 60 ? "mid" : "low";
  return (
    <svg className={`ring ${tone}`} width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${score} điểm`}>
      <circle cx="42" cy="42" r={r} className="ring-bg" />
      <circle cx="42" cy="42" r={r} className="ring-fg" strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)} />
      <text x="42" y="49" textAnchor="middle">
        {score}
      </text>
    </svg>
  );
}

// ---- Read --------------------------------------------------------------------------------------

interface Explain {
  translation_vi: string;
  grammar_vi: string;
  notes_vi: string[];
}

function ReadRun({ c, back, onFinish }: RunProps) {
  const lookup = useContext(ExCtx)?.lookup ?? (() => {});
  const [open, setOpen] = useState<number | null>(null);
  const [explains, setExplains] = useState<Record<number, Explain | string>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [showVi, setShowVi] = useState(false);
  const hasVi = !!c.sentences_vi?.length;

  /** Opens a sentence; with a built-in translation the AI is only asked when the learner wants grammar. */
  const explain = async (k: number, ask = !hasVi) => {
    setOpen(k);
    if (!ask || typeof explains[k] === "object") return;
    setLoading(k);
    try {
      const r = await api<{ explain: Explain }>("/api/explain", { body: { sentence: c.sentences[k], context: c.sentences.join(" ") } });
      setExplains((e) => ({ ...e, [k]: r.explain }));
    } catch (err) {
      setExplains((e) => ({ ...e, [k]: (err as Error).message }));
    } finally {
      setLoading(null);
    }
  };
  const ex = open !== null ? explains[open] : undefined;

  return (
    <ExShell
      back={back}
      progress={0.5}
      footer={<Footer state="idle" canCheck onCheck={() => onFinish(100)} onNext={() => {}} checkLabel="Đã đọc xong" />}
    >
      <Prompt title={c.title} mood="idle" say="Bấm vào từ để tra nghĩa, bấm ? cuối câu để xem nghĩa cả câu." />
      <div className="read-tools">
        <button className="btn small ghost" onClick={() => speak(c.sentences.join(" "), { rate: 0.95 })}>
          <SpeakerHigh size={18} weight="fill" /> Nghe cả bài
        </button>
        <button className="btn small ghost" onClick={stopSpeaking}>
          <Stop size={18} weight="fill" /> Dừng
        </button>
        {hasVi && (
          <button className={`btn small ${showVi ? "primary" : "ghost"}`} onClick={() => setShowVi(!showVi)}>
            {showVi ? "Ẩn bản dịch" : "Hiện bản dịch"}
          </button>
        )}
      </div>
      <article className={showVi ? "reading with-vi" : "reading"}>
        {c.sentences.map((s, k) => (
          <span key={k} className={open === k ? "rs on" : "rs"}>
            {s.split(/(\s+)/).map((tok, j) =>
              /\s+/.test(tok) ? (
                tok
              ) : (
                <span key={j} className="rw" onClick={() => lookup(tok)}>
                  {tok}
                </span>
              ),
            )}
            <button className="q" onClick={() => explain(k)} title="Giải thích câu này" aria-label="Giải thích câu này">
              <Question size={14} weight="bold" />
            </button>{" "}
            {showVi && viOf(c, k) && <span className="rs-vi">{viOf(c, k)}</span>}
          </span>
        ))}
      </article>
      {open !== null && (
        <div className="card explain">
          <div className="row gap">
            <button className="play" onClick={() => speak(c.sentences[open], { rate: 0.95 })} aria-label="Nghe câu">
              <SpeakerHigh size={20} weight="fill" />
            </button>
            <b className="grow">{c.sentences[open]}</b>
            <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Đóng">
              <X size={20} weight="bold" />
            </button>
          </div>
          {viOf(c, open) && (
            <p>
              <b>Nghĩa:</b> {viOf(c, open)}
            </p>
          )}
          {hasVi && explains[open] === undefined && loading !== open && (
            <button className="btn small ghost" onClick={() => explain(open, true)}>
              <Lightbulb size={18} weight="fill" /> Hỏi AI giải thích ngữ pháp
            </button>
          )}
          {loading === open && <p className="muted">Đang giải thích…</p>}
          {typeof ex === "string" && <p className="error">{ex}</p>}
          {ex && typeof ex === "object" && (
            <>
              {!viOf(c, open) && (
                <p>
                  <b>Nghĩa:</b> {ex.translation_vi}
                </p>
              )}
              <p>
                <b>Ngữ pháp:</b> {ex.grammar_vi}
              </p>
              <ul>
                {ex.notes_vi.map((n, j) => (
                  <li key={j}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </ExShell>
  );
}

interface DictEntry {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech: string; definitions: { definition: string }[] }[];
}

interface WordCard {
  lemma: string;
  ipa: string;
  senses: { pos: string; meaning_vi: string; example: string; example_vi: string }[];
}

const POS_VI: Record<string, string> = {
  noun: "danh từ",
  verb: "động từ",
  adjective: "tính từ",
  adverb: "trạng từ",
  preposition: "giới từ",
  conjunction: "liên từ",
  pronoun: "đại từ",
  determiner: "hạn định từ",
  phrase: "cụm từ",
  interjection: "thán từ",
};

/** The word card: Vietnamese meanings (lesson vocabulary, then Workers AI), IPA, examples and English definitions. */
function WordPop({ raw, c, onClose }: { raw: string; c?: LessonContent; onClose: () => void }) {
  const ex = useContext(ExCtx);
  const word = raw.replace(/[’]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  const local = c?.vocabulary.find((v) => v.word.toLowerCase() === word.toLowerCase());
  const [card, setCard] = useState<WordCard | null | "loading">("loading");
  const [dict, setDict] = useState<DictEntry | null | "loading">("loading");
  const [showEn, setShowEn] = useState(false);
  useEffect(() => {
    if (!word) return;
    void speak(word);
    setCard("loading");
    setDict("loading");
    let live = true;
    void getCard(word).then((card) => live && setCard(card));
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setDict(Array.isArray(j) ? (j[0] as DictEntry) : null))
      .catch(() => live && setDict(null));
    return () => {
      live = false;
    };
  }, [word]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!word) return null;
  const ai = card && card !== "loading" ? card : null;
  const en = dict && dict !== "loading" ? dict : null;
  const ipa = local?.ipa || ai?.ipa || en?.phonetic || en?.phonetics?.find((p) => p.text)?.text || "";
  const nothing = !local && card === null && dict === null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="word-pop" role="dialog" aria-label={`Từ điển: ${word}`} onClick={(e) => e.stopPropagation()}>
        <div className="row gap">
          <button className="play" onClick={() => speak(word)} aria-label="Nghe từ">
            <SpeakerHigh size={20} weight="fill" />
          </button>
          <div className="grow">
            <b className="big-word">{word}</b> <span className="muted">{ipa}</span>
            {ai && ai.lemma && ai.lemma !== word.toLowerCase() && (
              <div className="small muted">
                dạng gốc:{" "}
                <b className="lw" onClick={() => ex?.lookup(ai.lemma)}>
                  {ai.lemma}
                </b>
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={20} weight="bold" />
          </button>
        </div>
        {local && (
          <div className="wp-sense here">
            <span className="wp-pos">{local.pos || "trong bài"}</span>
            <b>{local.meaning_vi}</b>
            {local.example && <i>{local.example}</i>}
            {local.example_vi && <em>{local.example_vi}</em>}
          </div>
        )}
        {card === "loading" && (
          <div className="wp-sense wp-skeleton" aria-label="Đang tra nghĩa">
            <span />
            <span />
            <span />
          </div>
        )}
        {ai?.senses
          .filter((s) => !local || s.meaning_vi.toLowerCase() !== local.meaning_vi.toLowerCase())
          .map((s, k) => (
            <div key={k} className="wp-sense">
              <span className="wp-pos">{POS_VI[s.pos.toLowerCase()] ?? s.pos}</span>
              <b>{s.meaning_vi}</b>
              {s.example && <i>{s.example}</i>}
              {s.example_vi && <em>{s.example_vi}</em>}
            </div>
          ))}
        {en?.meanings?.length ? (
          <div className="wp-en">
            <button className="btn small ghost" onClick={() => setShowEn(!showEn)} aria-expanded={showEn}>
              {showEn ? "Ẩn" : "Xem"} định nghĩa tiếng Anh
            </button>
            {showEn && (
              <ul className="small">
                {en.meanings.slice(0, 4).map((m, k) => (
                  <li key={k}>
                    <i>{m.partOfSpeech}</i> — {m.definitions[0]?.definition}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {nothing && <p className="muted small">Chưa tra được từ này. Kiểm tra lại chính tả nhé.</p>}
      </div>
    </div>
  );
}

/** "Tra từ": type any English word. */
function WordSearch({ onClose, onFind }: { onClose: () => void; onFind: (w: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="word-pop word-search"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const w = q.trim().split(/\s+/)[0];
          if (w) onFind(w);
        }}
      >
        <label className="search">
          <MagnifyingGlass size={20} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Gõ một từ tiếng Anh…"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label="Từ cần tra"
          />
        </label>
        <button className="btn primary" disabled={!q.trim()}>
          Tra
        </button>
      </form>
    </div>
  );
}

// ---- Completion --------------------------------------------------------------------------------

function Complete({ lessonId, stepKey, score, res }: { lessonId: number; stepKey: Step; score: number; res: ProgressResult }) {
  const ex = useContext(ExCtx);
  const go = (href: string) => (e: React.MouseEvent) => {
    if (!ex) return;
    e.preventDefault();
    ex.leave(href);
  };
  const info = STEPS.find((s) => s.key === stepKey)!;
  const nextStep = STEPS[STEPS.findIndex((s) => s.key === stepKey) + 1];
  return (
    <div className="complete">
      <Confetti />
      <div className="complete-stage">
        <Mascot name={useCompanion()} mood="cheer" className="complete-mascot" />
        <Fx name={score >= 85 ? "trophy" : "party_popper"} size={72} className="complete-fx" tile />
      </div>
      <h1>{score >= 85 ? "Xuất sắc!" : score >= 60 ? "Làm tốt lắm!" : "Hoàn thành!"}</h1>
      <p className="muted">
        <Fx name={info.fx} size={22} /> {info.label} · xong
      </p>
      <div className="complete-stats">
        <div className="cstat xp">
          <small>XP</small>
          <b>
            <Fx name="high_voltage" size={26} /> +{res.xpGained}
          </b>
        </div>
        <div className="cstat acc">
          <small>{stepKey === "speak" ? "ĐIỂM NÓI" : "CHÍNH XÁC"}</small>
          <b>
            <Fx name="bullseye" size={26} /> {score}%
          </b>
        </div>
        <div className="cstat streak">
          <small>CHUỖI</small>
          <b>
            <Fx name="fire" size={26} /> {res.game.streak}
          </b>
        </div>
      </div>
      {res.streakUp && <p className="good">Chuỗi ngày học tăng lên {res.game.streak}!</p>}
      {res.goalReached && <p className="good">Bạn đã đạt mục tiêu hôm nay!</p>}
      <div className="complete-actions">
        {nextStep && (
          <a className="btn primary wide" href={`#/lesson/${lessonId}/${nextStep.key}`} onClick={go(`#/lesson/${lessonId}/${nextStep.key}`)}>
            TIẾP: {nextStep.label.toUpperCase()} <ArrowRight size={18} weight="bold" />
          </a>
        )}
        <a
          className={`btn wide ${nextStep ? "ghost" : "primary"}`}
          href={nextStep ? `#/lesson/${lessonId}` : "#/"}
          onClick={go(nextStep ? `#/lesson/${lessonId}` : "#/")}
        >
          {nextStep ? "Về bài học" : "Về lộ trình"}
        </a>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 56 }, (_, k) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 2.2 + Math.random() * 1.6,
        color: ["#6fae3e", "#ff6ad5", "#ffb020", "#16c172", "#2fb4ff", "#ff7a59"][k % 6],
        rot: Math.random() * 360,
        round: k % 3 === 0,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, k) => (
        <i
          key={k}
          className={p.round ? "round" : ""}
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, rotate: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}
