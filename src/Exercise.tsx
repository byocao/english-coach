// Full-screen exercises, one item at a time (Duolingo style): word bank, dictation, speaking
// (ELSA style), reading and quiz, then a completion screen with XP.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Grade, type LessonContent, type LessonDetail, type Me, type ProgressResult, type Step } from "./api";
import { alignWords, norm, speak, startRecording, stopSpeaking, words, type Recorder } from "./audio";
import { Mascot, type Mood } from "./Mascot";
import { sfx } from "./sound";
import { STEPS } from "./steps";

type Check = "idle" | "correct" | "wrong";

const PRAISE = ["Tuyệt vời!", "Chính xác!", "Giỏi quá!", "Hay lắm!", "Đúng rồi!"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

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
  if (error) return <ExShell back={back} progress={0}><p className="error center">{error}</p></ExShell>;
  if (!d) return <ExShell back={back} progress={0}><p className="muted center">Đang tải…</p></ExShell>;
  if (done) return <Complete lessonId={lessonId} stepKey={info.key} score={done.score} res={done.res} />;

  const c = d.lesson.content;
  const props = { c, back, lessonId, me, onFinish: finish };
  switch (info.key) {
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

// ---- shell, footer, prompt ---------------------------------------------------------

function ExShell({ back, progress, children, footer }: { back: string; progress: number; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="ex">
      <header className="ex-top">
        <a className="ex-close" href={back} aria-label="Thoát">
          ✕
        </a>
        <div className="bar big grow">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
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
  const [praise] = useState(() => pick(PRAISE));
  useEffect(() => {
    if (state === "idle") return;
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
              <span className="verdict-icon">{state === "correct" ? "✔" : "✖"}</span>
              <div>
                <b>{state === "correct" ? praise : "Chưa đúng rồi"}</b>
                {detail && <div className="verdict-detail">{detail}</div>}
              </div>
            </div>
            <button className={`btn wide ${state === "correct" ? "primary" : "danger-solid"}`} onClick={onNext} autoFocus>
              TIẾP TỤC
            </button>
          </>
        )}
      </div>
    </footer>
  );
}

function Prompt({ title, mood, say, children }: { title: string; mood: Mood; say?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      <h1 className="ex-title">{title}</h1>
      <div className="ex-prompt">
        <Mascot name="haru" mood={mood} className="ex-mascot" frame={0.5} />
        <div className="ex-speech">
          {say && <div className="speech-bubble">{say}</div>}
          {children}
        </div>
      </div>
    </>
  );
}

function PlayButtons({ text, auto = true }: { text: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => void speak(text, { rate: 0.95 }), 300);
    return () => clearTimeout(t);
  }, [text, auto]);
  return (
    <div className="play-row">
      <button className="play big" onClick={() => speak(text, { rate: 0.95 })} aria-label="Nghe">
        🔊
      </button>
      <button className="play" onClick={() => speak(text, { rate: 0.6 })} aria-label="Nghe chậm">
        🐢
      </button>
    </div>
  );
}

/** Runs `items` one by one with check / continue; returns the share answered right (or average score). */
function useRunner(total: number, onFinish: (score: number) => void) {
  const [i, setI] = useState(0);
  const [state, setState] = useState<Check>("idle");
  const scores = useRef<number[]>([]);
  const mark = (score: number, ok: boolean) => {
    scores.current[i] = score;
    setState(ok ? "correct" : "wrong");
    if (ok) sfx.correct();
    else sfx.wrong();
  };
  const next = () => {
    if (i + 1 >= total) {
      const avg = scores.current.reduce((a, b) => a + (b ?? 0), 0) / Math.max(1, total);
      onFinish(Math.round(avg));
      return;
    }
    setI(i + 1);
    setState("idle");
  };
  return { i, state, mark, next, progress: (i + (state === "idle" ? 0 : 1)) / total };
}

function moodFor(state: Check): Mood {
  return state === "correct" ? "happy" : state === "wrong" ? "oops" : "idle";
}

// ---- Listen: word bank ----------------------------------------------------------------

interface Tile {
  id: number;
  text: string;
}

function tileWords(s: string): string[] {
  return words(s)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
}

function WordBankRun({ c, back, onFinish }: RunProps) {
  const { i, state, mark, next, progress } = useRunner(c.sentences.length, onFinish);
  const sentence = c.sentences[i];
  const target = useMemo(() => tileWords(sentence), [sentence]);
  const bank = useMemo<Tile[]>(() => {
    const have = new Set(target.map(norm));
    const pool = shuffle(c.sentences.flatMap(tileWords).filter((w) => !have.has(norm(w)) && w.length > 2));
    const extras = [...new Set(pool.map((w) => w.toLowerCase()))].slice(0, Math.min(3, Math.max(2, Math.floor(target.length / 4))));
    return shuffle([...target, ...extras]).map((text, id) => ({ id, text }));
  }, [target, c.sentences]);
  const [answer, setAnswer] = useState<number[]>([]);
  useEffect(() => setAnswer([]), [i]);

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
      footer={
        <Footer
          state={state}
          canCheck={answer.length > 0}
          onCheck={check}
          onNext={next}
          detail={state === "wrong" ? <>Đáp án: {sentence}</> : undefined}
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

// ---- Dictation ----------------------------------------------------------------------

function DictationRun({ c, back, onFinish }: RunProps) {
  const { i, state, mark, next, progress } = useRunner(c.sentences.length, onFinish);
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
      footer={
        <Footer
          state={state}
          canCheck={text.trim().length > 0}
          onCheck={check}
          onNext={next}
          detail={
            diff && (
              <span className="diff">
                {diff.map((w, k) => (
                  <span key={k} className={w.ok ? "w-ok" : "w-miss"}>
                    {w.word}{" "}
                  </span>
                ))}
              </span>
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

// ---- Quiz -----------------------------------------------------------------------------

function QuizRun({ c, back, onFinish }: RunProps) {
  const total = Math.max(1, c.questions.length);
  const { i, state, mark, next, progress } = useRunner(total, onFinish);
  const q = c.questions[i];
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [i]);
  if (!q) return <ExShell back={back} progress={1}><p className="muted center">Bài này không có câu hỏi.</p></ExShell>;

  return (
    <ExShell
      back={back}
      progress={progress}
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
              <span className="opt-key">{k + 1}</span>
              {o}
            </button>
          );
        })}
      </div>
    </ExShell>
  );
}

// ---- Speak (ELSA-style) -------------------------------------------------------------

interface SpeakResult {
  transcript: string;
  grade: Grade;
  provider: string;
  note?: string;
  url: string;
}

function SpeakRun({ c, back, lessonId, me, onFinish, prior }: RunProps & { prior: LessonDetail["sentences"] }) {
  const total = c.sentences.length;
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"idle" | "rec" | "grading">("idle");
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [error, setError] = useState("");
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
          : "Bấm 🔊 nghe mẫu, rồi bấm micro và đọc to câu này.";

  return (
    <ExShell
      back={back}
      progress={(i + (result ? 1 : 0)) / total}
      footer={
        <footer className="ex-foot idle">
          <div className="ex-foot-inner">
            {result ? (
              <button className="btn ghost" onClick={start} disabled={phase !== "idle"}>
                THỬ LẠI
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
                {me.quota.limited ? `Mỗi lần chấm tốn 1 lượt AI (còn ${me.quota.left})` : `Câu ${i + 1}/${total}`}
              </span>
            )}
          </div>
        </footer>
      }
    >
      <Prompt title="Đọc to câu này" mood={mood} say={say} />
      <div className="speak-card-x">
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
        </div>
        <PlayButtons text={sentence} auto={false} />
      </div>

      <div className="mic-zone">
        {result && <ScoreRing score={result.grade.score} />}
        <button
          className={`mic ${phase}`}
          onClick={phase === "rec" ? stop : start}
          disabled={phase === "grading"}
          aria-label={phase === "rec" ? "Dừng ghi âm" : "Ghi âm"}
        >
          {phase === "rec" ? "■" : phase === "grading" ? "…" : "🎤"}
        </button>
        {result && (
          <button className="play" onClick={() => new Audio(result.url).play()} aria-label="Nghe lại giọng mình">
            ▶️
          </button>
        )}
      </div>
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
                    <b>{w.word}</b>: {w.tip_vi}
                  </li>
                ))}
            </ul>
          )}
          {result.grade.next_step_vi && <p className="next-tip">💡 {result.grade.next_step_vi}</p>}
          {result.note && <p className="note">{result.note}</p>}
        </div>
      )}
    </ExShell>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const len = 2 * Math.PI * r;
  const tone = score >= 85 ? "good" : score >= 60 ? "mid" : "low";
  return (
    <svg className={`ring ${tone}`} width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${score} điểm`}>
      <circle cx="38" cy="38" r={r} className="ring-bg" />
      <circle cx="38" cy="38" r={r} className="ring-fg" strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)} />
      <text x="38" y="44" textAnchor="middle">
        {score}
      </text>
    </svg>
  );
}

// ---- Read ------------------------------------------------------------------------------

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

  const explain = async (k: number) => {
    setOpen(k);
    if (typeof explains[k] === "object") return;
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
      <Prompt title={c.title} mood="idle" say="Bấm vào từ để tra nghĩa, bấm “?” cuối câu để mình giải thích." />
      <article className="reading">
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
            <button className="q" onClick={() => explain(k)} title="Giải thích câu này">
              ?
            </button>{" "}
          </span>
        ))}
      </article>
      {open !== null && (
        <div className="card explain">
          <div className="row gap">
            <button className="play" onClick={() => speak(c.sentences[open], { rate: 0.95 })}>
              🔊
            </button>
            <b className="grow">{c.sentences[open]}</b>
            <button className="x" onClick={() => setOpen(null)} aria-label="Đóng">
              ✕
            </button>
          </div>
          {loading === open && <p className="muted">Đang giải thích…</p>}
          {typeof ex === "string" && <p className="error">{ex}</p>}
          {ex && typeof ex === "object" && (
            <>
              <p>
                <b>Nghĩa:</b> {ex.translation_vi}
              </p>
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
      <h2 className="sub">Từ vựng</h2>
      <div className="vocab-grid">
        {c.vocabulary.map((v) => (
          <button key={v.word} className="vocab-card" onClick={() => speak(v.word)}>
            <b>{v.word}</b> <span className="muted small">{v.ipa}</span>
            <span>{v.meaning_vi}</span>
            <i className="muted small">“{v.example}”</i>
          </button>
        ))}
      </div>
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
    <div className="word-pop card">
      <div className="row gap">
        <button className="play" onClick={() => speak(word)}>
          🔊
        </button>
        <b className="big-word">{word}</b>
        <span className="muted">{ipa}</span>
        <button className="x" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>
      {local && <p>{local.meaning_vi}</p>}
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

// ---- Completion ----------------------------------------------------------------------

function Complete({ lessonId, stepKey, score, res }: { lessonId: number; stepKey: Step; score: number; res: ProgressResult }) {
  const info = STEPS.find((s) => s.key === stepKey)!;
  const nextStep = STEPS[STEPS.findIndex((s) => s.key === stepKey) + 1];
  return (
    <div className="complete">
      <Confetti />
      <Mascot name="hiyori" mood="cheer" className="complete-mascot" />
      <h1>{score >= 85 ? "Xuất sắc!" : score >= 60 ? "Làm tốt lắm!" : "Hoàn thành!"}</h1>
      <p className="muted">{info.label} · xong</p>
      <div className="complete-stats">
        <div className="cstat xp">
          <small>TỔNG XP</small>
          <b>+{res.xpGained}</b>
        </div>
        <div className="cstat acc">
          <small>{stepKey === "speak" ? "ĐIỂM NÓI" : "CHÍNH XÁC"}</small>
          <b>{score}%</b>
        </div>
        <div className="cstat streak">
          <small>CHUỖI NGÀY</small>
          <b>🔥 {res.game.streak}</b>
        </div>
      </div>
      {res.streakUp && <p className="good">Chuỗi ngày học tăng lên {res.game.streak}! 🔥</p>}
      {res.goalReached && <p className="good">Bạn đã đạt mục tiêu hôm nay! 🎯</p>}
      <div className="complete-actions">
        {nextStep && (
          <a className="btn primary wide" href={`#/lesson/${lessonId}/${nextStep.key}`}>
            TIẾP: {nextStep.label.toUpperCase()}
          </a>
        )}
        <a className={`btn wide ${nextStep ? "ghost" : "primary"}`} href={`#/lesson/${lessonId}`}>
          VỀ BÀI HỌC
        </a>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, k) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 2.2 + Math.random() * 1.6,
        color: ["#58cc02", "#1cb0f6", "#ffc800", "#ff4b4b", "#ce82ff", "#ff9600"][k % 6],
        rot: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, k) => (
        <i
          key={k}
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, rotate: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}
