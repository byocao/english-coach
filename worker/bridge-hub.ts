import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/** A job the local bridge runs with `claude -p --json-schema`. */
export interface BridgeJob {
  system: string;
  prompt: string;
  schema: object;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const JOB_TIMEOUT_MS = 180_000;

/**
 * Holds the single WebSocket opened by `npm run bridge` on byocao's PC and
 * relays Claude jobs over it. Uses the hibernation API, so an idle bridge
 * costs nothing; keep-alive pings are answered without waking the object.
 */
export class BridgeHub extends DurableObject<Env> {
  private pending = new Map<string, Pending>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    // Only one bridge at a time: a new connection replaces the old one.
    for (const old of this.ctx.getWebSockets()) old.close(4000, "replaced by a newer bridge");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async status(): Promise<{ online: boolean }> {
    return { online: this.ctx.getWebSockets().length > 0 };
  }

  async run(job: BridgeJob): Promise<unknown> {
    const ws = this.ctx.getWebSockets()[0];
    if (!ws) throw new Error("bridge offline");
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("bridge timeout"));
      }, JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "job", id, ...job }));
    });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type !== "result" || !msg.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "bridge job failed"));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      /* already closed */
    }
    this.failAll("bridge disconnected");
  }

  async webSocketError(): Promise<void> {
    this.failAll("bridge error");
  }

  private failAll(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
