import type { OzonClient } from "../ozon/client.js";
import { BASE_URL, parseNumber } from "../ozon/format.js";
import { ldJson, widget, widgets, type PageData, type Raw } from "../ozon/page-data.js";
import { resolveSku } from "../ozon/sku.js";
import { getReviews, type Review } from "./reviews.js";

export type Seller = {
  name: string | null;
  url: string | null;
  rating: number | null;
  orders: string | null;
  /** Юрлицо, ОГРН и т.п. из «О магазине» */
  legal: string[];
};

export type VariantGroup = {
  name: string;
  options: { sku: string; value: string | null; price: number | null; available: boolean; active: boolean }[];
};

export type ProductReviews =
  | { total: number | null; rating: number | null; scores: Record<string, number>; shown: number; items: Review[] }
  | { error: string };

export type Product = {
  sku: string;
  name: string | null;
  brand: string | null;
  url: string;
  available: boolean | null;
  price: number | null;
  original_price: number | null;
  price_per_unit: string | null;
  rating: number | null;
  reviews_count: number | null;
  questions: number | null;
  category: string[];
  seller: Seller | null;
  characteristics: Record<string, string>;
  variants: VariantGroup[];
  description: string | null;
  images: string[];
  reviews?: ProductReviews;
  /** Доп. блоки описания, например «Комплектация» */
  [extra: string]: unknown;
};

export async function getProduct(ozon: OzonClient, input: string, { reviews = 20 }: { reviews?: number } = {}): Promise<Product> {
  const sku = await resolveSku(ozon, input);
  const data = await ozon.fetchPage(`/product/${sku}/`);
  // Вторая часть страницы: полные характеристики, описание, комплектация
  const data2: PageData = await ozon
    .fetchPage(`/product/${sku}/?layout_container=pdpPage2column&layout_page_index=2`)
    .catch(() => ({}));

  // schema.org Product из SEO-блока: бренд, описание, цена, наличие, рейтинг
  const ld = ldJson(data, "Product");
  const price = widget(data, "webPrice");
  const descriptions = widgets(data2, "webDescription");

  const product: Product = {
    sku,
    name: ld?.name ?? widget(data, "webProductHeading")?.title ?? null,
    brand: ld?.brand ?? null,
    url: ld?.offers?.url ?? `${BASE_URL}/product/${sku}/`,
    available: price?.isAvailable ?? (ld?.offers?.availability?.endsWith("InStock") || null),
    price: parseNumber(price?.price) ?? parseNumber(ld?.offers?.price),
    original_price: parseNumber(price?.originalPrice),
    price_per_unit: price?.pricePerUnit ? `${price.pricePerUnit} ${price.measurePerUnit ?? ""}`.trim() : null,
    rating: ld?.aggregateRating ? Number(ld.aggregateRating.ratingValue) : null,
    reviews_count: ld?.aggregateRating ? Number(ld.aggregateRating.reviewCount) : null,
    questions: parseNumber(widget(data, "webQuestionCount")?.text),
    category: (widget(data, "breadCrumbs")?.breadcrumbs ?? []).map((c: Raw) => c.text),
    seller: parseSeller(widget(data, "webCurrentSeller")),
    characteristics: parseCharacteristics(widget(data2, "webCharacteristics"), widget(data, "webShortCharacteristics")),
    ...descriptionExtras(descriptions),
    variants: parseVariants(widget(data, "webAspects")),
    description: descriptionText(descriptions) || ld?.description || null,
    images: (widget(data, "webGallery")?.images ?? []).map((i: Raw) => i.src),
  };

  if (reviews > 0) product.reviews = await attachedReviews(ozon, sku, reviews);
  return product;
}

async function attachedReviews(ozon: OzonClient, sku: string, limit: number): Promise<ProductReviews> {
  try {
    const r = await getReviews(ozon, sku, { limit });
    return { total: r.total, rating: r.rating, scores: r.scores, shown: r.reviews.length, items: r.reviews };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function parseSeller(seller: Raw): Seller | null {
  if (!seller) return null;
  const trust: Raw[] = seller.trustFactors ?? [];
  return {
    name: seller.sellerCell?.centerBlock?.title?.text ?? null,
    url: seller.sellerCell?.common?.action?.link ?? null,
    rating: parseNumber(seller.rating?.title?.text),
    orders: trust.find((t) => t.title?.text === "Заказы")?.badge?.text ?? null,
    legal: (trust.find((t) => t.title?.text === "О магазине")?.tooltip?.subtitle ?? [])
      .filter((s: Raw) => s.type === "text")
      .map((s: Raw) => s.content),
  };
}

const joinValues = (values: Raw[]): string =>
  values
    .map((v) => v.text?.trim())
    .filter((t) => t && t !== ",")
    .join(", ");

/** Полные характеристики (группы short + long), если их нет — короткие из первой части страницы */
function parseCharacteristics(full: Raw, short: Raw): Record<string, string> {
  if (full) {
    return Object.fromEntries(
      full.characteristics
        .flatMap((g: Raw) => [...(g.short ?? []), ...(g.long ?? [])])
        .map((c: Raw) => [c.name, joinValues(c.values ?? [])])
    );
  }
  return Object.fromEntries(
    (short?.characteristics ?? []).map((c: Raw) => [
      c.title?.textRs?.map((t: Raw) => t.content).join("") ?? c.id,
      joinValues(c.values),
    ])
  );
}

function parseVariants(aspects: Raw): VariantGroup[] {
  return (aspects?.aspects ?? []).map((a: Raw) => ({
    name: a.aspectName,
    options: a.variants.map((v: Raw) => ({
      sku: v.sku,
      value: v.data?.textRs?.map((t: Raw) => t.content).join("") ?? null,
      price: parseNumber(v.data?.price),
      available: v.availability === "inStock",
      active: Boolean(v.active),
    })),
  }));
}

/** Текст описания из richAnnotationJson всех виджетов описания */
function descriptionText(descriptions: Raw[]): string {
  return descriptions
    .map((d) => (d.richAnnotationJson ? richText(d.richAnnotationJson.content) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Доп. блоки описания: { "Комплектация": "..." } */
function descriptionExtras(descriptions: Raw[]): Record<string, string> {
  return Object.fromEntries(descriptions.flatMap((d) => d.characteristics ?? []).map((c: Raw) => [c.title, c.content]));
}

/** Текст из вложенных блоков rich-описания (items[].content, title, text, blocks) */
function richText(node: Raw): string {
  if (Array.isArray(node)) return node.map(richText).join("");
  if (!node || typeof node !== "object") return "";
  if (node.type === "br") return "\n";
  let out = typeof node.content === "string" ? node.content : richText(node.content);
  for (const k of ["title", "text", "items", "blocks"]) {
    if (node[k] && typeof node[k] === "object") out += richText(node[k]);
  }
  if (node.widgetName || node.gapSize) out += "\n\n";
  return out;
}
