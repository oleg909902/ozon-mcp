import type { OzonClient } from "../ozon/client.js";
import { absoluteUrl, parseNumber } from "../ozon/format.js";
import { widget, type Raw } from "../ozon/page-data.js";

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
  items: SearchItem[];
  /** Подсказки для модели, как уточнить выдачу */
  hints?: string[];
};

export async function searchProducts(
  ozon: OzonClient,
  { query, sort, page = 1 }: { query: string; sort?: SearchSort; page?: number }
): Promise<SearchResult> {
  const params = new URLSearchParams({ text: query });
  if (sort && sort !== "score") params.set("sorting", sort);
  if (page > 1) params.set("page", String(page));
  const data = await ozon.fetchPage(`/search/?${params}`);

  const items: SearchItem[] = (widget(data, "tileGridDesktop")?.items ?? []).map(parseTile);
  const result: SearchResult = {
    query,
    page,
    category: data.layoutTrackingInfo ? (JSON.parse(data.layoutTrackingInfo).categoryName ?? null) : null,
    count: items.length,
    items,
  };
  const hints = searchHints(sort, items);
  if (hints.length) result.hints = hints;
  return result;
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
