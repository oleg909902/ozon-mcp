import type { OzonClient } from "../ozon/client.js";
import { isoDate } from "../ozon/format.js";
import { listOrders, type OrderGroup } from "./list.js";
import { daysUntil } from "./ru-dates.js";

const itemNames = (g: OrderGroup) => g.shipments.flatMap((s) => (s.items ?? []).map((i) => i.name));

/** Сводка по текущим заказам: что ждёт в пунктах выдачи, что едет и когда */
export async function ordersSummary(ozon: OzonClient) {
  const { groups } = await listOrders(ozon, { tab: "active", withItems: true });

  const ready = groups
    .filter((g) => g.state === "ready_for_pickup")
    .map((g) => {
      const deadline = g.shipments.map((s) => s.storage_until).filter(Boolean).sort()[0] ?? null;
      return {
        where: g.delivery,
        hours: g.pickup_hours,
        shipments: g.shipments.length,
        to_pay: g.to_pay ?? 0,
        pick_up_before: deadline,
        days_left: deadline ? daysUntil(deadline) : null,
        items: itemNames(g),
      };
    });

  const inTransit = groups
    .filter((g) => g.state === "in_transit")
    .map((g) => ({
      where: g.delivery,
      expected_from: g.expected_from,
      expected_to: g.expected_to,
      wait_days_min: g.wait_days_min,
      wait_days_max: g.wait_days_max,
      items: itemNames(g),
    }));

  const other = groups.filter((g) => g.state !== "ready_for_pickup" && g.state !== "in_transit");

  return {
    today: isoDate(new Date()),
    ready_for_pickup: {
      shipments: ready.reduce((n, r) => n + r.shipments, 0),
      to_pay_total: ready.reduce((n, r) => n + r.to_pay, 0),
      points: ready,
    },
    in_transit: { shipments: inTransit.length, orders: inTransit },
    other: other.map((g) => ({ state: g.state, delivery: g.delivery, items: itemNames(g) })),
  };
}
