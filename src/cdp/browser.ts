// Вкладки браузера и выполнение в них JS — всё, что нужно от Chrome
import { CdpConnection } from "./connection.js";

export type PageInfo = { targetId: string; url: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  private connecting: Promise<CdpConnection> | null = null;
  /** targetId вкладки -> sessionId, через который в ней выполняется JS */
  private sessions = new Map<string, string>();

  constructor(private cdpUrl: string) {}

  private async connection(): Promise<CdpConnection> {
    if (this.connecting) {
      const conn = await this.connecting.catch(() => null);
      if (conn?.isConnected) return conn;
    }
    this.connecting = CdpConnection.connect(this.cdpUrl).then((conn) => {
      this.sessions.clear();
      conn.on("Target.detachedFromTarget", ({ targetId }) => this.sessions.delete(targetId));
      conn.on("close", () => (this.connecting = null));
      return conn;
    });
    return this.connecting;
  }

  async pages(): Promise<PageInfo[]> {
    const conn = await this.connection();
    const { targetInfos } = await conn.send<{ targetInfos: (PageInfo & { type: string })[] }>("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page").map(({ targetId, url }) => ({ targetId, url }));
  }

  /** Открывает вкладку и ждёт, пока загрузится DOM (как goto с waitUntil: "domcontentloaded") */
  async openPage(url: string, timeoutMs = 30_000): Promise<PageInfo> {
    const conn = await this.connection();
    const { targetId } = await conn.send<{ targetId: string }>("Target.createTarget", { url });
    const page = { targetId, url };
    try {
      await this.waitFor(page, () => location.href !== "about:blank" && document.readyState !== "loading", timeoutMs);
    } catch (e) {
      await this.closePage(page);
      throw new Error(`Не удалось открыть ${url}: ${(e as Error).message}`);
    }
    return page;
  }

  async closePage(page: PageInfo): Promise<void> {
    const conn = await this.connection();
    this.sessions.delete(page.targetId);
    await conn.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
  }

  /** Выполняет функцию внутри вкладки и возвращает результат (он должен сериализоваться в JSON) */
  async evaluate<A, R>(page: PageInfo, fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const conn = await this.connection();
    const sessionId = await this.session(conn, page.targetId);
    const { result, exceptionDetails } = await conn.send(
      "Runtime.evaluate",
      { expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
    }
    return result.value as R;
  }

  /** Ждёт, пока условие во вкладке станет истинным. Переживает перезагрузки страницы. */
  async waitFor(page: PageInfo, predicate: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Во время навигации контекст страницы пересоздаётся и evaluate может упасть — просто пробуем ещё
      if (await this.evaluate(page, predicate).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error("таймаут ожидания");
  }

  private async session(conn: CdpConnection, targetId: string): Promise<string> {
    let sessionId = this.sessions.get(targetId);
    if (!sessionId) {
      ({ sessionId } = await conn.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true }));
      this.sessions.set(targetId, sessionId!);
    }
    return sessionId!;
  }
}
