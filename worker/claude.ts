// Claude API calls, with every call's cost logged to D1 for the monthly budget.
import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "./ai";
import type { Env } from "./env";

/** USD per million tokens [input, output]. Anything not listed is priced at the most expensive rate below. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const FALLBACK_PRICE: [number, number] = [10, 50];

export function budgetUsd(env: Env): number {
  return Number(env.MONTHLY_BUDGET_USD) || 70;
}

/** Claude spend since the start of the current UTC month. */
export async function monthSpend(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_spend WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now')",
  ).first<{ usd: number }>();
  return row?.usd ?? 0;
}

export async function overBudget(env: Env): Promise<boolean> {
  return (await monthSpend(env)) >= budgetUsd(env);
}

interface ClaudeTask {
  kind: "lesson" | "grade";
  userId: number;
  model: string;
  system: string;
  prompt: string;
  schema: object;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  /** Skip thinking for short, well-specified tasks (faster; Haiku 5.5 allows it at effort high or below). */
  noThinking?: boolean;
}

/** One structured-output request; returns the parsed JSON and records what it cost. */
export async function claudeJson<T>(env: Env, task: ClaudeTask): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) throw new AiError("Chưa cấu hình khoá Claude API.", 503);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: task.model,
      max_tokens: task.maxTokens,
      system: task.system,
      messages: [{ role: "user", content: task.prompt }],
      output_config: { effort: task.effort, format: { type: "json_schema", schema: task.schema as Record<string, unknown> } },
      ...(task.noThinking ? { thinking: { type: "disabled" } } : {}),
      // Opus 5.5: if a safety classifier declines, the API re-runs the request on a fallback model.
      ...(task.model.startsWith("claude-opus") ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("Khoá Claude API không hợp lệ hoặc không có quyền.", 502);
    }
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Claude đang quá tải, hãy thử lại sau ít phút.", 429);
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude API lỗi ${err.status ?? ""}: ${err.message}`, 502);
    throw new AiError(`Không gọi được Claude API: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  await recordSpend(env, task, res);

  if (res.stop_reason === "refusal") throw new AiError("Claude từ chối yêu cầu này, hãy thử chủ đề khác.", 422);
  if (res.stop_reason === "max_tokens") throw new AiError("Câu trả lời của AI bị cắt ngang, hãy thử lại.", 502);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("AI trả về dữ liệu không đúng định dạng, hãy thử lại.", 502);
  }
}

async function recordSpend(env: Env, task: ClaudeTask, res: Anthropic.Beta.BetaMessage) {
  const u = res.usage;
  // Cache writes/reads are not used here, but count them at the input rate if they ever appear.
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  const [pin, pout] = PRICES[res.model] ?? FALLBACK_PRICE;
  const cost = (input * pin + output * pout) / 1_000_000;
  await env.DB.prepare(
    "INSERT INTO ai_spend (user_id, kind, model, input_tokens, output_tokens, cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(task.userId, task.kind, res.model, input, output, cost)
    .run();
}
