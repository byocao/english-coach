import { useState } from "react";
import { api } from "./api";
import { MASCOT_CREDIT, Mascot } from "./Mascot";

export function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
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
  };

  return (
    <div className="login-page">
      <Mascot name="hiyori" mood="cheer" className="login-hero" say="Hi! Mình là Hiyori. Cùng học tiếng Anh mỗi ngày nhé!" />
      <div className="login-card">
        <span className="logo-mark big">EC</span>
        <h1>English Coach</h1>
        <p className="lead">
          Luyện <b>đọc</b>, <b>nghe</b> và <b>nói</b> tiếng Anh với bài học do AI soạn theo trình độ của bạn. Ghi âm giọng
          đọc và nhận điểm cùng góp ý bằng tiếng Việt.
        </p>
        <div className="tabs login-tabs" role="tablist">
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
        <p className="credit">{MASCOT_CREDIT}</p>
      </div>
    </div>
  );
}
