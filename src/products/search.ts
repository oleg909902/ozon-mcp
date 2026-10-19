import type { OzonClient } from "../ozon/client.js";
import { absoluteUrl, parseNumber } from "../ozon/format.js";
import { widget, type PageData, type Raw } from "../ozon/page-data.js";

export const SEARCH_SORTS = ["score", "price", "price_desc", "rating", "new", "discount"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export type SearchItem = {
  sku: string;
  name: string | null;
  price: number | null;
  original_price: number | null;
  discount: string | null;
  rating: number | null;
  reviews: number | null;
  labels: string[];
  badge: string | null;
  delivery: string | null;
  image: string | null;
  url: string | null;
};

export type SearchResult = {
  query: string;
  page: number;
  category: string | null;
  count: number;
  /** Есть ли ещё товары дальше (page + 1) */
  has_more: boolean;
  items: SearchItem[];
  /** Подсказки для модели, как уточнить выдачу */
  hints?: string[];
};

/** Предел запросов к Ozon за один вызов (порция ~8 товаров, ~1,5 с) — чтобы не уйти в бесконечную прокрутку */
const MAX_CHUNKS_PER_CALL = 12;

/**
 * Уже прокрученная выдача по запросу: товары по порядку и ссылка на следующую порцию.
 * Нужна, чтобы page=2 продолжал ту же прокрутку — если начинать с ?page=N, Ozon перемешивает
 * выдачу и товары повторяются. Живёт 10 минут.
 */
type Scroll = { items: SearchItem[]; next: string | null; category: string | null; at: number; seen: Set<string> };
const SCROLL_TTL_MS = 10 * 60_000;
const scrolls = new Map<string, Scroll>();

/**
 * Поиск. Ozon отдаёт выдачу порциями по ~8 товаров (бесконечная прокрутка): первая порция
 * содержит виджет infiniteVirtualPaginator со ссылкой nextPage, следующие — nextPage в корне ответа.
 * Идём по цепочке, пока не наберём товары нужной страницы. page — страница из limit товаров.
 */
export async function searchProducts(
  ozon: OzonClient,
  { query, sort, page = 1, limit = 24 }: { query: string; sort?: SearchSort; page?: number; limit?: number }
): Promise<SearchResult> {
  const params = new URLSearchParams({ text: query });
  if (sort && sort !== "score") params.set("sorting", sort);
  const key = params.toString();
  for (const [k, v] of scrolls) if (Date.now() - v.at > SCROLL_TTL_MS) scrolls.delete(k);

  let scroll = scrolls.get(key);
  if (!scroll || page === 1) {
    scroll = { items: [], next: `/search/?${params}`, category: null, at: Date.now(), seen: new Set() };
    scrolls.set(key, scroll);
  }
  const need = page * limit;
  for (let i = 0; scroll.next && scroll.items.length < need && i < MAX_CHUNKS_PER_CALL; i++) {
    const data = await ozon.fetchPage(scroll.next);
    if (!scroll.items.length && data.layoutTrackingInfo) scroll.category = JSON.parse(data.layoutTrackingInfo).categoryName ?? null;
    const tiles = Object.entries(data.widgetStates ?? {})
      .filter(([k]) => k.startsWith("tileGridDesktop-"))
      .flatMap(([, v]) => (JSON.parse(v).items ?? []) as Raw[])
      .map(parseTile);
    for (const t of tiles) if (!scroll.seen.has(t.sku)) (scroll.seen.add(t.sku), scroll.items.push(t));
    scroll.next = tiles.length ? nextPagePath(data) : null;
  }
  scroll.at = Date.now();

  const items = scroll.items.slice((page - 1) * limit, need);
  const result: SearchResult = {
    query,
    page,
    category: scroll.category,
    count: items.length,
    has_more: scroll.items.length > need || !!scroll.next,
    items,
  };
  const hints = searchHints(sort, items);
  if (hints.length) result.hints = hints;
  return result;
}

/** Ссылка на следующую порцию выдачи */
function nextPagePath(data: PageData): string | null {
  const top = (data as Raw).nextPage;
  if (typeof top === "string" && top) return top;
  const paginator = widget(data, "infiniteVirtualPaginator");
  return paginator?.nextPage || null;
}

/** Плитка товара в выдаче */
function parseTile(item: Raw): SearchItem {
  const state: Raw[] = item.mainState ?? [];
  const priceBlock = state.find((s) => s.type === "priceV2")?.priceV2;
  const prices: Raw[] = priceBlock?.price ?? [];
  const labels: string[] = state
    .filter((s) => s.type === "labelListV2")
    .flatMap((s) => s.labelListV2.items.map((i: Raw) => i.text?.text).filter(Boolean));
  // Рейтинг и число отзывов лежат среди меток: "4.8", "1 234 отзыва"
  const rating = labels.find((t) => /^\d(\.\d)?$/.test(t));
  const reviews = labels.find((t) => /отзыв/.test(t));

  return {
    sku: String(item.sku),
    name: state.find((s) => s.id === "name")?.textDS?.text ?? null,
    price: parseNumber(prices.find((p) => p.textStyle === "PRICE")?.text),
    original_price: parseNumber(prices.find((p) => p.textStyle === "ORIGINAL_PRICE")?.text),
    discount: priceBlock?.discount ?? null,
    rating: rating ? Number(rating) : null,
    reviews: reviews ? parseNumber(reviews) : null,
    labels: labels.filter((t) => t !== rating && t !== reviews),
    badge: item.tileImage?.leftBottomBadgeV2?.text ?? null,
    delivery: item.multiButton?.ozonButton?.addToCart?.actionButton?.title ?? null,
    image: item.tileImage?.items?.find((i: Raw) => i.type === "image")?.image?.link ?? null,
    url: absoluteUrl(item.action?.link),
  };
}

function searchHints(sort: SearchSort | undefined, items: SearchItem[]): string[] {
  const hints: string[] = [];
  if (sort === "price" || sort === "price_desc")
    hints.push(
      "При сортировке по цене в начало часто попадают аксессуары и похожие товары — проверь, что это нужный тип товара; если нет, уточни запрос (модель, объём, «видеокарта», «комплект» и т.п.)."
    );
  if (!items.length) hints.push("Ничего не найдено — переформулируй запрос короче или без лишних слов.");
  if (items.length && items.every((i) => !i.rating))
    hints.push("У товаров нет оценок — перед рекомендацией стоит открыть get_product и проверить продавца.");
  return hints;
}
