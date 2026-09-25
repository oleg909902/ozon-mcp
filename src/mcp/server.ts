import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OzonClient } from "../ozon/client.js";
import { registerOrderTools } from "./order-tools.js";
import { registerProductTools } from "./product-tools.js";

const INSTRUCTIONS = [
  "Ozon: поиск, карточки, отзывы, заказы. Как работать лучше:",
  "- Читай поле hints в ответах поиска — там подсказки, как уточнить выдачу.",
  "- Перед рекомендацией товара загляни в get_product (продавец, наличие, характеристики, отзывы).",
  "- Чтобы понять недостатки товара — get_reviews с sort=score_asc.",
  "- Заказы только читаются; код получения заказов недоступен и не нужен.",
].join("\n");

export function createMcpServer(ozon: OzonClient): McpServer {
  const server = new McpServer({ name: "ozon", version: "0.3.0" }, { instructions: INSTRUCTIONS });
  registerProductTools(server, ozon);
  registerOrderTools(server, ozon);
  return server;
}
