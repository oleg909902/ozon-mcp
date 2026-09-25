// MCP сервер для Ozon.
// Запуск: node dist/index.js          — HTTP (Streamable HTTP) на :3000/mcp, для ChatGPT
//         node dist/index.js --stdio  — stdio, для Claude Code / локальной отладки
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { OzonClient } from "./ozon/client.js";
import { serveHttp } from "./transport/http.js";

const ozon = new OzonClient(config.cdpUrl);
ozon.startAntibotRefresh(config.antibotRefreshMin);

if (process.argv.includes("--stdio")) {
  await createMcpServer(ozon).connect(new StdioServerTransport());
  console.error("ozon-mcp: stdio");
} else {
  await serveHttp(() => createMcpServer(ozon), config);
  console.log(`ozon-mcp: http://${config.host}:${config.port}/mcp  (CDP: ${config.cdpUrl})`);
}
