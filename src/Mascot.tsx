// Live2D mascots: Hiyori Momose (guide) and Haru (coach), official Live2D sample characters
// used under the Live2D Free Material License. Rendered with pixi-live2d-display on Cubism Core,
// both loaded lazily so pages without a mascot stay light.
import { useEffect, useRef, useState } from "react";

export type MascotName = "hiyori" | "haru";
export type Mood = "idle" | "happy" | "cheer" | "sad" | "oops" | "think" | "surprised";

const MODELS: Record<MascotName, string> = {
  hiyori: "/live2d/Hiyori/Hiyori.model3.json",
  haru: "/live2d/Haru/Haru.model3.json",
};

// Haru's expression files, read from their parameters: F05 closed-eye smile, F02 excited,
// F04 worried, F08 disappointed, F06 surprised, F01 calm smile.
const HARU_FACE: Record<Mood, string> = {
  idle: "F01",
  happy: "F05",
  cheer: "F02",
  sad: "F04",
  oops: "F08",
  think: "F01",
  surprised: "F06",
};

type Live2DModelT = {
  scale: { set(v: number): void };
  x: number;
  y: number;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
  motion(group: string, index?: number, priority?: number): Promise<boolean>;
  expression(id?: string | number): Promise<boolean>;
  focus(x: number, y: number): void;
  destroy(): void;
};

interface Libs {
  PIXI: typeof import("pixi.js");
  Live2DModel: { from(url: string, opts?: object): Promise<Live2DModelT> };
}

let libs: Promise<Libs> | null = null;

function loadLibs(): Promise<Libs> {
  libs ??= (async () => {
    const w = window as unknown as { Live2DCubismCore?: unknown; PIXI?: unknown };
    if (!w.Live2DCubismCore) {
      await new Promise<void>((ok, fail) => {
        const s = document.createElement("script");
        s.src = "/live2d/live2dcubismcore.min.js";
        s.onload = () => ok();
        s.onerror = () => fail(new Error("Cubism Core missing"));
        document.head.appendChild(s);
      });
    }
    const PIXI = await import("pixi.js");
    w.PIXI = PIXI; // pixi-live2d-display looks for it on window
    const { Live2DModel } = (await import("pixi-live2d-display/cubism4")) as unknown as Pick<Libs, "Live2DModel">;
    return { PIXI, Live2DModel };
  })();
  libs.catch(() => {
    libs = null;
  });
  return libs;
}

function webglOk(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl");
  } catch {
    return false;
  }
}

/**
 * A Live2D character filling its box (framed from the head down to about the knees).
 * `mood` switches Haru's face and plays a body motion on happy moods; `say` shows a speech bubble.
 */
export function Mascot({
  name,
  mood = "idle",
  say,
  className = "",
  frame = 0.85,
}: {
  name: MascotName;
  mood?: Mood;
  say?: React.ReactNode;
  className?: string;
  frame?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<Live2DModelT | null>(null);
  const [failed, setFailed] = useState(() => typeof window !== "undefined" && !webglOk());

  useEffect(() => {
    if (failed) return;
    let disposed = false;
    let app: InstanceType<Libs["PIXI"]["Application"]> | null = null;
    let ro: ResizeObserver | null = null;
    const onPointer = (e: PointerEvent) => {
      const c = canvasRef.current;
      if (!c || !modelRef.current) return;
      const r = c.getBoundingClientRect();
      modelRef.current.focus(e.clientX - r.left, e.clientY - r.top);
    };

    (async () => {
      try {
        const { PIXI, Live2DModel } = await loadLibs();
        const box = boxRef.current;
        const canvas = canvasRef.current;
        if (disposed || !box || !canvas) return;
        const b = box.getBoundingClientRect();
        app = new PIXI.Application({
          view: canvas,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          width: Math.max(1, b.width),
          height: Math.max(1, b.height),
        });
        const model = await Live2DModel.from(MODELS[name], { autoInteract: false });
        if (disposed) {
          model.destroy();
          return;
        }
        app.stage.addChild(model as never);
        modelRef.current = model;
        model.scale.set(1);
        const fig = model.getLocalBounds();
        const place = () => {
          const r = box.getBoundingClientRect();
          if (!app || r.width === 0) return;
          app.renderer.resize(r.width, r.height);
          // Full-body framing must fit the width too; a bust (frame < 0.8) may let the arms overflow.
          const byHeight = (r.height * 0.98) / (fig.height * frame);
          const k = frame >= 0.8 ? Math.min(byHeight, (r.width * 0.98) / fig.width) : byHeight;
          model.scale.set(k);
          model.x = r.width / 2 - (fig.x + fig.width / 2) * k;
          model.y = r.height * 0.02 - fig.y * k;
        };
        place();
        ro = new ResizeObserver(place);
        ro.observe(box);
        addEventListener("pointermove", onPointer);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      removeEventListener("pointermove", onPointer);
      ro?.disconnect();
      modelRef.current = null;
      try {
        app?.destroy(false, { children: true });
      } catch {
        /* already gone */
      }
    };
  }, [name, failed, frame]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    if (name === "haru") void model.expression(HARU_FACE[mood]);
    if (mood === "happy" || mood === "cheer") void model.motion("TapBody", undefined, 3);
  }, [mood, name]);

  return (
    <div className={`mascot ${className}`} ref={boxRef}>
      {failed ? (
        <div className="mascot-fallback" aria-hidden="true">
          {name === "hiyori" ? "🌸" : "🎀"}
        </div>
      ) : (
        <canvas ref={canvasRef} aria-label={name === "hiyori" ? "Hiyori" : "Haru"} role="img" />
      )}
      {say && <div className="bubble">{say}</div>}
    </div>
  );
}

export const MASCOT_CREDIT =
  "Nhân vật Hiyori Momose (minh hoạ: Kani Biimu) và Haru là mẫu chính thức của Live2D Inc., dùng theo Live2D Free Material License. © Live2D Inc. Live2D Cubism Core © Live2D Inc.";
