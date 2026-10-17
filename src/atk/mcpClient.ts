// ATK istemcisi: resmi @okx_ai/okx-trade-mcp stdio sunucusunu alt süreç olarak başlatır.
// Her çağrı SignalLedger'a yazılır. Okuma modunda sunucu --read-only ile açılır.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import type { SignalLedger } from "../ledger/signalLedger.js";
import { assertToolAllowed } from "../trading/hardLimits.js";
import { log, mask } from "../util/log.js";

export interface AtkOptions {
  site: string;
  readOnly: boolean;
  credentials?: { apiKey: string; secret: string; passphrase: string };
  timeoutMs?: number;
  concurrency?: number;
}

export class AtkError extends Error {
  constructor(
    message: string,
    readonly type = "AtkError",
  ) {
    super(message);
    this.name = "AtkError";
  }
}

export interface AtkCaller {
  call<T = any>(tool: string, args: Record<string, unknown>): Promise<T>;
  available(): boolean;
  toolNames(): string[];
}

function summarize(v: unknown, max = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return mask(s.length > max ? s.slice(0, max) + "…" : s);
}

export class AtkMcpClient implements AtkCaller {
  private client: Client | null = null;
  private starting: Promise<void> | null = null;
  private tools: string[] = [];
  private active = 0;
  private queue: (() => void)[] = [];
  private lastFailAt = 0;

  constructor(
    private readonly opts: AtkOptions,
    private readonly ledger: SignalLedger,
  ) {}

  available(): boolean {
    return this.client !== null;
  }

  toolNames(): string[] {
    return [...this.tools];
  }

  async start(): Promise<void> {
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const require = createRequire(import.meta.url);
    const bin = path.join(path.dirname(require.resolve("@okx_ai/okx-trade-mcp/package.json")), "dist/index.js");
    const hasCreds = Boolean(this.opts.credentials?.apiKey);
    const modules = ["market", "news", "smartmoney", ...(hasCreds ? ["account", "spot"] : [])].join(",");
    const args = [bin, "--modules", modules, "--site", this.opts.site, "--no-log"];
    if (this.opts.readOnly) args.push("--read-only");
    else args.push("--live");
    // Alt sürece yalnızca gereken değişkenler gider (Gemini/Telegram anahtarları gitmez).
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      OKX_UPDATE_CHECK: "0",
    };
    if (hasCreds && this.opts.credentials) {
      env.OKX_API_KEY = this.opts.credentials.apiKey;
      env.OKX_SECRET_KEY = this.opts.credentials.secret;
      env.OKX_PASSPHRASE = this.opts.credentials.passphrase;
    }
    const transport = new StdioClientTransport({ command: process.execPath, args, env, stderr: "pipe" });
    const client = new Client({ name: "timosai", version: "0.1.0" });
    await client.connect(transport);
    const list = await client.listTools();
    this.tools = list.tools.map((t) => t.name);
    this.client = client;
    transport.onclose = () => {
      this.client = null;
    };
    log.info(`ATK bağlandı: ${this.tools.length} araç (site=${this.opts.site}, ${this.opts.readOnly ? "salt okuma" : "işlem açık"})`);
  }

  private async slot(): Promise<void> {
    const max = this.opts.concurrency ?? 4;
    if (this.active < max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.queue.push(r));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  async call<T = any>(tool: string, args: Record<string, unknown>): Promise<T> {
    assertToolAllowed(tool);
    if (!this.client) {
      if (Date.now() - this.lastFailAt < 15_000) throw new AtkError("ATK bağlantısı yok");
      try {
        await this.start();
      } catch (e) {
        this.lastFailAt = Date.now();
        throw new AtkError(`ATK başlatılamadı: ${(e as Error).message}`);
      }
    }
    await this.slot();
    const t0 = Date.now();
    try {
      const timeout = this.opts.timeoutMs ?? 20_000;
      const res: any = await Promise.race([
        this.client!.callTool({ name: tool, arguments: args }),
        new Promise((_, rej) => setTimeout(() => rej(new AtkError("ATK zaman aşımı", "Timeout")), timeout)),
      ]);
      const text: string = res?.content?.[0]?.text ?? "";
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: true, message: text };
      }
      if (res?.isError || parsed?.error) {
        const msg = parsed?.message ?? "bilinmeyen hata";
        this.ledger.recordAtk({ tool, params: summarize(args), result: summarize(`HATA: ${parsed?.type ?? ""} ${msg}`), ok: false, ms: Date.now() - t0 });
        throw new AtkError(msg, parsed?.type ?? "AtkError");
      }
      const data = parsed?.data?.data ?? parsed?.data ?? parsed;
      this.ledger.recordAtk({ tool, params: summarize(args), result: summarize(resultSummary(data)), ok: true, ms: Date.now() - t0 });
      return data as T;
    } catch (e) {
      if (!(e instanceof AtkError)) {
        this.ledger.recordAtk({ tool, params: summarize(args), result: summarize(`HATA: ${(e as Error).message}`), ok: false, ms: Date.now() - t0 });
      }
      throw e instanceof AtkError ? e : new AtkError((e as Error).message);
    } finally {
      this.release();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* yok say */
    }
    this.client = null;
  }
}

function resultSummary(data: unknown): string {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "last" in (first as any)) return `${data.length} kayıt, ilk: ${(first as any).instId} ${(first as any).last}`;
    return `${data.length} kayıt`;
  }
  return JSON.stringify(data).slice(0, 120);
}
