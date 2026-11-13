// Public landing page for visitors who are not signed in. Sign-in lives on its own page (#/login, #/register).
import { COMPANIONS, MASCOT_CREDIT, type MascotName } from "./Mascot";
import { CATEGORIES, Fx, LEVELS, STEPS } from "./meta";

const STEP_DETAIL: Record<string, string> = {
  words: "Lật thẻ, nghe phát âm chuẩn, ghép từ với nghĩa và điền từ vào câu.",
  listen: "Nghe câu do giọng tự nhiên đọc rồi xếp các từ đúng thứ tự.",
  dictation: "Gõ lại những gì nghe được, sai chỗ nào được tô màu ngay.",
  speak: "Đọc to từng câu, AI chấm điểm và chỉ rõ từ nào cần sửa.",
  read: "Đọc cả bài, bấm vào từ để tra, bấm câu để AI giải thích bằng tiếng Việt.",
  quiz: "Trả lời câu hỏi đọc hiểu để chắc là bạn đã nắm bài.",
};

const DEMO: { w: string; s: "ok" | "unclear" | "missing" }[] = [
  { w: "I", s: "ok" },
  { w: "ordered", s: "unclear" },
  { w: "a", s: "ok" },
  { w: "large", s: "ok" },
  { w: "iced", s: "unclear" },
  { w: "latte", s: "ok" },
  { w: "with", s: "ok" },
  { w: "oat", s: "missing" },
  { w: "milk.", s: "ok" },
];

const FAQ: [string, string][] = [
  [
    "Wancha có miễn phí không?",
    "Có. Toàn bộ 40 bài học có sẵn, nghe, chép chính tả, đọc hiểu và thử thách đều miễn phí. Mỗi tài khoản mới còn được tạo 1 bài học riêng bằng AI và chấm điểm phát âm 10 lần.",
  ],
  [
    "AI chấm phát âm như thế nào?",
    "Bạn đọc to một câu. Máy nhận dạng giọng nói nghe xem bạn nói ra những từ nào, rồi AI so với câu mẫu: từ nào rõ, từ nào nghe chưa ra, từ nào bị nuốt, kèm mẹo sửa bằng tiếng Việt.",
  ],
  [
    "Có cần cài ứng dụng không?",
    "Không. Wancha chạy ngay trên trình duyệt của điện thoại hay máy tính. Trên điện thoại bạn có thể chọn \"Thêm vào màn hình chính\" để mở như một app.",
  ],
  [
    "Mình chưa biết trình độ của mình?",
    "Làm bài xếp lớp ngắn (tối đa 12 câu, khoảng 3 phút). Wancha sẽ đưa bạn vào đúng cấp từ A1 đến C1.",
  ],
];

const COMPANION_LIST: MascotName[] = ["wanko", "tororo", "hijiki", "hiyori", "haru"];

/** In-page links: the app's router owns location.hash, so scroll instead of navigating. */
function jump(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

export function Landing() {
  return (
    <div className="landing">
      <header className="lp-nav">
        <a className="lp-brand" href="#/">
          <img src="/icons/wancha-192.png" alt="" width={40} height={40} />
          <span>Wancha</span>
        </a>
        <nav className="lp-links" aria-label="Trang giới thiệu">
          <a href="#features" onClick={jump("features")}>
            Tính năng
          </a>
          <a href="#how" onClick={jump("how")}>
            Cách học
          </a>
          <a href="#faq" onClick={jump("faq")}>
            Hỏi đáp
          </a>
        </nav>
        <div className="lp-nav-cta">
          <a className="btn ghost small" href="#/login">
            Đăng nhập
          </a>
          <a className="btn primary small lp-hide-xs" href="#/register">
            Bắt đầu miễn phí
          </a>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <span className="lp-kicker">
              <Fx name="sparkles" size={16} /> Học tiếng Anh cho người Việt
            </span>
            <h1>
              Học tiếng Anh mỗi ngày <span className="lp-accent">cùng Wanko</span>
            </h1>
            <p className="lp-sub">
              40 bài học có sẵn từ A1 đến C1. Học từ vựng, nghe, chép chính tả, đọc hiểu và <b>luyện nói được AI chấm phát âm</b>,
              mọi giải thích đều bằng tiếng Việt.
            </p>
            <div className="lp-cta">
              <a className="btn primary big" href="#/register">
                Bắt đầu miễn phí
              </a>
              <a className="btn ghost big" href="#/login">
                Mình đã có tài khoản
              </a>
            </div>
            <ul className="lp-trust">
              <li>
                <Fx name="check_mark_button" size={18} /> Miễn phí
              </li>
              <li>
                <Fx name="check_mark_button" size={18} /> Không cần cài đặt
              </li>
              <li>
                <Fx name="check_mark_button" size={18} /> Dùng tốt trên điện thoại
              </li>
            </ul>
          </div>
          <div className="lp-hero-art">
            <img src="/icons/wanko-matcha.png" alt="Chú cún Wanko ngồi trong bát matcha" width={420} height={420} />
            <div className="lp-float lp-float-score">
              <span className="score good">92</span>
              <div>
                <b>Điểm phát âm</b>
                <small>“Every morning I grab an iced latte.”</small>
              </div>
            </div>
            <div className="lp-float lp-float-streak">
              <Fx name="fire" size={22} /> <b>7 ngày</b> liên tiếp
            </div>
          </div>
        </section>

        <section className="lp-section" id="features">
          <h2>Mỗi bài học là 6 bước luyện tập</h2>
          <p className="lp-lead">Một đoạn văn ngắn, học trọn bốn kỹ năng: từ vựng, nghe, nói và đọc.</p>
          <div className="lp-grid lp-steps">
            {STEPS.map((s) => (
              <article key={s.key} className="lp-card">
                <Fx name={s.fx} size={48} tile />
                <h3>{s.label}</h3>
                <p>{STEP_DETAIL[s.key] ?? s.hint}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-split">
          <div>
            <span className="lp-kicker">
              <Fx name="microphone" size={16} /> Luyện nói
            </span>
            <h2>AI nghe bạn đọc và chỉ ra từng từ cần sửa</h2>
            <p className="lp-lead">
              Đọc to một câu, Wancha cho điểm độ rõ ràng, tô màu từ đúng, từ chưa rõ và từ bị nuốt, rồi gợi ý cách sửa những lỗi
              người Việt hay gặp: âm cuối /t/ /d/ /s/, đuôi -ed và -s, /θ/ và /ð/.
            </p>
          </div>
          <div className="lp-demo" aria-label="Ví dụ kết quả chấm phát âm">
            <div className="lp-demo-head">
              <span className="score mid">72</span>
              <b>Khá tốt, còn nuốt âm cuối</b>
            </div>
            <p className="lp-demo-words">
              {DEMO.map((d, i) => (
                <span key={i} className={`dw ${d.s}`}>
                  {d.w}
                </span>
              ))}
            </p>
            <ul className="lp-demo-tips">
              <li>
                <b>ordered</b>: bật rõ âm /d/ cuối.
              </li>
              <li>
                <b>oat</b>: bạn bỏ mất từ này, đọc /əʊt/.
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-section" id="how">
          <h2>Bắt đầu trong 3 bước</h2>
          <ol className="lp-grid lp-how">
            <li className="lp-card">
              <span className="lp-num">1</span>
              <h3>Làm bài xếp lớp</h3>
              <p>Khoảng 3 phút để biết bạn nên bắt đầu từ A1, A2, B1, B2 hay C1.</p>
            </li>
            <li className="lp-card">
              <span className="lp-num">2</span>
              <h3>Học theo lộ trình</h3>
              <p>Mỗi ngày một bài ngắn, đi qua đủ 6 bước, nhận XP và giữ chuỗi ngày học.</p>
            </li>
            <li className="lp-card">
              <span className="lp-num">3</span>
              <h3>Luyện nói mỗi ngày</h3>
              <p>Đọc to, xem điểm, sửa từng từ. Tiến bộ được ghi lại trong hồ sơ của bạn.</p>
            </li>
          </ol>
        </section>

        <section className="lp-section">
          <h2>Đủ 5 cấp độ, từ mới bắt đầu đến nâng cao</h2>
          <div className="lp-levels">
            {LEVELS.map((l) => (
              <div key={l.key} className={`lp-level lvl-${l.key}`}>
                <Fx name={l.fx} size={30} />
                <b>{l.key}</b>
                <span>{l.label}</span>
                <small>{l.blurb}</small>
              </div>
            ))}
          </div>
          <div className="lp-topics" aria-label="Chủ đề">
            {CATEGORIES.map((c) => (
              <span key={c.key}>
                <Fx name={c.fx} size={18} /> {c.label}
              </span>
            ))}
          </div>
        </section>

        <section className="lp-section">
          <h2>Chọn bạn đồng hành</h2>
          <p className="lp-lead">Wanko, hai chú mèo Tororo và Hijiki, Hiyori hay cô giáo Haru sẽ cổ vũ bạn trong từng bài.</p>
          <div className="lp-companions">
            {COMPANION_LIST.map((k) => (
              <div key={k} className="lp-companion">
                <span aria-hidden="true">{COMPANIONS[k].emoji}</span>
                <b>{COMPANIONS[k].label}</b>
                <small>{COMPANIONS[k].kind}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="faq">
          <h2>Câu hỏi thường gặp</h2>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => (
              <details key={q} className="lp-card">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <img src="/icons/wanko-matcha.png" alt="" width={140} height={140} />
          <h2>Sẵn sàng học cùng Wanko?</h2>
          <p>Tạo tài khoản trong 10 giây, không cần email.</p>
          <a className="btn primary big" href="#/register">
            Bắt đầu miễn phí
          </a>
        </section>
      </main>

      <footer className="lp-footer">
        <span>© Wancha</span>
        <a href="https://github.com/byocao" target="_blank" rel="noreferrer">
          Liên hệ
        </a>
        <p className="credit">{MASCOT_CREDIT} Icon: Phosphor Icons (MIT).</p>
      </footer>
    </div>
  );
}
