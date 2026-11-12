// Placement test: an adaptive run of up to 12 questions (pairs at one level; both right moves up,
// both wrong moves down) that ends in a CEFR level saved on the account.
import { ArrowRight, SpeakerHigh, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { api, type Me } from "./api";
import { speak } from "./audio";
import { Mascot, type MascotName, type Mood } from "./Mascot";
import { Fx, LEVELS } from "./meta";
import { sfx } from "./sound";

type Kind = "grammar" | "vocab" | "listen" | "read";
interface Item {
  kind: Kind;
  q: string;
  text?: string;
  /** The first option is the right one; options are shuffled when shown. */
  options: [string, string, string, string];
}

const KIND_LABEL: Record<Kind, string> = { grammar: "Ngữ pháp", vocab: "Từ vựng", listen: "Nghe", read: "Đọc hiểu" };

const BANK: Item[][] = [
  // A1
  [
    { kind: "grammar", q: "She ___ a teacher.", options: ["is", "are", "am", "be"] },
    { kind: "grammar", q: "I ___ coffee every morning.", options: ["drink", "drinks", "drinking", "am drink"] },
    { kind: "vocab", q: "“Kitchen” nghĩa là gì?", options: ["nhà bếp", "phòng ngủ", "phòng tắm", "phòng khách"] },
    {
      kind: "listen",
      q: "Bạn nghe được câu nào?",
      text: "My brother lives in Da Nang.",
      options: ["My brother lives in Da Nang.", "My mother lives in Da Nang.", "My brother loves Da Nang.", "My brother lived in Hanoi."],
    },
    {
      kind: "read",
      q: "How many pets does Tom have?",
      text: "Hi! I'm Tom. I'm from London. I have two cats and one dog.",
      options: ["Three", "Two", "One", "Four"],
    },
    { kind: "grammar", q: "There ___ two books on the table.", options: ["are", "is", "be", "am"] },
  ],
  // A2
  [
    { kind: "grammar", q: "Yesterday we ___ to the beach.", options: ["went", "go", "goes", "going"] },
    { kind: "grammar", q: "This phone is ___ than my old one.", options: ["cheaper", "cheap", "more cheap", "cheapest"] },
    { kind: "vocab", q: "“Cheap” trái nghĩa với từ nào?", options: ["expensive", "small", "easy", "slow"] },
    {
      kind: "listen",
      q: "Bạn nghe được câu nào?",
      text: "I'm going to visit my grandparents next weekend.",
      options: [
        "I'm going to visit my grandparents next weekend.",
        "I went to visit my grandparents last weekend.",
        "I'm going to visit my grandmother this weekend.",
        "I want to visit my grandparents next week.",
      ],
    },
    {
      kind: "read",
      q: "Why did Linh take a taxi today?",
      text: "Linh usually takes the bus to work, but today it was raining, so she called a taxi.",
      options: ["Because of the rain", "Because the bus was late", "Because she was tired", "Because she woke up late"],
    },
    { kind: "grammar", q: "You ___ wear a helmet when you ride a motorbike.", options: ["should", "don't", "aren't", "wasn't"] },
  ],
  // B1
  [
    { kind: "grammar", q: "I have lived here ___ 2019.", options: ["since", "for", "from", "during"] },
    { kind: "grammar", q: "If it rains tomorrow, we ___ the picnic.", options: ["will cancel", "cancelled", "would cancel", "had cancelled"] },
    { kind: "vocab", q: "“Give up” gần nghĩa nhất với:", options: ["stop trying", "start again", "give away", "look for"] },
    {
      kind: "listen",
      q: "Bạn nghe được câu nào?",
      text: "If I had more free time, I would learn to play the guitar.",
      options: [
        "If I had more free time, I would learn to play the guitar.",
        "If I have more free time, I will learn to play the guitar.",
        "If I had more free time, I would like to play the guitar.",
        "When I had more free time, I learned to play the guitar.",
      ],
    },
    {
      kind: "read",
      q: "What is true about the café?",
      text: "Although the new café is a bit far from the city centre, it's always full because the coffee is excellent and the prices are fair.",
      options: ["It is popular despite its location.", "It is in the city centre.", "It is expensive.", "It is usually empty."],
    },
    { kind: "grammar", q: "The book ___ I borrowed from you was really interesting.", options: ["that", "who", "what", "where"] },
  ],
  // B2
  [
    {
      kind: "grammar",
      q: "By the time we arrived, the film ___.",
      options: ["had already started", "already starts", "has already started", "will already start"],
    },
    { kind: "grammar", q: "The new bridge ___ next year.", options: ["will be completed", "will complete", "is completing", "completes"] },
    {
      kind: "vocab",
      q: "The manager ___ the proposal because it was too risky.",
      options: ["turned down", "turned up", "put off", "took over"],
    },
    {
      kind: "listen",
      q: "Bạn nghe được câu nào?",
      text: "Had I known about the traffic, I would have left much earlier.",
      options: [
        "Had I known about the traffic, I would have left much earlier.",
        "If I know about the traffic, I will leave much earlier.",
        "I had known about the traffic, so I left much earlier.",
        "Had I known about the traffic, I would leave much earlier.",
      ],
    },
    {
      kind: "read",
      q: "What does the writer suggest?",
      text: "Critics argue that remote work erodes team culture, yet a growing body of research suggests that well-managed remote teams are just as cohesive as office-based ones.",
      options: [
        "Well-run remote teams can be as united as office teams.",
        "Remote work always damages team culture.",
        "Research on remote work is not reliable.",
        "Office teams are always more productive.",
      ],
    },
    { kind: "vocab", q: "“Reluctant” nghĩa là:", options: ["miễn cưỡng", "hào hứng", "cẩn thận", "tự tin"] },
  ],
  // C1
  [
    { kind: "grammar", q: "Not only ___ the deadline, but he also exceeded every target.", options: ["did he meet", "he met", "he did meet", "met he"] },
    { kind: "grammar", q: "It's high time the government ___ action on air pollution.", options: ["took", "takes", "will take", "has taken"] },
    { kind: "vocab", q: "Closest meaning of “ubiquitous”:", options: ["found everywhere", "extremely rare", "highly expensive", "difficult to use"] },
    {
      kind: "listen",
      q: "Bạn nghe được câu nào?",
      text: "It was only after the meeting had ended that she realised what she had agreed to.",
      options: [
        "It was only after the meeting had ended that she realised what she had agreed to.",
        "It was only before the meeting ended that she realised what she agreed to.",
        "Only after the meeting she realised what she had agreed to do.",
        "It was after the meeting that she realised she hadn't agreed to anything.",
      ],
    },
    {
      kind: "read",
      q: "What does the statement do?",
      text: "The company's statement was carefully worded: it neither confirmed nor denied the rumours, leaving investors to read between the lines.",
      options: ["It avoids giving a clear answer.", "It confirms the rumours.", "It strongly denies the rumours.", "It apologises to investors."],
    },
    { kind: "vocab", q: "The new policy has ___ widespread criticism.", options: ["drawn", "made", "done", "given"] },
  ],
];

const MAX_QUESTIONS = 12;

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
}

interface Asked {
  level: number;
  ok: boolean;
}

/** Highest level answered at least half right; A1 if none. */
function resultLevel(asked: Asked[]): number {
  let best = 0;
  for (let l = 0; l < LEVELS.length; l++) {
    const at = asked.filter((a) => a.level === l);
    if (at.length && at.filter((a) => a.ok).length / at.length >= 0.5) best = l;
  }
  return best;
}

export function Placement({ me, onDone }: { me: Me; onDone: () => void }) {
  const mascot = (me.user.mascot as MascotName) || "wanko";
  const pools = useMemo(() => BANK.map((items) => shuffle(items)), []);
  const used = useRef<number[]>([0, 0, 0, 0, 0]);
  const [phase, setPhase] = useState<"intro" | "test" | "result">("intro");
  const [level, setLevel] = useState(1);
  const [asked, setAsked] = useState<Asked[]>([]);
  const [block, setBlock] = useState<boolean[]>([]);
  const [item, setItem] = useState<{ level: number; it: Item; options: string[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>("idle");
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState<number | null>(null);

  const draw = (l: number) => {
    const it = pools[l][used.current[l]++];
    if (!it) return false;
    setItem({ level: l, it, options: shuffle(it.options) });
    setSel(null);
    if (it.kind === "listen" && it.text) setTimeout(() => void speak(it.text!, { rate: 0.95 }), 350);
    return true;
  };

  const start = () => {
    setPhase("test");
    draw(1);
  };

  const finish = (all: Asked[]) => {
    setPhase("result");
    setPick(resultLevel(all));
    setMood("cheer");
    sfx.complete();
  };

  const answer = (choice: string | null) => {
    if (!item) return;
    const ok = choice === item.it.options[0];
    sfx.tap();
    const all = [...asked, { level: item.level, ok }];
    const blk = [...block, ok];
    setAsked(all);
    setMood(ok ? "happy" : "idle");
    if (all.length >= MAX_QUESTIONS) return finish(all);
    if (blk.length < 2) {
      setBlock(blk);
      if (!draw(level)) finish(all);
      return;
    }
    // End of a pair: move up, down or stay; stop once the boundary is clear.
    const right = blk.filter(Boolean).length;
    const next = right === 2 ? level + 1 : right === 0 ? level - 1 : level;
    setBlock([]);
    const visited = (l: number) => all.some((a) => a.level === l);
    const timesHere = all.filter((a) => a.level === level).length;
    if (next < 0 || next >= LEVELS.length || (next !== level && visited(next)) || (next === level && timesHere >= 4)) return finish(all);
    setLevel(next);
    if (!draw(next)) finish(all);
  };

  const save = async () => {
    if (pick === null) return;
    setSaving(true);
    const score = Math.round((asked.filter((a) => a.ok).length / Math.max(1, asked.length)) * 100);
    await api("/api/me", { method: "PATCH", body: { level: LEVELS[pick].key, placement: true, score } });
    onDone();
    location.hash = "#/";
  };

  return (
    <div className="ex placement">
      <header className="ex-top">
        <a className="icon-btn" href="#/" aria-label="Thoát">
          <X size={26} weight="bold" />
        </a>
        <div className="ex-progress grow">
          <span style={{ width: `${phase === "result" ? 100 : Math.max(3, (asked.length / MAX_QUESTIONS) * 100)}%` }} />
        </div>
        {phase === "test" && (
          <span className="muted small">
            {asked.length + 1}/{MAX_QUESTIONS}
          </span>
        )}
      </header>

      {phase === "intro" && (
        <main className="ex-body center place-intro">
          <Mascot name={mascot} mood="cheer" className="place-mascot" />
          <h1 className="ex-title">Bài kiểm tra xếp lớp</h1>
          <p className="muted">
            Tối đa {MAX_QUESTIONS} câu, khoảng 3 phút: ngữ pháp, từ vựng, nghe và đọc. Câu hỏi khó dần hoặc dễ dần theo câu trả lời
            của bạn. Không biết thì cứ bấm <b>“Mình chưa biết”</b>, đừng đoán bừa nhé.
          </p>
          <div className="level-ladder">
            {LEVELS.map((l) => (
              <span key={l.key}>
                <Fx name={l.fx} size={40} tile />
                <b>{l.key}</b>
              </span>
            ))}
          </div>
          <button className="btn primary big" onClick={start}>
            BẮT ĐẦU <ArrowRight size={20} weight="bold" />
          </button>
        </main>
      )}

      {phase === "test" && item && (
        <>
          <main className="ex-body">
            <span className="kind-chip">{KIND_LABEL[item.it.kind]}</span>
            <div className="ex-prompt">
              <div className="ex-mascot-frame">
                <Mascot name={mascot} mood={mood} className="ex-mascot" shot="bust" />
              </div>
              <div className="ex-speech">
                <div className="speech">{item.it.kind === "listen" ? item.it.q : item.it.kind === "read" ? "Đọc đoạn văn rồi trả lời." : "Chọn đáp án đúng."}</div>
                {item.it.kind === "listen" && item.it.text && (
                  <div className="play-row big">
                    <button className="play" onClick={() => speak(item.it.text!, { rate: 0.95 })} aria-label="Nghe">
                      <SpeakerHigh size={34} weight="fill" />
                    </button>
                    <button className="play slow" onClick={() => speak(item.it.text!, { rate: 0.6 })} aria-label="Nghe chậm">
                      <span className="slow-label">0.6×</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            {item.it.kind === "read" && <p className="place-text">{item.it.text}</p>}
            {item.it.kind !== "listen" && <h2 className="place-q">{item.it.q}</h2>}
            <div className="options">
              {item.options.map((o, k) => (
                <button key={o} className={`option ${sel === o ? "sel" : ""}`} onClick={() => setSel(o)}>
                  <span className="opt-key">{"ABCD"[k]}</span>
                  {o}
                </button>
              ))}
            </div>
          </main>
          <footer className="ex-foot idle">
            <div className="ex-foot-inner">
              <button className="btn ghost" onClick={() => answer(null)}>
                MÌNH CHƯA BIẾT
              </button>
              <button className="btn primary wide" disabled={sel === null} onClick={() => answer(sel)}>
                TIẾP
              </button>
            </div>
          </footer>
        </>
      )}

      {phase === "result" && pick !== null && (
        <main className="ex-body center place-result">
          <div className="place-stage">
            <Mascot name={mascot} mood="cheer" className="place-mascot" />
          </div>
          <p className="muted">Trình độ của bạn khoảng</p>
          <div className={`level-badge lvl-${LEVELS[pick].key}`}>
            <Fx name={LEVELS[pick].fx} size={44} />
            <b>{LEVELS[pick].key}</b>
            <span>{LEVELS[pick].label}</span>
          </div>
          <p>{LEVELS[pick].blurb}</p>
          <p className="muted small">
            Đúng {asked.filter((a) => a.ok).length}/{asked.length} câu. Muốn chọn cấp khác thì bấm vào bên dưới.
          </p>
          <div className="seg">
            {LEVELS.map((l, k) => (
              <button key={l.key} className={pick === k ? "on" : ""} onClick={() => setPick(k)}>
                {l.key}
              </button>
            ))}
          </div>
          <button className="btn primary big" onClick={save} disabled={saving}>
            HỌC TỪ CẤP {LEVELS[pick].key} <ArrowRight size={20} weight="bold" />
          </button>
        </main>
      )}
    </div>
  );
}
