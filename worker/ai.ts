import type { Env, User } from "./env";

export type Provider = "claude" | "workers-ai";

export interface AiResult<T> {
  data: T;
  provider: Provider;
  note?: string; // shown to the user, e.g. "bridge offline, used Workers AI"
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

/**
 * Routes a structured-output task:
 *  - admin  -> Claude through the local CLI bridge (byocao's own subscription),
 *              falling back to Workers AI when the PC is offline;
 *  - others -> Workers AI (free tier). Other people's requests never go through
 *              the personal Claude plan.
 */
export async function runJson<T>(env: Env, user: User, task: JsonTask): Promise<AiResult<T>> {
  if (user.role === "admin") {
    try {
      const stub = env.BRIDGE.get(env.BRIDGE.idFromName("bridge"));
      const data = (await stub.run({ system: task.system, prompt: task.prompt, schema: task.schema })) as T;
      return { data, provider: "claude" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const data = await workersAiJson<T>(env, task);
      return { data, provider: "workers-ai", note: `Claude bridge: ${reason}. Đã dùng Workers AI thay thế.` };
    }
  }
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
