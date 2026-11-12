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

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.lang === "en-US" ? 1 : 0);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => score(b) - score(a));
}

export function onVoicesChanged(fn: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => {};
  speechSynthesis.addEventListener("voiceschanged", fn);
  return () => speechSynthesis.removeEventListener("voiceschanged", fn);
}

export function speak(text: string, opts: { rate?: number; voiceURI?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = englishVoices();
    u.voice = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices[0] ?? null;
    u.lang = u.voice?.lang ?? "en-US";
    u.rate = opts.rate ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// ---- Word alignment for dictation ------------------------------------------------

export function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function norm(w: string): string {
  return w.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']/g, "");
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
