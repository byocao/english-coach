import { useEffect, useRef, useState } from "react";
import { api, type Grade, type LessonContent, type Me } from "./api";
import { ScoreBadge } from "./App";
import {
  alignWords,
  englishVoices,
  onVoicesChanged,
  speak,
  startRecording,
  stopSpeaking,
  type Recorder,
  type Recording,
} from "./audio";

interface LessonData {
  id: number;
  user_id: number;
  title: string;
  topic: string;
  level: string;
  is_public: number;
  provider: string;
  author: string;
  content: LessonContent;
}

type Tab = "read" | "listen" | "speak" | "quiz";

/** Shared playback settings for every tab. */
interface Voice {
  rate: number;
  voiceURI: string;
}

export function LessonPage({ id, me, onQuota }: { id: number; me: Me; onQuota: () => void }) {
  const [data, setData] = useState<{ lesson: LessonData; attempts: { sentence_index: number; best: number; tries: number }[] } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("read");
  const [voice, setVoice] = useState<Voice>(() => {
    try {
      return JSON.parse(localStorage.getItem("ec_voice") || "") as Voice;
    } catch {
      return { rate: 0.9, voiceURI: "" };
    }
  });
  const [note] = useState(() => {
    const n = sessionStorage.getItem("ec_note") || "";
    sessionStorage.removeItem("ec_note");
    return n;
  });

  useEffect(() => {
    api<typeof data>(`/api/lessons/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
    return stopSpeaking;
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem("ec_voice", JSON.stringify(voice));
    } catch {
      /* private mode */
    }
  }, [voice]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Đang tải bài học…</p>;
  const { lesson } = data;
  const c = lesson.content;
  const mine = lesson.user_id === me.user.id;

  const togglePublic = async () => {
    await api(`/api/lessons/${lesson.id}`, { method: "PATCH", body: { is_public: !lesson.is_public } });
    setData({ ...data, lesson: { ...lesson, is_public: lesson.is_public ? 0 : 1 } });
  };
  const remove = async () => {
    if (!window.confirm("Xoá bài học này?")) return;
    await api(`/api/lessons/${lesson.id}`, { method: "DELETE" });
    location.hash = "#/";
  };

  return (
    <div className="stack-lg">
      <div className="lesson-head">
        <a href="#/" className="link small">
          ← Tất cả bài học
        </a>
        <h1>{c.title}</h1>
        <p className="muted">
          <span className="level">{lesson.level}</span> {c.summary_vi}
        </p>
        <div className="lesson-meta small muted">
          <span>
            Soạn bởi {lesson.provider === "claude" ? "Claude" : "Workers AI"}
            {!mine && ` · chia sẻ bởi ${lesson.author}`}
          </span>
          {mine && me.user.role === "admin" && (
            <button className="link" onClick={togglePublic}>
              {lesson.is_public ? "Ngừng chia sẻ" : "Chia sẻ cho mọi người"}
            </button>
          )}
          {mine && (
            <button className="link danger" onClick={remove}>
              Xoá
            </button>
          )}
        </div>
        {note && <p className="note">{note}</p>}
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["read", "📖 Đọc"],
            ["listen", "🎧 Nghe"],
            ["speak", "🎙️ Nói"],
            ["quiz", "✅ Câu hỏi"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "tab on" : "tab"}
            onClick={() => {
              stopSpeaking();
              setTab(t);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "quiz" && <VoiceControls voice={voice} setVoice={setVoice} />}
      {tab === "read" && <ReadTab c={c} voice={voice} onQuota={onQuota} />}
      {tab === "listen" && <ListenTab c={c} voice={voice} />}
      {tab === "speak" && <SpeakTab lessonId={lesson.id} c={c} voice={voice} attempts={data.attempts} onQuota={onQuota} />}
      {tab === "quiz" && <QuizTab c={c} />}
    </div>
  );
}

function VoiceControls({ voice, setVoice }: { voice: Voice; setVoice: (v: Voice) => void }) {
  const [voices, setVoices] = useState(englishVoices);
  useEffect(() => onVoicesChanged(() => setVoices(englishVoices())), []);
  return (
    <div className="voice-bar">
      <label className="field inline">
        <span>Giọng</span>
        <select value={voice.voiceURI} onChange={(e) => setVoice({ ...voice, voiceURI: e.target.value })}>
          <option value="">Tự chọn</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="field inline">
        <span>Tốc độ {voice.rate.toFixed(2)}×</span>
        <input
          type="range"
          min={0.5}
          max={1.3}
          step={0.05}
          value={voice.rate}
          onChange={(e) => setVoice({ ...voice, rate: Number(e.target.value) })}
        />
      </label>
      {voices.length === 0 && <span className="muted small">Trình duyệt này không có giọng tiếng Anh; thử Chrome hoặc Edge.</span>}
    </div>
  );
}

// ---- Read ----------------------------------------------------------------------

interface Explain {
  translation_vi: string;
  grammar_vi: string;
  notes_vi: string[];
}

function ReadTab({ c, voice, onQuota }: { c: LessonContent; voice: Voice; onQuota: () => void }) {
  const [word, setWord] = useState<string | null>(null);
  const [openSentence, setOpenSentence] = useState<number | null>(null);
  const [explains, setExplains] = useState<Record<number, Explain | "loading" | string>>({});

  const explain = async (i: number) => {
    setOpenSentence(i);
    if (explains[i] && explains[i] !== "loading" && typeof explains[i] !== "string") return;
    setExplains((e) => ({ ...e, [i]: "loading" }));
    try {
      const r = await api<{ explain: Explain }>("/api/explain", { body: { sentence: c.sentences[i], context: c.sentences.join(" ") } });
      setExplains((e) => ({ ...e, [i]: r.explain }));
      onQuota();
    } catch (err) {
      setExplains((e) => ({ ...e, [i]: (err as Error).message }));
    }
  };

  return (
    <div className="read-layout">
      <article className="card passage">
        <p className="muted small">Bấm vào một từ để tra nghĩa. Bấm “?” cuối câu để AI giải thích câu đó.</p>
        <div className="passage-text">
          {c.sentences.map((s, i) => (
            <span key={i} className={openSentence === i ? "sent on" : "sent"}>
              {s.split(/(\s+)/).map((tok, k) =>
                /\s+/.test(tok) ? (
                  tok
                ) : (
                  <span key={k} className="w" onClick={() => setWord(tok)}>
                    {tok}
                  </span>
                ),
              )}
              <button className="q" title="Giải thích câu này" onClick={() => explain(i)}>
                ?
              </button>{" "}
            </span>
          ))}
        </div>
        {openSentence !== null && (
          <ExplainBox sentence={c.sentences[openSentence]} value={explains[openSentence]} voice={voice} onClose={() => setOpenSentence(null)} />
        )}
      </article>

      <aside className="stack">
        {word && <WordCard raw={word} c={c} voice={voice} onClose={() => setWord(null)} />}
        <section className="card">
          <h3>Từ vựng</h3>
          <ul className="vocab">
            {c.vocabulary.map((v) => (
              <li key={v.word}>
                <div className="vocab-head">
                  <button className="icon-btn" onClick={() => speak(v.word, voice)} title="Nghe">
                    🔊
                  </button>
                  <b>{v.word}</b> <span className="muted small">{v.ipa}</span> <i className="muted small">{v.pos}</i>
                </div>
                <div>{v.meaning_vi}</div>
                <div className="muted small">“{v.example}”</div>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function ExplainBox({ sentence, value, voice, onClose }: { sentence: string; value: Explain | "loading" | string | undefined; voice: Voice; onClose: () => void }) {
  return (
    <div className="explain">
      <div className="explain-head">
        <button className="icon-btn" onClick={() => speak(sentence, voice)} title="Nghe câu">
          🔊
        </button>
        <b>{sentence}</b>
        <button className="link" onClick={onClose}>
          Đóng
        </button>
      </div>
      {value === "loading" && <p className="muted">AI đang giải thích…</p>}
      {typeof value === "string" && value !== "loading" && <p className="error">{value}</p>}
      {value && typeof value === "object" && (
        <>
          <p>
            <b>Nghĩa:</b> {value.translation_vi}
          </p>
          <p>
            <b>Ngữ pháp:</b> {value.grammar_vi}
          </p>
          <ul>
            {value.notes_vi.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface DictEntry {
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: { partOfSpeech: string; definitions: { definition: string }[] }[];
}

function WordCard({ raw, c, voice, onClose }: { raw: string; c: LessonContent; voice: Voice; onClose: () => void }) {
  const word = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
  const local = c.vocabulary.find((v) => v.word.toLowerCase() === word.toLowerCase());
  const [dict, setDict] = useState<DictEntry | null | "loading">("loading");

  useEffect(() => {
    if (!word) return;
    setDict("loading");
    speak(word, voice);
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDict(Array.isArray(j) ? (j[0] as DictEntry) : null))
      .catch(() => setDict(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  if (!word) return null;
  const ipa = local?.ipa || (dict && dict !== "loading" ? dict.phonetic || dict.phonetics?.find((p) => p.text)?.text : "");
  return (
    <section className="card word-card">
      <div className="explain-head">
        <button className="icon-btn" onClick={() => speak(word, voice)} title="Nghe">
          🔊
        </button>
        <b className="word-big">{word}</b>
        <span className="muted">{ipa}</span>
        <button className="link" onClick={onClose}>
          Đóng
        </button>
      </div>
      {local && <p>{local.meaning_vi}</p>}
      {dict === "loading" && <p className="muted small">Đang tra từ điển…</p>}
      {dict && dict !== "loading" && (
        <ul className="small">
          {dict.meanings?.slice(0, 3).map((m, i) => (
            <li key={i}>
              <i>{m.partOfSpeech}</i> — {m.definitions[0]?.definition}
            </li>
          ))}
        </ul>
      )}
      {dict === null && !local && <p className="muted small">Không tìm thấy trong từ điển.</p>}
    </section>
  );
}

// ---- Listen ---------------------------------------------------------------------

function ListenTab({ c, voice }: { c: LessonContent; voice: Voice }) {
  const [showText, setShowText] = useState(false);
  const [dictation, setDictation] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const stopRef = useRef(false);
  const [typed, setTyped] = useState<string[]>(() => c.sentences.map(() => ""));
  const [checked, setChecked] = useState<boolean[]>(() => c.sentences.map(() => false));

  const play = async (i: number) => {
    stopRef.current = false;
    setPlaying(i);
    await speak(c.sentences[i], voice);
    setPlaying(null);
  };
  const playAll = async () => {
    stopRef.current = false;
    for (let i = 0; i < c.sentences.length; i++) {
      if (stopRef.current) break;
      setPlaying(i);
      await speak(c.sentences[i], voice);
      await new Promise((r) => setTimeout(r, 350));
    }
    setPlaying(null);
  };
  const stop = () => {
    stopRef.current = true;
    stopSpeaking();
    setPlaying(null);
  };

  return (
    <section className="card">
      <div className="toolbar">
        {playing === null ? (
          <button className="btn btn-primary" onClick={playAll}>
            ▶ Nghe cả bài
          </button>
        ) : (
          <button className="btn" onClick={stop}>
            ■ Dừng
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Hiện chữ
        </label>
        <label className="check">
          <input type="checkbox" checked={dictation} onChange={(e) => setDictation(e.target.checked)} /> Chép chính tả
        </label>
      </div>
      <p className="muted small">
        Gợi ý: nghe lần 1 không nhìn chữ, lần 2 bật chép chính tả, lần 3 hiện chữ để đối chiếu. Bấm vào câu bị ẩn để xem.
      </p>
      <ol className="sentences">
        {c.sentences.map((s, i) => {
          const result = checked[i] ? alignWords(s, typed[i]) : null;
          const pct = result ? Math.round((result.filter((w) => w.ok).length / result.length) * 100) : 0;
          return (
            <li key={i} className={playing === i ? "playing" : ""}>
              <button className="icon-btn" onClick={() => play(i)} title="Nghe câu này">
                {playing === i ? "🔉" : "🔊"}
              </button>
              <div className="grow">
                <RevealText text={s} show={showText || checked[i]} />
                {dictation && (
                  <div className="dictation">
                    <input
                      value={typed[i]}
                      placeholder="Gõ lại những gì bạn nghe…"
                      onChange={(e) => {
                        const t = [...typed];
                        t[i] = e.target.value;
                        setTyped(t);
                        const ch = [...checked];
                        ch[i] = false;
                        setChecked(ch);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const ch = [...checked];
                          ch[i] = true;
                          setChecked(ch);
                        }
                      }}
                    />
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const ch = [...checked];
                        ch[i] = true;
                        setChecked(ch);
                      }}
                    >
                      Kiểm tra
                    </button>
                  </div>
                )}
                {result && (
                  <div className="diff">
                    <ScoreBadge score={pct} />{" "}
                    {result.map((w, k) => (
                      <span key={k} className={w.ok ? "w-ok" : "w-miss"}>
                        {w.word}{" "}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RevealText({ text, show }: { text: string; show: boolean }) {
  const [peek, setPeek] = useState(false);
  const visible = show || peek;
  return (
    <span className={visible ? "sent-text" : "sent-text hidden-text"} onClick={() => setPeek(!peek)} title={visible ? "" : "Bấm để xem"}>
      {text}
    </span>
  );
}

// ---- Speak ----------------------------------------------------------------------

interface SpeakResult {
  transcript: string;
  grade: Grade;
  provider: string;
  note?: string;
  recording: Recording;
}

function SpeakTab({
  lessonId,
  c,
  voice,
  attempts,
  onQuota,
}: {
  lessonId: number;
  c: LessonContent;
  voice: Voice;
  attempts: { sentence_index: number; best: number; tries: number }[];
  onQuota: () => void;
}) {
  const [best, setBest] = useState<Record<number, number>>(() =>
    Object.fromEntries(attempts.map((a) => [a.sentence_index, a.best])),
  );
  return (
    <section className="stack">
      <p className="muted small">
        Bấm 🔊 nghe mẫu, rồi 🎙️ đọc lại (nói xong bấm Dừng). Điểm dựa trên những gì máy nhận dạng giọng nói (Whisper) nghe được
        từ bạn, nên phản ánh độ rõ ràng chứ chưa phân tích từng âm.
      </p>
      {c.sentences.map((s, i) => (
        <SpeakCard
          key={i}
          index={i}
          sentence={s}
          lessonId={lessonId}
          voice={voice}
          best={best[i]}
          onScored={(score) => {
            setBest((b) => ({ ...b, [i]: Math.max(b[i] ?? 0, score) }));
            onQuota();
          }}
        />
      ))}
    </section>
  );
}

function SpeakCard({
  index,
  sentence,
  lessonId,
  voice,
  best,
  onScored,
}: {
  index: number;
  sentence: string;
  lessonId: number;
  voice: Voice;
  best?: number;
  onScored: (score: number) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "grading">("idle");
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [error, setError] = useState("");
  const rec = useRef<Recorder | null>(null);

  useEffect(() => () => rec.current?.cancel(), []);

  const start = async () => {
    setError("");
    stopSpeaking();
    try {
      rec.current = await startRecording(() => void stop());
      setState("recording");
    } catch {
      setError("Không mở được micro. Hãy cho phép trình duyệt dùng micro.");
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setState("grading");
    try {
      const recording = await r.stop();
      if (recording.seconds < 0.4) throw new Error("Bản ghi quá ngắn, hãy thử lại.");
      const res = await api<Omit<SpeakResult, "recording">>("/api/speak", {
        body: { target: sentence, audio: recording.wavBase64, lessonId, sentenceIndex: index },
      });
      setResult({ ...res, recording });
      onScored(res.grade.score);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setState("idle");
    }
  };

  const wordsByStatus = result?.grade.words ?? [];

  return (
    <div className={`card speak-card ${state === "recording" ? "is-recording" : ""}`}>
      <div className="speak-row">
        <span className="idx">{index + 1}</span>
        <p className="speak-sentence grow">{sentence}</p>
        {best !== undefined && <span className="muted small">cao nhất</span>}
        {best !== undefined && <ScoreBadge score={best} />}
      </div>
      <div className="toolbar">
        <button className="btn" onClick={() => speak(sentence, voice)} disabled={state !== "idle"}>
          🔊 Nghe mẫu
        </button>
        {state === "recording" ? (
          <button className="btn btn-rec" onClick={stop}>
            ■ Dừng & chấm
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={state === "grading"}>
            {state === "grading" ? "Đang chấm…" : "🎙️ Ghi âm"}
          </button>
        )}
        {result && (
          <button className="btn" onClick={() => new Audio(result.recording.url).play()}>
            ▶ Nghe lại mình
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="grade">
          <div className="grade-head">
            <ScoreBadge score={result.grade.score} />
            <div className="grade-words">
              {wordsByStatus.map((w, k) => (
                <span key={k} className={`gw gw-${w.status}`} title={w.tip_vi || undefined}>
                  {w.word}
                </span>
              ))}
            </div>
          </div>
          <p className="muted small">Máy nghe được: “{result.transcript || "…"}”</p>
          <p>{result.grade.feedback_vi}</p>
          {wordsByStatus.some((w) => w.status !== "ok" && w.tip_vi) && (
            <ul className="tips">
              {wordsByStatus
                .filter((w) => w.status !== "ok" && w.tip_vi)
                .map((w, k) => (
                  <li key={k}>
                    <b>{w.word}</b>: {w.tip_vi}
                  </li>
                ))}
            </ul>
          )}
          {result.grade.next_step_vi && (
            <p className="next">
              <b>Luyện tiếp:</b> {result.grade.next_step_vi}
            </p>
          )}
          <p className="muted small">Chấm bởi {result.provider === "claude" ? "Claude" : "Workers AI"}</p>
          {result.note && <p className="note">{result.note}</p>}
        </div>
      )}
    </div>
  );
}

// ---- Quiz -----------------------------------------------------------------------

function QuizTab({ c }: { c: LessonContent }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => c.questions.map(() => null));
  const done = picked.filter((p) => p !== null).length;
  const right = picked.filter((p, i) => p === c.questions[i].answer_index).length;
  return (
    <section className="stack">
      {c.questions.map((q, i) => (
        <div key={i} className="card">
          <p>
            <b>{i + 1}.</b> {q.question}
          </p>
          <div className="options">
            {q.options.map((o, k) => {
              const chosen = picked[i] === k;
              const reveal = picked[i] !== null;
              const cls = reveal && k === q.answer_index ? "opt right" : chosen ? "opt wrong" : "opt";
              return (
                <button
                  key={k}
                  className={cls}
                  disabled={reveal}
                  onClick={() => {
                    const p = [...picked];
                    p[i] = k;
                    setPicked(p);
                  }}
                >
                  {String.fromCharCode(65 + k)}. {o}
                </button>
              );
            })}
          </div>
          {picked[i] !== null && <p className="muted small">{q.explanation_vi}</p>}
        </div>
      ))}
      {done === c.questions.length && c.questions.length > 0 && (
        <div className="card">
          <b>
            Kết quả: {right}/{c.questions.length} câu đúng.
          </b>{" "}
          <button className="link" onClick={() => setPicked(c.questions.map(() => null))}>
            Làm lại
          </button>
        </div>
      )}
    </section>
  );
}
