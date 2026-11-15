// Microphone recording (-> 16 kHz mono WAV for Whisper) and browser text-to-speech.

export interface Recording {
  url: string; // playable blob URL of the original recording
  wavBase64: string;
  seconds: number;
}

export interface Recorder {
  stop(): Promise<Recording>;
  cancel(): void;
}

const MAX_SECONDS = 30;

export async function startRecording(onAutoStop?: () => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const mr = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start();
  const autoStop = setTimeout(() => onAutoStop?.(), MAX_SECONDS * 1000);

  const finish = () =>
    new Promise<Blob>((resolve) => {
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: mr.mimeType }));
      };
      if (mr.state !== "inactive") mr.stop();
    });

  return {
    async stop() {
      clearTimeout(autoStop);
      const blob = await finish();
      const { wav, seconds } = await toWav16k(blob);
      return { url: URL.createObjectURL(blob), wavBase64: await blobToBase64(wav), seconds };
    },
    cancel() {
      clearTimeout(autoStop);
      void finish();
    },
  };
}

async function toWav16k(blob: Blob): Promise<{ wav: Blob; seconds: number }> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);

  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return { wav: new Blob([buf], { type: "audio/wav" }), seconds: decoded.duration };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---- Text-to-speech -------------------------------------------------------------
// The default voice is a natural AI voice (Deepgram Aura-2, synthesised by the Worker and cached). The browser's
// own voices are the fallback, and a choice in Profile. Browser voices are ranked: neural/"Natural" voices (Edge),
// Apple Premium/Enhanced, Google voices (Chrome, Android), then the rest.

const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|pipe organ|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;
const FEMALE =
  /\b(ava|emma|jenny|aria|michelle|samantha|allison|susan|zoe|karen|serena|moira|libby|sonia|natasha|clara|female|tessa|victoria|fiona|catherine|zira|hazel)\b/i;

function voiceScore(v: SpeechSynthesisVoice): number {
  const n = v.name;
  let s = 0;
  if (/natural|neural/i.test(n)) s += 100; // Edge "Microsoft Ava Online (Natural)", Windows Natural voices
  else if (/premium/i.test(n)) s += 90; // Apple
  else if (/enhanced/i.test(n)) s += 80; // Apple
  else if (/online/i.test(n)) s += 60;
  else if (/^google/i.test(n)) s += 50; // Chrome desktop
  else if (/-x-|network/i.test(v.voiceURI) && !v.localService) s += 45; // Android Google network voices
  else if (/^(samantha|ava|allison|zoe|evan|nathan|tom|susan|karen|daniel|serena|moira)\b/i.test(n)) s += 30; // decent Apple voices
  if (/multilingual/i.test(n)) s -= 5; // English-only voices pronounce English slightly better
  if (NOVELTY.test(n)) s -= 200;
  const lang = v.lang.toLowerCase().replace("_", "-");
  s += lang === "en-us" ? 6 : lang === "en-gb" ? 4 : /^en-(au|ca|ie|nz)/.test(lang) ? 2 : 0;
  if (FEMALE.test(n)) s += 2;
  return s;
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

/** True for the browser voices worth labelling as natural-sounding in the picker. */
export function isNaturalVoice(v: SpeechSynthesisVoice): boolean {
  return voiceScore(v) >= 45;
}

export function onVoicesChanged(fn: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => {};
  speechSynthesis.addEventListener("voiceschanged", fn);
  return () => speechSynthesis.removeEventListener("voiceschanged", fn);
}

/** Chrome fills the voice list asynchronously; wait briefly so the first sentence does not use the system default. */
function voicesReady(): Promise<void> {
  if (!("speechSynthesis" in window) || speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 1000);
  });
}

/** AI voices (Deepgram Aura-2 speakers) offered in Profile. */
export const AI_VOICES = [
  { id: "asteria", label: "Asteria (nữ, Mỹ)" },
  { id: "luna", label: "Luna (nữ, Mỹ)" },
  { id: "athena", label: "Athena (nữ)" },
  { id: "orion", label: "Orion (nam, Mỹ)" },
  { id: "arcas", label: "Arcas (nam, Mỹ)" },
  { id: "apollo", label: "Apollo (nam)" },
] as const;

/**
 * The voice the user picked in Profile: "ai:<speaker>" for an AI voice, "browser:<voiceURI>" (or "browser:" for the
 * best one) for a browser voice. Empty means the default AI voice. (A new key, so everyone moves to the AI voice once.)
 */
const VOICE_KEY = "wancha_voice";

export function preferredVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) || "";
  } catch {
    return "";
  }
}

export function setPreferredVoice(choice: string) {
  try {
    if (choice) localStorage.setItem(VOICE_KEY, choice);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    /* private mode */
  }
}

/** Splits long text into sentence-sized pieces (Chrome's Google voices stop after ~15 s; the AI voice takes 400 chars). */
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (out.length && (out[out.length - 1] + " " + t).length <= 160) out[out.length - 1] += " " + t;
    else out.push(t);
  }
  return out.length ? out : [text];
}

/** Callers pass 0.95 for normal and 0.6 for slow. */
const isSlow = (rate?: number) => (rate ?? 1) < 0.8;

// -- AI voice ------------------------------------------------------------------------

/** Off for the rest of the visit once the server says the daily allowance is used up (or the voice is unavailable). */
let aiOff = false;
const clips = new Map<string, Promise<string | null>>();
let player: HTMLAudioElement | null = null;

function aiSpeaker(choice = preferredVoice()): string | null {
  if (aiOff || typeof Audio === "undefined") return null;
  if (choice.startsWith("browser:")) return null;
  const id = choice.startsWith("ai:") ? choice.slice(3) : "asteria";
  return AI_VOICES.some((v) => v.id === id) ? id : "asteria";
}

/** The audio of one short text as a blob URL, fetched once per visit; null when the AI voice is not available. */
function clip(text: string, speaker: string): Promise<string | null> {
  const key = `${speaker}|${text}`;
  let p = clips.get(key);
  if (!p) {
    p = fetch(`/api/tts?v=${speaker}&t=${encodeURIComponent(text)}`, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 429 || r.status === 403) aiOff = true;
          clips.delete(key);
          return null;
        }
        return URL.createObjectURL(await r.blob());
      })
      .catch(() => {
        clips.delete(key);
        return null;
      });
    clips.set(key, p);
    // Keep memory bounded: forget the oldest clips.
    if (clips.size > 120) {
      const [oldKey, old] = clips.entries().next().value!;
      clips.delete(oldKey);
      void old.then((u) => u && URL.revokeObjectURL(u));
    }
  }
  return p;
}

/** Starts fetching the audio of `text` so the next play is instant. */
export function prefetchSpeech(text: string) {
  const sp = aiSpeaker();
  if (sp && text.trim()) for (const piece of chunks(text.trim())) void clip(piece, sp);
}

/** One audio element for the whole app: iOS only lets an element play without a tap once it has played after one. */
function audioEl(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.preload = "auto";
  }
  return player;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    const a = audioEl();
    // A tiny silent WAV, played on the first tap, unlocks the element for later automatic plays.
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    void a.play().catch(() => {});
    removeEventListener("pointerdown", unlock, true);
  };
  addEventListener("pointerdown", unlock, true);
}

async function playAi(pieces: string[], speaker: string, slow: boolean, token: number): Promise<boolean> {
  for (const piece of pieces) {
    const url = await clip(piece, speaker);
    if (token !== speakToken) return true;
    if (!url) return false;
    const a = audioEl();
    a.src = url;
    a.playbackRate = slow ? 0.72 : 1;
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    const ended = new Promise<void>((resolve) => {
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.onpause = () => resolve();
    });
    try {
      await a.play();
    } catch {
      return false;
    }
    await ended;
    if (token !== speakToken) return true;
  }
  return true;
}

// -- Browser voice -------------------------------------------------------------------------

async function playBrowser(pieces: string[], slow: boolean, voiceURI: string, token: number) {
  if (!("speechSynthesis" in window)) return;
  await voicesReady();
  if (token !== speakToken) return;
  const voices = englishVoices();
  const voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0] ?? null;
  await new Promise<void>((resolve) => {
    pieces.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      u.voice = voice;
      u.lang = voice?.lang ?? "en-US";
      // Below ~0.75 many browser voices start reading word by word.
      u.rate = slow ? 0.78 : 1;
      if (i === pieces.length - 1) {
        u.onend = () => resolve();
        u.onerror = () => resolve();
      }
      speechSynthesis.speak(u);
    });
  });
}

let speakToken = 0;

/**
 * Reads `text` aloud with the chosen voice (AI by default, browser as fallback). `rate` below 0.8 means slow.
 * `voice` overrides the saved choice (for "Nghe thử" in Profile).
 */
export async function speak(text: string, opts: { rate?: number; voice?: string } = {}): Promise<void> {
  const token = ++speakToken;
  stopAudio();
  const clean = text.trim();
  if (!clean) return;
  const pieces = chunks(clean);
  const choice = opts.voice ?? preferredVoice();
  const speaker = aiSpeaker(choice);
  if (speaker && (await playAi(pieces, speaker, isSlow(opts.rate), token))) return;
  if (token !== speakToken) return;
  await playBrowser(pieces, isSlow(opts.rate), choice.startsWith("browser:") ? choice.slice(8) : "", token);
}

function stopAudio() {
  if (player && !player.paused) player.pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export function stopSpeaking() {
  speakToken++;
  stopAudio();
}

// ---- Word alignment for dictation ------------------------------------------------

export function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function norm(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9']/g, "");
}

/** Marks each target word as heard/typed correctly, using LCS alignment. */
export function alignWords(target: string, attempt: string): { word: string; ok: boolean }[] {
  const a = words(target);
  const b = words(attempt).map(norm).filter(Boolean);
  const an = a.map(norm);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = an[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const ok = new Array<boolean>(a.length).fill(false);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (an[i - 1] === b[j - 1]) {
      ok[i - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return a.map((word, k) => ({ word, ok: ok[k] || an[k] === "" }));
}
