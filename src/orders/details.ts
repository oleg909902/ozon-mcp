import type { OzonClient } from "../ozon/client.js";
import { absoluteUrl, BASE_URL, mainPrice, parseDigits, priceQuantity, priceText } from "../ozon/format.js";
import { widget, widgets, type Raw } from "../ozon/page-data.js";
import { parseRuDate } from "./ru-dates.js";

export type OrderItem = {
  name: string | null;
  sku: string | null;
  url: string | null;
  attributes: string[];
  /** Сумма за позицию */
  price: number | null;
  quantity: number;
  seller: string | null;
  image: string | null;
};

export type OrderDetails = {
  order_number: string;
  /** "Заказ от 1 сентября" */
  title: string | null;
  created: string | null;
  payment: { status: string | null; method: string | null; total: number | null; breakdown: Record<string, string> } | null;
  delivery: { type: string | null; address: string | null } | null;
  items: OrderItem[];
  /** Только для информации: MCP эти действия не выполняет */
  available_actions: string[];
  url: string;
};

/** Детали заказа: дата, оплата, доставка, товары с продавцами */
export async function getOrder(ozon: OzonClient, orderNumber: string): Promise<OrderDetails> {
  const path = `/my/orderdetails/?order=${encodeURIComponent(orderNumber)}`;
  const data = await ozon.fetchPage(path);
  const title: string | null = widget(data, "titleWithTimer")?.title?.text ?? null;
  const detailCells: Raw[] = widgets(data, "orderDetailsItem").map((w) => w.cell).filter(Boolean);
  const delivery = detailCells.find((c) => /доставк|курьер|пункт|постамат/i.test(c.title?.text ?? ""));

  return {
    order_number: orderNumber,
    title,
    created: parseRuDate(title),
    payment: parsePayment(widget(data, "orderDoneTotal")),
    delivery: delivery ? { type: delivery.title?.text ?? null, address: delivery.subtitle?.text ?? null } : null,
    items: widgets(data, "shipmentWidget").flatMap(parseShipmentItems),
    available_actions: widgets(data, "buttonsGroup")
      .flatMap((g) => g.buttons ?? [])
      .map((b: Raw) => b.button?.title)
      .filter(Boolean),
    url: BASE_URL + path,
  };
}

function parsePayment(total: Raw): OrderDetails["payment"] {
  if (!total) return null;
  return {
    status: total.total?.left?.title?.text ?? null, // "Оплачено" / "К оплате"
    method: total.total?.left?.subtitle?.text ?? null,
    total: parseDigits(total.total?.right?.price?.text),
    breakdown: Object.fromEntries(
      (total.prices?.elements ?? []).map((e: Raw) => [e.left?.title?.text, e.right?.price?.text ?? priceText(e.right?.atomPrice)])
    ),
  };
}

/** Отправление -> продавцы -> товары */
function parseShipmentItems(shipment: Raw): OrderItem[] {
  return (shipment.items ?? []).flatMap((it: Raw) =>
    (it.sellers ?? []).flatMap((s: Raw) =>
      (s.products ?? []).map(
        (p: Raw): OrderItem => ({
          name: p.title?.name?.text ?? null,
          sku: p.title?.common?.action?.id ?? null,
          url: absoluteUrl(p.title?.common?.action?.link),
          attributes: (p.attributes ?? []).map((a: Raw) => a.text).filter(Boolean),
          price: mainPrice(p.price),
          quantity: priceQuantity(p.price) ?? 1,
          seller: s.name?.text ?? null,
          image: p.pictureV2?.productMedia?.image?.url ?? p.picture?.image?.image ?? null,
        })
      )
    )
  );
}
