import { useState } from "react";
import { api } from "./api";
import { MASCOT_CREDIT, Mascot } from "./Mascot";
import { Fx, STEPS } from "./meta";

export function Login({ mode: initial = "login" }: { mode?: "login" | "register" }) {
  const [mode, setMode] = useState<"login" | "register">(initial);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && password !== password2) return setError("Hai mật khẩu không khớp.");
    setBusy(true);
    try {
      await api(`/auth/${mode}`, { body: { username, password } });
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const switchTo = (m: "login" | "register") => {
    setMode(m);
    setError("");
    history.replaceState(null, "", `#/${m}`);
  };

  return (
    <div className="login-page">
      <a className="login-back" href="#/">
        ← Trang chủ
      </a>
      <div className="login-hero">
        <Mascot name="wanko" mood="cheer" className="login-mascot" />
        <p className="login-bubble">Gâu! Mình là Wanko. Cùng học tiếng Anh mỗi ngày nhé!</p>
      </div>
      <div className="login-card">
        <h1 className="login-title">
          <img src="/icons/wancha-192.png" alt="" width={56} height={56} />
          Wancha
        </h1>
        <p className="login-tagline">Học tiếng Anh cùng Wanko</p>
        <p className="lead">
          Hơn 80 bài học có sẵn từ A1 đến C1, thêm bài mới mỗi ngày. Học từ, nghe, chép chính tả, <b>nói và được AI chấm phát âm</b>, góp ý bằng tiếng Việt.
        </p>
        <ul className="login-feats">
          {STEPS.map((s) => (
            <li key={s.key}>
              <Fx name={s.fx} size={40} tile />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <div className="seg login-tabs" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "tab on" : "tab"} onClick={() => switchTo("login")}>
            Đăng nhập
          </button>
          <button
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "tab on" : "tab"}
            onClick={() => switchTo("register")}
          >
            Đăng ký
          </button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Tên đăng nhập</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={24}
              required
            />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "register" ? 8 : 1}
              maxLength={128}
              required
            />
          </label>
          {mode === "register" && (
            <label className="field">
              <span>Nhập lại mật khẩu</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
                required
              />
            </label>
          )}
          {mode === "register" && <p className="muted small">3–24 ký tự: chữ thường, số và . _ -. Mật khẩu ít nhất 8 ký tự.</p>}
          {error && <p className="error">{error}</p>}
          <button className="btn primary full" disabled={busy}>
            {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
        </form>
        <p className="muted small">Tài khoản mới được dùng thử miễn phí một số lượt AI.</p>
        <p className="credit">{MASCOT_CREDIT} Icon: Phosphor Icons (MIT).</p>
      </div>
    </div>
  );
}
