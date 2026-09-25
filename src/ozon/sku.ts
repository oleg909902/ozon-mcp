import type { OzonClient } from "./client.js";

/**
 * Из sku, полной или короткой (ozon.ru/t/xxxx) ссылки получает sku товара.
 * Полные ссылки: /product/<slug>-<sku>/ или /product/<sku>/.
 */
export async function resolveSku(ozon: OzonClient, input: string): Promise<string> {
  let text = String(input).trim();
  if (/^\d{5,}$/.test(text)) return text;

  const short = text.match(/ozon\.(?:ru|kz|by)\/t\/([\w-]+)/);
  if (short) text = await ozon.resolveRedirect(`/t/${short[1]}`);

  const sku = text.match(/\/product\/(?:[^/?#]*-)?(\d{5,})(?:[/?#]|$)/)?.[1];
  if (!sku) throw new Error(`Не удалось найти артикул товара в "${input}"`);
  return sku;
}
