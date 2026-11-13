// Full-screen exercises, one item at a time: vocabulary (flashcards, match pairs, fill the gap,
// listen and pick), word bank, dictation, speaking (ELSA style), reading and quiz,
// then a completion screen with XP.
import {
  ArrowCounterClockwise,
  ArrowRight,
  Check,
  Lightbulb,
  Microphone,
  Play,
  Question,
  SpeakerHigh,
  Stop,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Grade, type LessonContent, type LessonDetail, type Me, type ProgressResult, type Quota, type Step } from "./api";
import { alignWords, norm, speak, startRecording, stopSpeaking, words, type Recorder } from "./audio";
import { Mascot, useCompanion, type Mood } from "./Mascot";
import { Fx, STEPS } from "./meta";
import { sfx } from "./sound";

type Check = "idle" | "correct" | "wrong";

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
  children,
  footer,
}: {
  back: string;
  progress: number;
  combo?: number;
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

function Footer({
  state,
  canCheck,
  onCheck,
  onNext,
  detail,
  checkLabel = "KIỂM TRA",
  extra,
}: {
  state: Check;
  canCheck: boolean;
  onCheck: () => void;
  onNext: () => void;
  detail?: React.ReactNode;
  checkLabel?: string;
  extra?: React.ReactNode;
}) {
  const [praise, setPraise] = useState(() => pick(PRAISE));
  useEffect(() => {
    if (state === "idle") {
      setPraise(pick(PRAISE));
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Enter" && onNext();
    const t = setTimeout(() => addEventListener("keydown", onKey), 150);
    return () => {
      clearTimeout(t);
      removeEventListener("keydown", onKey);
    };
  }, [state, onNext]);
  return (
    <footer className={`ex-foot ${state}`}>
      <div className="ex-foot-inner">
        {state === "idle" ? (
          <>
            {extra ?? <span />}
            <button className="btn primary wide" disabled={!canCheck} onClick={onCheck}>
              {checkLabel}
            </button>
          </>
        ) : (
          <>
            <div className="verdict">
              <span className="verdict-icon">{state === "correct" ? <Check size={30} weight="bold" /> : <X size={30} weight="bold" />}</span>
              <div>
                <b>{state === "correct" ? praise : "Chưa đúng rồi"}</b>
                {detail && <div className="verdict-detail">{detail}</div>}
              </div>
            </div>
            <button className={`btn wide ${state === "correct" ? "good" : "danger"}`} onClick={onNext} autoFocus>
              TIẾP TỤC
            </button>
          </>
        )}
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

/** Runs `total` items one by one with check / continue; reports the average score at the end. */
function useRunner(total: number, onFinish: (score: number) => void) {
  const [i, setI] = useState(0);
  const [state, setState] = useState<Check>("idle");
  const [combo, setCombo] = useState(0);
  const scores = useRef<number[]>([]);
  const mark = useCallback(
    (score: number, ok: boolean) => {
      scores.current[i] = score;
      setState(ok ? "correct" : "wrong");
      setCombo((c) => (ok ? c + 1 : 0));
      if (ok) sfx.correct();
      else sfx.wrong();
    },
    [i],
  );
  const next = useCallback(() => {
    if (i + 1 >= total) {
      const avg = scores.current.reduce((a, b) => a + (b ?? 0), 0) / Math.max(1, total);
      onFinish(Math.round(avg));
      return;
    }
    setI(i + 1);
    setState("idle");
  }, [i, total, onFinish]);
  /** For items that are not graded (flashcards): count as full marks and move on. */
  const pass = useCallback(() => {
    scores.current[i] = 100;
    next();
  }, [i, next]);
  return { i, state, mark, next, pass, combo, progress: (i + (state === "idle" ? 0 : 1)) / total };
}

function moodFor(state: Check): Mood {
  return state === "correct" ? "happy" : state === "wrong" ? "oops" : "idle";
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
  if (item.kind === "cards") return <CardsItem key={run.i} vocab={item.vocab} back={back} run={run} total={items.length} />;
  if (item.kind === "match") return <MatchItem key={run.i} vocab={item.vocab} back={back} run={run} />;
  return <ChoiceItem key={run.i} item={item} back={back} run={run} />;
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
              {flipped.size >= vocab.length ? "ĐÃ NHỚ HẾT" : "TIẾP TỤC"}
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
          checkLabel={`${matched.size}/${vocab.length} CẶP`}
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
      footer={
        <Footer
          state={run.state}
          canCheck={sel !== null}
          onCheck={check}
          onNext={run.next}
          detail={
            <>
              {run.state === "wrong" && <div>Đáp án: {answer}</div>}
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
            <span className={`blank ${sel ? "filled" : ""} ${run.state}`}>{sel ?? " ".repeat(8)}</span>
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
          const reveal = run.state !== "idle";
          const cls = reveal && o === answer ? "right" : reveal && sel === o ? "wrong" : sel === o ? "sel" : "";
          return (
            <button
              key={o}
              className={`option ${cls}`}
              disabled={reveal}
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
  const { i, state, mark, next, progress, combo } = useRunner(c.sentences.length, onFinish);
  const sentence = c.sentences[i];
  const target = useMemo(() => tileWords(sentence), [sentence]);
  const bank = useMemo<Tile[]>(() => {
    const have = new Set(target.map(norm));
    const pool = shuffle(c.sentences.flatMap(tileWords).filter((w) => !have.has(norm(w)) && w.length > 2));
    const extras = [...new Set(pool.map((w) => w.toLowerCase()))].slice(0, Math.min(3, Math.max(2, Math.floor(target.length / 4))));
    return shuffle([...target, ...extras]).map((text, id) => ({ id, text }));
  }, [target, c.sentences]);
  // Picks belong to one sentence; a new sentence starts empty (stale ids would point past a shorter bank).
  const [picked, setPicked] = useState<{ i: number; ids: number[] }>({ i: 0, ids: [] });
  const answer = picked.i === i ? picked.ids.filter((id) => bank[id]) : [];
  const setAnswer = (ids: number[]) => setPicked({ i, ids });

  const check = () => {
    const got = answer.map((id) => norm(bank[id].text)).join(" ");
    const ok = got === target.map(norm).join(" ");
    const right = alignWords(sentence, answer.map((id) => bank[id].text).join(" ")).filter((w) => w.ok).length;
    mark(ok ? 100 : Math.round((right / target.length) * 60), ok);
  };

  return (
    <ExShell
      back={back}
      progress={progress}
      combo={combo}
      footer={
        <Footer
          state={state}
          canCheck={answer.length > 0}
          onCheck={check}
          onNext={next}
          detail={
            <>
              {state === "wrong" && <div>Đáp án: {sentence}</div>}
              {viOf(c, i) && <span className="vi">{viOf(c, i)}</span>}
            </>
          }
          extra={
            <button className="btn ghost" onClick={() => mark(0, false)}>
              BỎ QUA
            </button>
          }
        />
      }
    >
      <Prompt title="Nghe và xếp lại câu" mood={moodFor(state)}>
        <PlayButtons text={sentence} />
      </Prompt>
      <div className="answer-line">
        {answer.map((id) => (
          <button
            key={id}
            className="tile"
            disabled={state !== "idle"}
            onClick={() => {
              sfx.tap();
              setAnswer(answer.filter((x) => x !== id));
            }}
          >
            {bank[id].text}
          </button>
        ))}
      </div>
      <div className="bank">
        {bank.map((t) => {
          const used = answer.includes(t.id);
          return (
            <button
              key={t.id}
              className={used ? "tile used" : "tile"}
              disabled={used || state !== "idle"}
              onClick={() => {
                sfx.tap();
                void speak(t.text, { rate: 0.95 });
                setAnswer([...answer, t.id]);
              }}
            >
              {t.text}
            </button>
          );
        })}
      </div>
    </ExShell>
  );
}

// ---- Dictation ---------------------------------------------------------------------------------

function DictationRun({ c, back, onFinish }: RunProps) {
  const { i, state, mark, next, progress, combo } = useRunner(c.sentences.length, onFinish);
  const sentence = c.sentences[i];
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<{ word: string; ok: boolean }[] | null>(null);
  useEffect(() => {
    setText("");
    setDiff(null);
  }, [i]);

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
      footer={
        <Footer
          state={state}
          canCheck={text.trim().length > 0}
          onCheck={check}
          onNext={next}
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
            <button className="btn ghost" onClick={() => mark(0, false)}>
              BỎ QUA
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
  const { i, state, mark, next, progress, combo } = useRunner(total, onFinish);
  const q = c.questions[i];
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [i]);
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
      footer={
        <Footer
          state={state}
          canCheck={sel !== null}
          onCheck={() => mark(sel === q.answer_index ? 100 : 0, sel === q.answer_index)}
          onNext={next}
          detail={
            <>
              {state === "wrong" && <div>Đáp án: {q.options[q.answer_index]}</div>}
              {q.explanation_vi}
            </>
          }
        />
      }
    >
      <Prompt title="Chọn đáp án đúng" mood={moodFor(state)} say={q.question} />
      <div className="options">
        {q.options.map((o, k) => {
          const reveal = state !== "idle";
          const cls = reveal && k === q.answer_index ? "right" : reveal && sel === k ? "wrong" : sel === k ? "sel" : "";
          return (
            <button
              key={k}
              className={`option ${cls}`}
              disabled={reveal}
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
                <ArrowCounterClockwise size={18} weight="bold" /> THỬ LẠI
              </button>
            ) : (
              <button className="btn ghost" onClick={next} disabled={phase !== "idle"}>
                BỎ QUA
              </button>
            )}
            {result ? (
              <button className="btn primary wide" onClick={next}>
                TIẾP TỤC
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
      footer={<Footer state="idle" canCheck onCheck={() => onFinish(100)} onNext={() => {}} checkLabel="ĐÃ ĐỌC XONG" />}
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
          {nextStep ? "VỀ BÀI HỌC" : "VỀ LỘ TRÌNH"}
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
