// Доступ к Ozon через уже запущенный Chrome.
// Запросы выполняются внутри вкладки ozon.ru — с её cookie, сессией и прокси браузера,
// поэтому антибот Ozon их пропускает, а cookie никуда не извлекаются.
import { Browser, type PageInfo } from "../cdp/browser.js";
import { BASE_URL } from "./format.js";
import { SerialQueue } from "./serial-queue.js";
import type { PageData } from "./page-data.js";

const FETCH_TIMEOUT_MS = 25_000;

export class OzonClient {
  private browser: Browser;
  // Запросы идут по одному: так меньше шансов нарваться на антибот
  private queue = new SerialQueue();

  constructor(cdpUrl: string) {
    this.browser = new Browser(cdpUrl);
  }

  /** JSON любой страницы Ozon: GET /api/entrypoint-api.bx/page/json/v2?url=<path> */
  fetchPage(path: string): Promise<PageData> {
    return this.queue.run(async () => {
      let { status, data } = await this.fetchJson(path);
      if (isChallenge(data)) {
        // Протухли cookie антибота — проходим проверку во временной вкладке и повторяем
        const passed = await this.passAntibot(data.challengeURL);
        ({ status, data } = await this.fetchJson(path));
        if (isChallenge(data)) {
          throw new Error(
            passed
              ? "Ozon снова показал антибот-проверку сразу после её прохождения — попробуй чуть позже"
              : "Ozon показал антибот-проверку, и браузер не смог пройти её сам. Открой ozon.ru в серверном браузере (Remmina) и обнови страницу"
          );
        }
      }
      if (status >= 400) throw new Error(`Ozon HTTP ${status}`);
      return data;
    });
  }

  /** Куда ведёт ссылка на ozon.ru после редиректов (для коротких ссылок /t/xxxx) */
  resolveRedirect(path: string): Promise<string> {
    return this.queue.run(async () => {
      const page = await this.ozonPage();
      return this.browser.evaluate(page, async (path) => (await fetch(path, { redirect: "follow" })).url, path);
    });
  }

  /**
   * Пока сервер простаивает, раз в intervalMin минут обновляет cookie антибота,
   * чтобы первый запрос после паузы не упирался в проверку.
   */
  startAntibotRefresh(intervalMin: number): void {
    if (intervalMin <= 0) return;
    setInterval(() => {
      if (Date.now() - this.queue.lastActivity < 60_000) return; // не мешаем идущим запросам
      this.queue.run(() => this.passAntibot()).catch(() => {});
    }, intervalMin * 60_000).unref();
  }

  /**
   * Антибот Ozon ставит cookie, когда страница загружается по-настоящему и выполняет его скрипт.
   * Фоновый fetch этого не умеет, поэтому открываем страницу проверки во временной вкладке,
   * ждём, пока браузер её пройдёт, и закрываем. Cookie общие для всего браузера.
   */
  private async passAntibot(challengeUrl?: string): Promise<boolean> {
    let tab: PageInfo | null = null;
    try {
      tab = await this.browser.openPage(challengeUrl || BASE_URL + "/", 45_000);
      // Проверка сама перезагружает страницу на обычную после прохождения
      await this.browser.waitFor(tab, () => !location.pathname.includes("challenge") && /ozon/i.test(document.title), 40_000);
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    } catch {
      return false;
    } finally {
      if (tab) await this.browser.closePage(tab);
    }
  }

  /** Вкладка ozon.ru, из которой делаются запросы (без неё fetch уйдёт без cookie сайта) */
  private async ozonPage(): Promise<PageInfo> {
    const pages = await this.browser.pages();
    return pages.find((p) => p.url.startsWith(BASE_URL)) ?? this.browser.openPage(BASE_URL + "/");
  }

  private async fetchJson(path: string): Promise<{ status: number; data: PageData }> {
    const page = await this.ozonPage();
    const res = await this.browser.evaluate(
      page,
      async ({ path, timeout }) => {
        const r = await fetch(`/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(path)}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeout),
        });
        return { status: r.status, body: await r.text() };
      },
      { path, timeout: FETCH_TIMEOUT_MS }
    );
    try {
      return { status: res.status, data: JSON.parse(res.body) };
    } catch {
      throw new Error(`Ozon вернул не JSON (HTTP ${res.status})`);
    }
  }
}

const isChallenge = (data: PageData) => Boolean(data.incidentId || data.challengeURL);
