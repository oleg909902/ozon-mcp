// Заказы из личного кабинета Ozon (только чтение).
// Код получения заказов намеренно НЕ отдаётся: по нему можно забрать посылки.
import type { OzonClient } from "../ozon/client.js";
import { BASE_URL, mainPrice, parseDigits, priceText } from "../ozon/format.js";
import { widget, widgets, type Raw } from "../ozon/page-data.js";
import { getOrder, type OrderDetails } from "./details.js";
import { daysUntil, parseRuDate, parseRuRange } from "./ru-dates.js";

export const ORDER_TABS = ["active", "archive"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export type GroupState = "ready_for_pickup" | "in_transit" | "processing" | "done" | "cancelled";

export type Shipment = {
  order_number: string | null;
  posting_id: string | null;
  status: string | null;
  note: string | null;
  storage_until: string | null;
  days_left_to_pick_up?: number | null;
  price: number | null;
  image: string | null;
  // Заполняются, если список загружен с товарами
  ordered?: string | null;
  items?: Pick<OrderDetails["items"][number], "name" | "sku" | "price" | "quantity" | "attributes">[];
  /** Товары этого заказа уже перечислены у другого отправления с этим номером */
  items_listed_with?: string;
};

/** Группа отправлений с общим способом получения (пункт выдачи, курьер, срок) */
export type OrderGroup = {
  state: GroupState;
  delivery: string | null;
  pickup_hours?: string | null;
  expected_from?: string | null;
  expected_to?: string | null;
  /** Сколько ещё ждать: минимум (0, если интервал уже начался) и максимум — до конца интервала */
  wait_days_min?: number | null;
  wait_days_max?: number | null;
  status?: string;
  to_pay?: number | null;
  shipments: Shipment[];
};

export type OrderList = { tab: OrderTab; groups_count: number; shipments_count: number; groups: OrderGroup[] };

/**
 * Список заказов. tab: active — текущие, archive — завершённые.
 * withItems: подгрузить названия товаров (отдельный запрос на каждый заказ).
 */
export async function listOrders(
  ozon: OzonClient,
  { tab = "active", pages = 1, withItems = true, maxOrders = 30 }: { tab?: OrderTab; pages?: number; withItems?: boolean; maxOrders?: number } = {}
): Promise<OrderList> {
  const groups: OrderGroup[] = [];
  let path: string | null = `/my/orderlist/?selectedTab=${tab}`;
  for (let i = 0; i < pages && path; i++) {
    const data = await ozon.fetchPage(path);
    groups.push(...(widget(data, "orderList")?.ordersV2 ?? []).map((g: Raw) => parseGroup(g, tab)));
    // Следующая страница заказов (не путать с пагинатором рекомендаций)
    path = widgets(data, "paginator").map((p) => p.nextPage).find((n) => n?.includes("order-list-desktop")) ?? null;
  }

  if (withItems) await attachItems(ozon, groups, maxOrders);
  return { tab, groups_count: groups.length, shipments_count: groups.reduce((n, g) => n + g.shipments.length, 0), groups };
}

/**
 * Дописывает к отправлениям товары и дату заказа. Заказ может приехать несколькими
 * отправлениями, а детали — по заказу целиком: товары пишем только у первого отправления.
 */
async function attachItems(ozon: OzonClient, groups: OrderGroup[], maxOrders: number): Promise<void> {
  const numbers = [...new Set(groups.flatMap((g) => g.shipments.map((s) => s.order_number)).filter((n): n is string => !!n))];
  const details = new Map<string, OrderDetails | null>();
  for (const n of numbers.slice(0, maxOrders)) details.set(n, await getOrder(ozon, n).catch(() => null));

  const attached = new Set<string>();
  for (const s of groups.flatMap((g) => g.shipments)) {
    const d = s.order_number ? details.get(s.order_number) : null;
    if (!d) continue;
    s.ordered = d.created;
    if (attached.has(d.order_number)) {
      s.items_listed_with = d.order_number;
      continue;
    }
    attached.add(d.order_number);
    s.items = d.items.map(({ name, sku, price, quantity, attributes }) => ({ name, sku, price, quantity, attributes }));
  }
}

function parseGroup(group: Raw, tab: OrderTab): OrderGroup {
  const left = group.leftBlock ?? {};
  const title: string | null = left.title?.text ?? null;
  const subtitle: string | null = left.subtitle?.text ?? null;
  const statusText: string | null = left.textIcon?.text?.text ?? null; // архив: "Получен 16 сентября", "Отменён"
  const cells: [string | undefined, string | null][] = (left.cellList?.cells ?? [])
    .map((c: Raw) => c.dsCell)
    .filter(Boolean)
    .map((c: Raw) => [c.centerBlock?.title?.text, priceText(c.rightBlock?.price)]);
  const toPay = cells.find(([t]) => /оплат/i.test(t ?? ""));

  const shipments = (group.rightBlock?.products?.products ?? []).map((p: Raw) => parseShipment(p, statusText));
  const expected = subtitle && /ожидаем/i.test(subtitle) ? parseRuRange(subtitle.replace(/ожидаем/i, "")) : null;
  const readyForPickup = shipments.some((s: Shipment) => s.storage_until);

  return {
    state: groupState(tab, statusText, readyForPickup, Boolean(expected)),
    delivery: title ?? subtitle,
    // Для пунктов выдачи subtitle — часы работы ("Сегодня с 09:00 до 21:00"), для едущих — срок
    pickup_hours: readyForPickup ? subtitle : undefined,
    expected_from: expected?.from ?? undefined,
    expected_to: expected?.to ?? undefined,
    wait_days_min: expected ? Math.max(0, daysUntil(expected.from ?? expected.to)!) : undefined,
    wait_days_max: expected ? daysUntil(expected.to ?? expected.from) : undefined,
    status: statusText ?? undefined,
    to_pay: toPay ? parseDigits(toPay[1]) : undefined,
    shipments,
  };
}

function groupState(tab: OrderTab, statusText: string | null, readyForPickup: boolean, expected: boolean): GroupState {
  if (tab === "archive") return /отмен/i.test(statusText ?? "") ? "cancelled" : "done";
  if (readyForPickup) return "ready_for_pickup";
  return expected ? "in_transit" : "processing";
}

function parseShipment(p: Raw, groupStatus: string | null): Shipment {
  const link: string = p.image?.productMedia?.common?.action?.link ?? "";
  const query = new URL(link, BASE_URL).searchParams;
  const caption: string | null = p.caption?.text ?? null;
  const storageUntil = caption && /хранится до/i.test(caption) ? parseRuDate(caption) : null;
  return {
    order_number: query.get("order"),
    posting_id: query.get("postingId"),
    status: p.badgeStatus?.text ?? groupStatus,
    note: caption,
    storage_until: storageUntil,
    days_left_to_pick_up: storageUntil ? daysUntil(storageUntil) : undefined,
    price: mainPrice(p.price),
    image: p.image?.productMedia?.image?.url ?? null,
  };
}
