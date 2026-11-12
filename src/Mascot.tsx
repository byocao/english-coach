// Live2D companions. Official Live2D sample characters used under the Live2D Free Material License:
// Wanko (the puppy in a teacup), Hiyori Momose and Haru, plus Tororo & Hijiki (cats) when the owner
// has added them (see scripts/fetch-live2d.mjs). Rendered with pixi-live2d-display on Cubism Core,
// both loaded lazily so pages without a companion stay light.
import { createContext, useContext, useEffect, useRef, useState } from "react";

export type MascotName = "wanko" | "tororo" | "hijiki" | "hiyori" | "haru";
export type Mood = "idle" | "happy" | "cheer" | "sad" | "oops" | "think" | "surprised";
export type Shot = "full" | "bust";

interface ModelInfo {
  label: string;
  kind: string;
  emoji: string;
  /** Share of the figure's height kept in frame: 1 = whole body. */
  frame: Record<Shot, number>;
  /** Extra zoom for models whose canvas is much larger than the drawing (whole-body shots). */
  zoom?: number;
  /** Empty model-space below the drawing (in model units). */
  bottomGap?: number;
  /** For busts: share of the figure's height to skip at the top (empty canvas above the head). */
  top?: number;
  faces?: Partial<Record<Mood, string>>;
  /** Motion groups to play when happy / sad / tapped (defaults: TapBody, Shake, TapBody). */
  motions?: { happy: string; sad: string; tap: string };
}

const CAT_MOTIONS = { happy: "Tap", sad: "FlickDown", tap: "Tap" };

export const COMPANIONS: Record<MascotName, ModelInfo> = {
  wanko: { label: "Wanko", kind: "Cún trong tách trà", emoji: "🐶", frame: { full: 1, bust: 1 }, zoom: 1.75 },
  tororo: { label: "Tororo", kind: "Mèo trắng", emoji: "🐱", frame: { full: 1, bust: 0.5 }, top: 0.2, motions: CAT_MOTIONS },
  hijiki: { label: "Hijiki", kind: "Mèo đen", emoji: "🐈‍⬛", frame: { full: 1, bust: 0.5 }, top: 0.2, motions: CAT_MOTIONS },
  hiyori: { label: "Hiyori", kind: "Nữ sinh", emoji: "🌸", frame: { full: 0.85, bust: 0.6 } },
  haru: {
    label: "Haru",
    kind: "Cô giáo",
    emoji: "🎀",
    frame: { full: 0.85, bust: 0.45 },
    // Haru's expression files: F05 closed-eye smile, F02 excited, F04 worried, F08 disappointed, F06 surprised, F01 calm.
    faces: { idle: "F01", happy: "F05", cheer: "F02", sad: "F04", oops: "F08", think: "F01", surprised: "F06" },
  },
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
let manifest: Promise<Partial<Record<MascotName, string>>> | null = null;

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

/** Which companions this deployment actually has (the cats are optional). */
export function availableCompanions(): Promise<Partial<Record<MascotName, string>>> {
  manifest ??= fetch("/live2d/models.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return manifest;
}

function webglOk(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl");
  } catch {
    return false;
  }
}

/**
 * A Live2D companion filling its box. `mood` plays a motion (and a face, for models that have
 * expressions); `say` shows a speech bubble. Missing models fall back to Wanko, then to an emoji.
 */
export function Mascot({
  name,
  mood = "idle",
  say,
  className = "",
  shot = "full",
}: {
  name: MascotName;
  mood?: Mood;
  say?: React.ReactNode;
  className?: string;
  shot?: Shot;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<Live2DModelT | null>(null);
  const [failed, setFailed] = useState(() => typeof window !== "undefined" && !webglOk());
  const [shown, setShown] = useState<MascotName>(name);

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
        const [{ PIXI, Live2DModel }, urls] = await Promise.all([loadLibs(), availableCompanions()]);
        const pick: MascotName = urls[name] ? name : "wanko";
        const url = urls[pick];
        if (!url) throw new Error("no model");
        const box = boxRef.current;
        const canvas = canvasRef.current;
        if (disposed || !box || !canvas) return;
        setShown(pick);
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
        const model = await Live2DModel.from(url, { autoInteract: false });
        if (disposed) {
          model.destroy();
          return;
        }
        app.stage.addChild(model as never);
        modelRef.current = model;
        model.scale.set(1);
        const fig = model.getLocalBounds();
        // Space under the drawing inside the model canvas, so whole figures stand on the bottom edge.
        const bottomGap = COMPANIONS[pick].bottomGap ?? 0;
        const frame = COMPANIONS[pick].frame[shot];
        const place = () => {
          const r = box.getBoundingClientRect();
          if (!app || r.width === 0) return;
          app.renderer.resize(r.width, r.height);
          // Whole-body framing must fit the width too; a bust may let the arms overflow.
          const byHeight = (r.height * 0.96) / (fig.height * frame);
          const k = (frame >= 0.8 ? Math.min(byHeight, (r.width * 0.96) / fig.width) : byHeight) * (frame >= 0.8 ? (COMPANIONS[pick].zoom ?? 1) : 1);
          model.scale.set(k);
          model.x = r.width / 2 - (fig.x + fig.width / 2) * k;
          // Whole figures sit on the bottom edge; busts hang from the top.
          model.y = frame >= 0.8 ? r.height * 0.98 - (fig.y + fig.height) * k + bottomGap * k : r.height * 0.02 - (fig.y + (COMPANIONS[pick].top ?? 0) * fig.height) * k;
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
  }, [name, failed, shot]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const face = COMPANIONS[shown].faces?.[mood];
    if (face) void model.expression(face);
    const m = COMPANIONS[shown].motions ?? { happy: "TapBody", sad: "Shake", tap: "TapBody" };
    if (mood === "happy" || mood === "cheer" || mood === "surprised") void model.motion(m.happy, undefined, 3);
    if (mood === "sad" || mood === "oops") void model.motion(m.sad, undefined, 3);
  }, [mood, shown]);

  const info = COMPANIONS[shown];
  return (
    <div className={`mascot ${className}`} ref={boxRef} onClick={() => void modelRef.current?.motion(COMPANIONS[shown].motions?.tap ?? "TapBody", undefined, 2)}>
      {failed ? (
        <div className="mascot-fallback" aria-hidden="true">
          {info.emoji}
        </div>
      ) : (
        <canvas ref={canvasRef} aria-label={info.label} role="img" />
      )}
      {say && <div className="bubble">{say}</div>}
    </div>
  );
}

/** The learner's chosen companion, provided by the app shell. */
export const CompanionContext = createContext<MascotName>("wanko");
export const useCompanion = () => useContext(CompanionContext);

export const MASCOT_CREDIT =
  "Nhân vật Wanko, Hiyori Momose (minh hoạ: Kani Biimu), Haru, Tororo và Hijiki là mẫu chính thức của Live2D Inc., dùng theo Live2D Free Material License. © Live2D Inc. Live2D Cubism Core © Live2D Inc.";
