import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OzonClient } from "../ozon/client.js";
import { getProductImages, IMAGE_SIZE_NAMES } from "../products/images.js";
import { getProduct } from "../products/product.js";
import { getReviews, REVIEW_SORT_NAMES } from "../products/reviews.js";
import { searchProducts, SEARCH_SORTS } from "../products/search.js";
import { visualSearch } from "../products/visual-search.js";
import { jsonResult, READ_ONLY, safe } from "./results.js";

const productArg = z.string().min(1).describe("Ссылка на товар Ozon или артикул (sku)");

export function registerProductTools(server: McpServer, ozon: OzonClient): void {
  server.registerTool(
    "search_products",
    {
      title: "Поиск товаров на Ozon",
      description:
        "Ищет товары на Ozon. Возвращает список: sku, название, цена, старая цена, скидка, рейтинг, " +
        "число отзывов, срок доставки, ссылка. Для подробностей о товаре вызови get_product с его sku.",
      inputSchema: {
        query: z.string().min(1).describe("Поисковый запрос, например 'саморез 4.2x75'"),
        sort: z
          .enum(SEARCH_SORTS)
          .optional()
          .describe(
            "Сортировка: score — популярные (по умолчанию), price — дешевле, price_desc — дороже, rating — по рейтингу, new — новинки, discount — по скидке"
          ),
        page: z.number().int().min(1).max(20).optional().describe("Номер страницы выдачи, по умолчанию 1"),
        limit: z.number().int().min(1).max(48).optional().describe("Товаров на странице, по умолчанию 24"),
      },
      annotations: READ_ONLY,
    },
    safe(async (args) => jsonResult(await searchProducts(ozon, args)))
  );

  server.registerTool(
    "search_products_visual",
    {
      title: "Поиск товаров Ozon по фото (коллаж)",
      description:
        "Поиск на Ozon, где выдача приходит ОДНОЙ картинкой-коллажем: фото всех найденных товаров сеткой, на каждой плитке красный номер. " +
        "Плюс таблица items: номер n → sku, название, цена, рейтинг, ссылка url. " +
        "Используй, когда важен внешний вид (цвет, форма, фасон, дизайн, «как на фото», «без логотипа», «в стиле …»): " +
        "посмотри коллаж, выбери подходящие по виду номера и отдай пользователю их url из items (ссылки бери только из items, не придумывай). " +
        "Номера сквозные: на page=2 продолжаются с limit+1. Чтобы рассмотреть товар подробнее — get_product_images. Ещё товары — page+1 (если есть next_page).",
      inputSchema: {
        query: z.string().min(1).describe("Поисковый запрос, например 'кроссовки белые женские'"),
        sort: z.enum(SEARCH_SORTS).optional().describe("score (по умолчанию), price, price_desc, rating, new, discount"),
        page: z.number().int().min(1).max(20).optional().describe("Страница (коллаж) по limit товаров, по умолчанию 1"),
        limit: z.number().int().min(4).max(36).optional().describe("Сколько товаров в коллаже, по умолчанию 24 (больше — мельче плитки, дольше загрузка)"),
        columns: z.number().int().min(2).max(8).optional().describe("Колонок в сетке (по умолчанию 6, при ≤12 товарах — 4)"),
        tile_px: z.number().int().min(150).max(500).optional().describe("Размер плитки в px, по умолчанию 300"),
      },
      annotations: READ_ONLY,
    },
    safe(async (args) => {
      const { summary, collage } = await visualSearch(ozon, args);
      return {
        content: [
          { type: "text", text: JSON.stringify(summary, null, 1) },
          ...(collage ? [{ type: "image" as const, data: collage.toString("base64"), mimeType: "image/jpeg" }] : []),
        ],
      };
    })
  );

  server.registerTool(
    "get_product",
    {
      title: "Карточка товара Ozon",
      description:
        "Вся информация о товаре Ozon по ссылке (полной или короткой ozon.ru/t/...) или артикулу: цена и цена за единицу, " +
        "наличие, бренд, продавец (название, рейтинг, заказы, юрлицо), все характеристики, комплектация, варианты " +
        "(размеры/фасовки с их sku и ценами), описание, ссылки на фото, рейтинг с распределением оценок и последние отзывы. " +
        "Больше отзывов — get_reviews, сами фото посмотреть — get_product_images.",
      inputSchema: {
        product: productArg,
        reviews: z.number().int().min(0).max(30).optional().describe("Сколько отзывов приложить, по умолчанию 20, 0 — без отзывов"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, reviews }) => jsonResult(await getProduct(ozon, product, { reviews })))
  );

  server.registerTool(
    "get_reviews",
    {
      title: "Отзывы о товаре Ozon",
      description:
        "Отзывы о товаре Ozon, по 30 на страницу: оценка, дата, текст, достоинства/недостатки, фото, к какому варианту товара относится. " +
        "Плюс общий рейтинг и сколько отзывов с каждой оценкой.",
      inputSchema: {
        product: productArg,
        sort: z
          .enum(REVIEW_SORT_NAMES)
          .optional()
          .describe("useful — новые и полезные (по умолчанию), score_desc — сначала высокие оценки, score_asc — сначала низкие (чтобы найти недостатки)"),
        page: z.number().int().min(1).max(50).optional().describe("Страница, по умолчанию 1"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, sort, page }) => jsonResult(await getReviews(ozon, product, { sort, page })))
  );

  server.registerTool(
    "get_product_images",
    {
      title: "Фото товара Ozon",
      description:
        "Возвращает фотографии товара Ozon как изображения, чтобы их можно было рассмотреть (внешний вид, цвет, размеры на фото, упаковка).",
      inputSchema: {
        product: productArg,
        limit: z.number().int().min(1).max(10).optional().describe("Сколько фото вернуть, по умолчанию 4"),
        size: z
          .enum(IMAGE_SIZE_NAMES)
          .optional()
          .describe("small — 500 px (по умолчанию, быстро), medium — 1000 px (если нужно прочитать мелкий текст на упаковке), original — исходник"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, limit, size }) => {
      const r = await getProductImages(ozon, product, { limit, size });
      const summary = { sku: r.sku, name: r.name, shown: r.images.length, total: r.total, urls: r.all_urls };
      return {
        content: [
          { type: "text", text: JSON.stringify(summary, null, 1) },
          ...r.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })),
        ],
      };
    })
  );
}
