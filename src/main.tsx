import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme } from "./theme";
import "./styles.css";

/** Turns a render crash into a friendly screen instead of a blank page. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="card">
          <h2>Ối, có lỗi rồi</h2>
          <p className="muted">Trang gặp sự cố khi hiển thị. Tải lại thường sẽ hết.</p>
          <p className="small muted">{this.state.error.message}</p>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => location.reload()}>
              Tải lại
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                location.hash = "#/";
                location.reload();
              }}
            >
              Về trang chủ
            </button>
          </div>
        </div>
      </div>
    );
  }
}

applyTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
);
