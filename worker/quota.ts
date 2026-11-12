import type { Env, User } from "./env";

export function trialLimit(env: Env): number {
  return Number(env.TRIAL_AI_LIMIT) || 15;
}

export function quota(env: Env, user: User) {
  if (user.role === "trial") {
    const limit = trialLimit(env);
    return { limited: true, used: user.ai_used, limit, left: Math.max(0, limit - user.ai_used) };
  }
  return { limited: false, used: user.ai_used, limit: null, left: null };
}
