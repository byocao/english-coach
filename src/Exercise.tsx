// Full-screen exercises, one item at a time: vocabulary (flashcards, match pairs, fill the gap,
// listen and pick), word bank, dictation, speaking (ELSA style), reading and quiz,
// then a completion screen with XP.
import {
  ArrowCounterClockwise,
  ArrowRight,
  Check,
  Eraser,
  Lightbulb,
  Microphone,
  Play,
  Question,
  SpeakerHigh,
  Stop,
  Translate,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Grade, type LessonContent, type LessonDetail, type Me, type ProgressResult, type Quota, type Step } from "./api";
import { alignWords, norm, speak, startRecording, stopSpeaking, words, type Recorder } from "./audio";
import { Mascot, useCompanion, type Mood } from "./Mascot";
import { Fx, STEPS } from "./meta";
import { sfx } from "./sound";

type Check = "idle" | "correct" | "wrong" | "reveal";

/** Vietnamese translation of sentence `i`, when the lesson has one. */
const viOf = (c: LessonContent, i: number) => c.sentences_vi?.[i]?.trim() || "";

const PRAISE = ["Tuyệt vời!", "Chính xác!", "Giỏi quá!", "Hay lắm!", "Đúng rồi!", "Xuất sắc!"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
}

export function Exercise({ lessonId, step, me, onGame }: { lessonId: number; step: string; me: Me; onGame: () => void }) {
  const [d, setD] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ score: number; res: ProgressResult } | null>(null);
  const info = STEPS.find((s) => s.key === step);

  useEffect(() => {
    api<LessonDetail>(`/api/lessons/${lessonId}`)
      .then(setD)
      .catch((e) => setError(e.message));
    return stopSpeaking;
  }, [lessonId]);

  const finish = async (score: number) => {
    try {
      const res = await api<ProgressResult>("/api/progress", { body: { lessonId, step, score } });
      sfx.complete();
      setDone({ score, res });
      onGame();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const back = `#/lesson/${lessonId}`;
  if (!info) return <p className="error center">Không có bài tập “{step}”.</p>;
  if (error)
    return (
      <ExShell back={back} progress={0}>
        <p className="error center">{error}</p>
      </ExShell>
    );
  if (!d)
    return (
      <ExShell back={back} progress={0}>
        <div className="loading">
          <Fx name={info.fx} size={64} className="bob" />
        </div>
      </ExShell>
    );
  if (done) return <Complete lessonId={lessonId} stepKey={info.key} score={done.score} res={done.res} />;

  const c = d.lesson.content;
  const props = { c, back, lessonId, me, onFinish: finish };
  switch (info.key) {
    case "words":
      return <WordsRun {...props} />;
    case "listen":
      return <WordBankRun {...props} />;
    case "dictation":
      return <DictationRun {...props} />;
    case "quiz":
      return <QuizRun {...props} />;
    case "speak":
      return <SpeakRun {...props} prior={d.sentences} />;
    case "read":
      return <ReadRun {...props} />;
  }
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
  return (
    <div className="ex">
      <header className="ex-top">
        <a className="icon-btn" href={back} aria-label="Thoát">
          <X size={26} weight="bold" />
        </a>
        <div className="ex-progress grow">
          <span style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
        </div>
        {review && (
          <span className="review-pill" title="Ôn lại những câu chưa đúng">
            <ArrowCounterClockwise size={16} weight="bold" /> Ôn lại · còn {review.left}
          </span>
        )}
        {combo >= 2 && (
          <span className="combo" key={combo}>
            <Fx name="fire" size={22} /> {combo}
          </span>
        )}
      </header>
      <main className="ex-body">{children}</main>
      {footer}
    </div>
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

function Prompt({ title, mood, say, children }: { title: string; mood: Mood; say?: React.ReactNode; children?: React.ReactNode }) {
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
  const [queue, setQueue] = useState(() => Array.from({ length: total }, (_, k) => k));
  const [pos, setPos] = useState(0);
  const [state, setState] = useState<Check>("idle");
  const [attempt, setAttempt] = useState(0);
  const [combo, setCombo] = useState(0);
  const scores = useRef<(number | undefined)[]>([]);
  const reviews = useRef<number[]>([]);
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
  const others = (v: Vocab, n: number) =>
    shuffle(vocab.filter((o) => o.word.toLowerCase() !== v.word.toLowerCase()).map((o) => o.word)).slice(0, n);
  const items: WordItem[] = [{ kind: "cards", vocab }];
  const gaps: WordItem[] = [];
  for (const v of shuffle(vocab)) {
    const at = v.example.toLowerCase().indexOf(v.word.toLowerCase());
    if (at < 0 || vocab.length < 3) continue;
    gaps.push({
      kind: "gap",
      v,
      before: v.example.slice(0, at),
      after: v.example.slice(at + v.word.length),
      options: shuffle([v.word, ...others(v, 3)]),
    });
  }
  if (vocab.length >= 3) items.push({ kind: "match", vocab: shuffle(vocab).slice(0, 5) });
  items.push(...gaps.slice(0, 2));
  if (vocab.length >= 3) {
    for (const v of shuffle(vocab).slice(0, 2)) items.push({ kind: "hear", v, options: shuffle([v.word, ...others(v, 3)]) });
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
  const left = useMemo(() => shuffle(vocab.map((v, k) => ({ k, text: v.word }))), [vocab]);
  const right = useMemo(() => shuffle(vocab.map((v, k) => ({ k, text: v.meaning_vi }))), [vocab]);
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
                  {item.v.example}
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
            {item.before}
            <span className={`blank ${sel ? "filled" : ""} ${run.state}`}>{run.state === "reveal" ? answer : sel ?? " ".repeat(8)}</span>
            {item.after}
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
  const run = useRunner(c.sentences.length, onFinish);
  const { i, state, mark, next, progress, combo } = run;
  const sentence = c.sentences[i];
  const vi = viOf(c, i);
  const target = useMemo(() => tileWords(sentence), [sentence]);
  const bank = useMemo<Tile[]>(() => {
    const have = new Set(target.map(norm));
    const pool = shuffle(c.sentences.flatMap(tileWords).filter((w) => !have.has(norm(w)) && w.length > 2));
    const extras = [...new Set(pool.map((w) => w.toLowerCase()))].slice(0, Math.min(3, Math.max(2, Math.floor(target.length / 4))));
    return shuffle([...target, ...extras]).map((text, id) => ({ id, text }));
  }, [target, c.sentences]);
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

  /** Puts a tile into slot `to` (default: the selected slot, else the first empty one). Moving between slots swaps. */
  const put = (id: number, to: number | null = b.sel ?? b.slots.indexOf(null)) => {
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
    update({ slots, sel: null });
  };
  const takeOut = (k: number) => {
    if (b.locked[k] || b.slots[k] === null) return;
    sfx.tap();
    update({ slots: b.slots.map((x, j) => (j === k ? null : x)), sel: null });
  };
  const clearAll = () => update({ slots: b.slots.map((x, k) => (b.locked[k] ? x : null)), sel: null });

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
    update({ slots: b.slots.map((x, k) => (m[k] ? x : null)), locked: b.locked.map((l, k) => l || !!m[k]), marks: null, sel: null });
    run.retry();
  };

  // ---- Drag and drop (mouse and touch, via pointer events) ----
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const [over, setOver] = useState<number | "bank" | null>(null);
  const dragged = useRef(false);
  const dropTarget = (x: number, y: number): number | "bank" | null => {
    const el = document.elementFromPoint(x, y);
    const slot = el?.closest<HTMLElement>("[data-slot]");
    if (slot) return Number(slot.dataset.slot);
    return el?.closest(".wb-bank") ? "bank" : null;
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
      setOver(dropTarget(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      setDrag(null);
      setOver(null);
      if (!moving) return;
      // The click that may follow this pointerup is swallowed by `tapped`; after that, taps count again.
      setTimeout(() => (dragged.current = false), 0);
      const to = dropTarget(ev.clientX, ev.clientY);
      const from = b.slots.indexOf(id);
      if (typeof to === "number") put(id, to);
      else if (to === "bank" && from >= 0) takeOut(from);
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
              {state === "reveal" && <div>Đáp án: {sentence}</div>}
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
        Câu có <b>{target.length} từ</b>. Bấm hoặc kéo từ vào ô; bấm vào ô để bỏ từ ra.
      </p>
      <div className="wb-slots" role="group" aria-label={`Câu có ${target.length} từ`}>
        {target.map((_, k) => {
          const id = b.slots[k];
          const cls = [
            "wb-slot",
            id === null ? "empty" : "tile",
            b.locked[k] ? "locked" : "",
            b.sel === k ? "sel" : "",
            over === k ? "over" : "",
            b.marks ? (b.marks[k] ? "right" : "wrong") : "",
            drag && drag.id === id ? "dragging" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={k}
              data-slot={k}
              className={cls}
              disabled={!idle || b.locked[k]}
              aria-label={id === null ? `Ô ${k + 1}, trống` : `Ô ${k + 1}: ${textOf(id)}`}
              onPointerDown={id !== null && !b.locked[k] ? (e) => startDrag(e, id) : undefined}
              onClick={tapped(() => (id === null ? update({ sel: b.sel === k ? null : k }) : takeOut(k)))}
            >
              {id === null ? "…" : textOf(id)}
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
        <div className="tile wb-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {bank[drag.id].text}
        </div>
      )}
    </ExShell>
  );
}

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

function DictationRun({ c, back, onFinish }: RunProps) {
  const run = useRunner(c.sentences.length, onFinish);
  const { i, state, mark, next, progress, combo } = run;
  const sentence = c.sentences[i];
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<{ word: string; ok: boolean }[] | null>(null);
  useEffect(() => {
    setText("");
    setDiff(null);
  }, [run.key]);

  const check = () => {
    const d = alignWords(sentence, text);
    const pct = Math.round((d.filter((w) => w.ok).length / d.length) * 100);
    setDiff(d);
    mark(pct, pct >= 90);
  };

  return (
    <ExShell
      back={back}
      progress={progress}
      combo={combo}
      review={run.review}
      footer={
        <Footer
          state={state}
          canCheck={text.trim().length > 0}
          onCheck={check}
          onNext={next}
          onRetry={run.retry}
          onReveal={run.reveal}
          retried={run.retried}
          hint={diff && `Đúng ${diff.filter((w) => w.ok).length}/${diff.length} từ. Nghe lại rồi sửa câu của bạn nhé.`}
          detail={
            diff && (
              <>
                <span className="diff">
                  {diff.map((w, k) => (
                    <span key={k} className={w.ok ? "w-ok" : "w-miss"}>
                      {w.word}{" "}
                    </span>
                  ))}
                </span>
                {viOf(c, i) && <span className="vi">{viOf(c, i)}</span>}
              </>
            )
          }
          extra={
            <button
              className="btn ghost"
              onClick={() => {
                setDiff(alignWords(sentence, text));
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
      <Prompt title="Gõ lại những gì bạn nghe" mood={moodFor(state)}>
        <PlayButtons text={sentence} />
      </Prompt>
      <textarea
        className="dict-input"
        value={text}
        disabled={state !== "idle"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && text.trim() && state === "idle") {
            e.preventDefault();
            check();
          }
        }}
        placeholder="Gõ bằng tiếng Anh…"
        autoFocus
        spellCheck={false}
        autoCapitalize="none"
      />
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
      <Prompt title="Chọn đáp án đúng" mood={moodFor(state)} say={q.question} />
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
  const total = c.sentences.length;
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"idle" | "rec" | "grading">("idle");
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [error, setError] = useState("");
  const [gradesLeft, setGradesLeft] = useState(me.quota.grades.left);
  const best = useRef<Record<number, number>>(Object.fromEntries(prior.map((p) => [p.sentence_index, p.best])));
  const rec = useRef<Recorder | null>(null);
  const sentence = c.sentences[i];

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
        body: { target: sentence, audio: recording.wavBase64, lessonId, sentenceIndex: i },
      });
      setResult({ ...res, url: recording.url });
      setGradesLeft(res.quota.grades.left);
      best.current[i] = Math.max(best.current[i] ?? 0, res.grade.score);
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
      const scores = Object.values(best.current);
      onFinish(scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / total) : 0);
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
            : sentence}
          {viOf(c, i) && <p className="speak-vi">{viOf(c, i)}</p>}
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
  const [word, setWord] = useState<string | null>(null);
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
                <span key={j} className="rw" onClick={() => setWord(tok)}>
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
      {word && <WordPop raw={word} c={c} onClose={() => setWord(null)} />}
    </ExShell>
  );
}

interface DictEntry {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech: string; definitions: { definition: string }[] }[];
}

function WordPop({ raw, c, onClose }: { raw: string; c: LessonContent; onClose: () => void }) {
  const word = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
  const local = c.vocabulary.find((v) => v.word.toLowerCase() === word.toLowerCase());
  const [dict, setDict] = useState<DictEntry | null | "loading">("loading");
  useEffect(() => {
    if (!word) return;
    void speak(word);
    setDict("loading");
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDict(Array.isArray(j) ? (j[0] as DictEntry) : null))
      .catch(() => setDict(null));
  }, [word]);
  if (!word) return null;
  const ipa = local?.ipa || (dict && dict !== "loading" ? dict.phonetic || dict.phonetics?.find((p) => p.text)?.text : "");
  return (
    <div className="word-pop">
      <div className="row gap">
        <button className="play" onClick={() => speak(word)} aria-label="Nghe từ">
          <SpeakerHigh size={20} weight="fill" />
        </button>
        <b className="big-word">{word}</b>
        <span className="muted">{ipa}</span>
        <span className="grow" />
        <button className="icon-btn" onClick={onClose} aria-label="Đóng">
          <X size={20} weight="bold" />
        </button>
      </div>
      {local && <p className="wp-mean">{local.meaning_vi}</p>}
      {dict === "loading" && <p className="muted small">Đang tra từ điển…</p>}
      {dict && dict !== "loading" && (
        <ul className="small">
          {dict.meanings?.slice(0, 3).map((m, k) => (
            <li key={k}>
              <i>{m.partOfSpeech}</i> — {m.definitions[0]?.definition}
            </li>
          ))}
        </ul>
      )}
      {dict === null && !local && <p className="muted small">Không có trong từ điển.</p>}
    </div>
  );
}

// ---- Completion --------------------------------------------------------------------------------

function Complete({ lessonId, stepKey, score, res }: { lessonId: number; stepKey: Step; score: number; res: ProgressResult }) {
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
          <a className="btn primary wide" href={`#/lesson/${lessonId}/${nextStep.key}`}>
            TIẾP: {nextStep.label.toUpperCase()} <ArrowRight size={18} weight="bold" />
          </a>
        )}
        <a className={`btn wide ${nextStep ? "ghost" : "primary"}`} href={nextStep ? `#/lesson/${lessonId}` : "#/"}>
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
