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
  ADMIN_PASSWORD: string; // password for the ADMIN_LOGIN account (not stored in D1)
  BRIDGE_TOKEN: string;
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
