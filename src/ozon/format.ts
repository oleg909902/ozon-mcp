// Мелкие преобразования текстов Ozon

export const BASE_URL = "https://www.ozon.ru";

/** Относительная ссылка Ozon -> абсолютная, без query-параметров */
export const absoluteUrl = (link: string | null | undefined): string | null =>
  link ? BASE_URL + link.split("?")[0] : null;

/** "1 234,5 ₽" -> 1234.5 */
export const parseNumber = (text: unknown): number | null =>
  text ? Number(String(text).replace(/[^\d.,]/g, "").replace(",", ".")) || null : null;

/** Только цифры: "1 234 ₽" -> 1234 */
export const parseDigits = (text: unknown): number | null =>
  text ? Number(String(text).replace(/[^\d]/g, "")) || null : null;

/** Текст цены из блока price[] ("1 234", "₽" ...) одной строкой */
export const priceText = (block: any): string | null =>
  (block?.price ?? []).map((x: any) => x.text).join(" ").replace(/ /g, " ") || null;

/** Основная цена из блока price[]: элемент PRICE, без подписи вида "2 x 182 ₽" */
export const mainPrice = (block: any): number | null => {
  const parts: any[] = block?.price ?? [];
  return parseDigits((parts.find((x) => x.textStyle === "PRICE") ?? parts[0])?.text);
};

/** Количество из подписи к цене: "2 x 182 ₽" -> 2 */
export const priceQuantity = (block: any): number | null => {
  const caption = (block?.price ?? []).map((x: any) => x.text).find((t: string) => /^\s*\d+\s*[xх×]/i.test(t ?? ""));
  return caption ? Number(caption.match(/\d+/)[0]) : null;
};

/** Дата в формате YYYY-MM-DD */
export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
