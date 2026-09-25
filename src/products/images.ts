import type { OzonClient } from "../ozon/client.js";
import { widget } from "../ozon/page-data.js";
import { resolveSku } from "../ozon/sku.js";

/**
 * Размер фото. small (500 px, по умолчанию) — быстро и легко, для внешнего вида и цвета.
 * medium (1000 px) — если надо прочитать мелкий текст на упаковке. Vision-модели сами уменьшают
 * картинку (у OpenAI — до ~768 px по короткой стороне), поэтому original обычно лишь тяжелее.
 */
const IMAGE_SIZES = { small: 500, medium: 1000, original: null } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;
export const IMAGE_SIZE_NAMES = Object.keys(IMAGE_SIZES) as [ImageSize, ...ImageSize[]];

export type ProductImage = { url: string; mimeType: string; data: string };

export type ProductImages = {
  sku: string;
  name: string | null;
  total: number;
  all_urls: string[];
  images: ProductImage[];
};

/** Ссылка на копию картинки Ozon CDN нужного размера: .../s3/multimedia-x/wc1000/123.jpg */
export const resizedImage = (url: string, px: number | null): string =>
  px ? url.replace(/(\/s3\/[^/]+\/)(?:wc\d+\/)?/, `$1wc${px}/`) : url.replace(/\/wc\d+\//, "/");

/**
 * Фото товара как картинки (base64) — чтобы модель могла их рассмотреть.
 * Картинки лежат на публичном CDN, качаем напрямую, без браузера.
 */
export async function getProductImages(
  ozon: OzonClient,
  product: string,
  { limit = 4, size = "small" }: { limit?: number; size?: ImageSize } = {}
): Promise<ProductImages> {
  const sku = await resolveSku(ozon, product);
  const data = await ozon.fetchPage(`/product/${sku}/`);
  const gallery = widget(data, "webGallery");
  const urls: string[] = (gallery?.images ?? []).map((i: { src: string }) => i.src);
  if (!urls.length && gallery?.coverImage) urls.push(gallery.coverImage);

  const px = size in IMAGE_SIZES ? IMAGE_SIZES[size] : IMAGE_SIZES.small; // original — null, без уменьшения
  const images: ProductImage[] = [];
  for (const url of urls.slice(0, limit)) {
    const res = await fetch(resizedImage(url, px)).catch(() => null);
    if (!res?.ok) continue;
    images.push({
      url,
      mimeType: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
      data: Buffer.from(await res.arrayBuffer()).toString("base64"),
    });
  }
  return { sku, name: widget(data, "webProductHeading")?.title ?? null, total: urls.length, all_urls: urls, images };
}
