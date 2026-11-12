import type { BridgeHub } from "./bridge-hub";

export interface Env {
  AI: Ai;
  DB: D1Database;
  BRIDGE: DurableObjectNamespace<BridgeHub>;
  ASSETS: Fetcher;

  ADMIN_LOGIN: string;
  CONTACT_URL: string;
  TRIAL_AI_LIMIT: string;
  WORKERS_AI_MODEL: string;

  // Secrets (wrangler secret put / .dev.vars)
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BRIDGE_TOKEN: string;
  DEV_LOGIN?: string; // "1" only in .dev.vars: enables /auth/dev for local testing
}

export type Role = "admin" | "member" | "trial" | "blocked";

export interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  ai_used: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
