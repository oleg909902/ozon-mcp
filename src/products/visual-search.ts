// Визуальный поиск: выдача Ozon одной картинкой-коллажем с номерами + таблица номер → товар
import type { OzonClient } from "../ozon/client.js";
import { buildCollage, downloadImages } from "./collage.js";
import { resizedImage } from "./images.js";
import { searchProducts, type SearchSort } from "./search.js";

export type VisualSearchArgs = {
  query: string;
  sort?: SearchSort;
  page?: number;
  limit?: number;
  columns?: number;
  tile_px?: number;
};

export async function visualSearch(ozon: OzonClient, { query, sort, page = 1, limit = 24, columns, tile_px = 300 }: VisualSearchArgs) {
  const result = await searchProducts(ozon, { query, sort, page, limit });
  const items = result.items;
  const offset = (page - 1) * limit;
  if (!items.length) {
    return { summary: { query, page, shown: 0, items: [], hints: result.hints ?? ["Ничего не найдено"] }, collage: null };
  }
  // Ozon CDN отдаёт уменьшенную копию — качаем чуть больше плитки, чтобы не было мыла
  const px = tile_px <= 250 ? 300 : tile_px <= 400 ? 500 : 1000;
  const images = await downloadImages(items.map((i) => (i.image ? resizedImage(i.image, px) : null)));
  const collage = await buildCollage(
    items.map((_, i) => ({ n: offset + i + 1, image: images[i] })),
    { columns: columns ?? (items.length <= 12 ? 4 : 6), tile: tile_px }
  );
  return {
    summary: {
      query,
      page,
      category: result.category,
      shown: items.length,
      next_page: result.has_more ? page + 1 : undefined,
      missing_photos: items.map((_, i) => (images[i] ? null : offset + i + 1)).filter((n) => n !== null),
      items: items.map((it, i) => ({
        n: offset + i + 1,
        sku: it.sku,
        name: it.name,
        price: it.price,
        original_price: it.original_price,
        discount: it.discount,
        rating: it.rating,
        reviews: it.reviews,
        delivery: it.delivery,
        url: it.url,
      })),
      hints: result.hints,
    },
    collage,
  };
}
