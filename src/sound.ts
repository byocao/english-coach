// Tiny synthesized sound effects (no audio files): correct, wrong, lesson complete.

let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem("ec_sound") !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem("ec_sound", on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function ready(): boolean {
  if (!soundOn()) return false;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export const sfx = {
  correct() {
    if (!ready()) return;
    tone(659, 0, 0.14, "triangle");
    tone(988, 0.1, 0.22, "triangle");
  },
  wrong() {
    if (!ready()) return;
    tone(220, 0, 0.18, "square", 0.05);
    tone(185, 0.12, 0.25, "square", 0.05);
  },
  complete() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, "triangle"));
  },
  tap() {
    if (!ready()) return;
    tone(880, 0, 0.05, "sine", 0.05);
  },
};
