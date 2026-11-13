import type { Env } from "./env";

export type Provider = "claude" | "workers-ai";

export interface AiResult<T> {
  data: T;
  provider: Provider;
  note?: string;
}

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

interface JsonTask {
  system: string;
  prompt: string;
  schema: object;
  maxTokens: number;
}

/** Structured output from Workers AI (free tier); used for sentence explanations. */
export async function runJson<T>(env: Env, task: JsonTask): Promise<AiResult<T>> {
  return { data: await workersAiJson<T>(env, task), provider: "workers-ai" };
}

async function workersAiJson<T>(env: Env, task: JsonTask): Promise<T> {
  let out: unknown;
  try {
    out = await env.AI.run(env.WORKERS_AI_MODEL as keyof AiModels, {
      messages: [
        { role: "system", content: task.system },
        { role: "user", content: task.prompt },
      ],
      response_format: { type: "json_schema", json_schema: task.schema },
      max_tokens: task.maxTokens,
    } as never);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/4006|neuron|daily|limit/i.test(msg)) {
      throw new AiError("Hết hạn mức AI miễn phí của Cloudflare hôm nay. Thử lại sau 7 giờ sáng (00:00 UTC).", 429);
    }
    throw new AiError(`Workers AI lỗi: ${msg}`);
  }
  const response = (out as { response?: unknown })?.response ?? out;
  if (typeof response === "string") {
    try {
      return JSON.parse(response) as T;
    } catch {
      throw new AiError("AI trả về dữ liệu không đúng định dạng, hãy thử lại.");
    }
  }
  return response as T;
}

/** Speech-to-text with Whisper on Workers AI. `audioBase64` is a 16 kHz mono WAV. */
export async function transcribe(env: Env, audioBase64: string): Promise<string> {
  try {
    const out = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioBase64,
      language: "en",
      task: "transcribe",
    } as never)) as { text?: string };
    return (out.text ?? "").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/4006|neuron|daily|limit/i.test(msg)) {
      throw new AiError("Hết hạn mức AI miễn phí của Cloudflare hôm nay. Thử lại sau 7 giờ sáng (00:00 UTC).", 429);
    }
    throw new AiError(`Không nhận dạng được giọng nói: ${msg}`);
  }
}

/** Share of target words heard in order (LCS over normalised words). */
export function wordMatchRatio(target: string, heard: string): number {
  const a = normWords(target);
  const b = normWords(heard);
  if (a.length === 0) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

export function normWords(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // café -> cafe
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
