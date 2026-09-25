// Заказы (личный кабинет). Только чтение; код получения не отдаётся.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OzonClient } from "../ozon/client.js";
import { getOrder } from "../orders/details.js";
import { listOrders, ORDER_TABS } from "../orders/list.js";
import { ordersSummary } from "../orders/summary.js";
import { jsonResult, READ_ONLY, safe } from "./results.js";

export function registerOrderTools(server: McpServer, ozon: OzonClient): void {
  server.registerTool(
    "orders_summary",
    {
      title: "Сводка по заказам Ozon",
      description:
        "Коротко о текущих заказах: что уже лежит в пунктах выдачи (где, часы работы, сколько к оплате, до какого числа забрать, " +
        "сколько дней осталось, какие товары), что ещё едет (когда ожидать, сколько дней ждать, какие товары).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => jsonResult(await ordersSummary(ozon)))
  );

  server.registerTool(
    "list_orders",
    {
      title: "Список заказов Ozon",
      description:
        "Заказы по отправлениям: статус, пункт выдачи или срок доставки, срок хранения, цена, товары. " +
        "active — текущие, archive — завершённые (полученные и отменённые).",
      inputSchema: {
        tab: z.enum(ORDER_TABS).optional().describe("active (по умолчанию) или archive"),
        pages: z.number().int().min(1).max(10).optional().describe("Сколько страниц загрузить (для архива), по умолчанию 1"),
        with_items: z.boolean().optional().describe("Подгрузить названия товаров (медленнее, по запросу на заказ). По умолчанию true"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ tab, pages, with_items }) => jsonResult(await listOrders(ozon, { tab, pages, withItems: with_items })))
  );

  server.registerTool(
    "get_order",
    {
      title: "Детали заказа Ozon",
      description: "Детали заказа по номеру (например 24693383-0540): дата, оплата, адрес доставки, товары с продавцами и ценами.",
      inputSchema: { order_number: z.string().regex(/^\d+-\d+$/).describe("Номер заказа, например 24693383-0540") },
      annotations: READ_ONLY,
    },
    safe(async ({ order_number }) => jsonResult(await getOrder(ozon, order_number)))
  );
}
