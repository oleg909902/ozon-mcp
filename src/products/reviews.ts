import type { OzonClient } from "../ozon/client.js";
import { isoDate } from "../ozon/format.js";
import { widget, type Raw } from "../ozon/page-data.js";
import { resolveSku } from "../ozon/sku.js";

/** Наши названия сортировок -> параметр Ozon */
const REVIEW_SORTS = { useful: "usefulness_desc", score_desc: "score_desc", score_asc: "score_asc" } as const;
export type ReviewSort = keyof typeof REVIEW_SORTS;
export const REVIEW_SORT_NAMES = Object.keys(REVIEW_SORTS) as [ReviewSort, ...ReviewSort[]];

export type Review = {
  date: string | null;
  author: string | null;
  score: number | null;
  text: string | null;
  pros: string | null;
  cons: string | null;
  photos: string[];
  useful: number;
  comments: string[];
  sku: string;
  /** К какому варианту товара относится отзыв: "Цвет: чёрный, Размер: M" */
  variant: string | null;
};

export type ReviewsPage = {
  sku: string;
  total: number | null;
  rating: number | null;
  /** Сколько отзывов с каждой оценкой */
  scores: Record<string, number>;
  sort: ReviewSort;
  page: number;
  per_page: number | null;
  has_next_page: boolean;
  reviews: Review[];
};

export async function getReviews(
  ozon: OzonClient,
  product: string,
  { sort = "useful", page = 1, limit }: { sort?: ReviewSort; page?: number; limit?: number } = {}
): Promise<ReviewsPage> {
  const sku = await resolveSku(ozon, product);
  const params = new URLSearchParams({ sort: REVIEW_SORTS[sort] ?? REVIEW_SORTS.useful });
  if (page > 1) params.set("page", String(page));
  const data = await ozon.fetchPage(`/product/${sku}/reviews/?${params}`);

  const list = widget(data, "webListReviews");
  const score = widget(data, "webReviewProductScore");
  // Отзывы собраны по всем вариантам товара — подписываем, к какому варианту относится каждый
  const variantOf = (itemId: string): string | null =>
    (list?.products?.[itemId]?.variants ?? []).map((v: Raw) => `${v.name}: ${v.value}`).join(", ") || null;

  const reviews: Review[] = (list?.reviews ?? []).slice(0, limit).map((r: Raw) => ({
    date: r.publishedAt ? isoDate(new Date(r.publishedAt * 1000)) : null,
    author: r.author?.firstName || null,
    score: r.content?.score ?? null,
    text: r.content?.comment || null,
    pros: r.content?.positive || null,
    cons: r.content?.negative || null,
    photos: (r.content?.photos ?? []).map((p: Raw) => p.url),
    useful: r.usefulness?.useful ?? 0,
    comments: (r.comments?.list ?? []).map((c: Raw) => c.text ?? c.content?.comment).filter(Boolean),
    sku: r.itemId,
    variant: variantOf(r.itemId),
  }));

  return {
    sku,
    total: list?.paging?.total ?? score?.reviewsCount ?? null,
    rating: score?.totalScore ?? null,
    scores: Object.fromEntries((score?.score ?? []).map((s: Raw) => [s.title, s.value])),
    sort,
    page,
    per_page: list?.paging?.perPage ?? null,
    has_next_page: Boolean(list?.paging?.nextButton),
    reviews,
  };
}
