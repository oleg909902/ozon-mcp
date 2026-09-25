// Минимальный клиент Chrome DevTools Protocol поверх встроенного в Node WebSocket.
// Нужно совсем немного команд (вкладки, выполнение JS), поэтому без playwright/puppeteer.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type EventHandler = (params: any, sessionId?: string) => void;

const COMMAND_TIMEOUT_MS = 60_000;

export class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, Set<EventHandler>>();
  private closed = false;

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => this.onMessage(String(e.data)));
    ws.addEventListener("close", () => this.onClose());
  }

  /** Подключается к браузеру по HTTP-адресу отладочного порта (http://host:port) */
  static async connect(httpUrl: string, timeoutMs = 15_000): Promise<CdpConnection> {
    const res = await fetch(new URL("/json/version", httpUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`CDP ${httpUrl}: HTTP ${res.status}`);
    const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl: string };
    // Chrome пишет в ссылку свой адрес; за туннелем или в Docker он другой — берём хост из CDP_URL
    const wsUrl = new URL(webSocketDebuggerUrl);
    wsUrl.host = new URL(httpUrl).host;

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${wsUrl}: таймаут подключения`)), timeoutMs);
      ws.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
      ws.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`CDP ${wsUrl}: не удалось подключиться`))), { once: true });
    });
    return new CdpConnection(ws);
  }

  get isConnected(): boolean {
    return !this.closed;
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error("CDP: соединение закрыто"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method}: таймаут`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  close(): void {
    this.ws.close();
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`CDP: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.handlers.get(msg.method)?.forEach((h) => h(msg.params, msg.sessionId));
    }
  }

  private onClose(): void {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("CDP: соединение закрыто"));
    }
    this.pending.clear();
    this.handlers.get("close")?.forEach((h) => h(undefined));
  }
}
