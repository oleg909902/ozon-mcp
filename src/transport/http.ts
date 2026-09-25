// Streamable HTTP на /mcp (для ChatGPT и других удалённых клиентов), без сессий:
// на каждый запрос — свой экземпляр сервера и транспорта.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function serveHttp(createMcpServer: () => McpServer, { host, port }: { host: string; port: number }): Promise<void> {
  const httpServer = createServer((req, res) => {
    handle(createMcpServer, req, res).catch((e) => {
      console.error("ozon-mcp:", e);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, "Internal error"));
    });
  });
  return new Promise((resolve) => httpServer.listen(port, host, resolve));
}

async function handle(createMcpServer: () => McpServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("ozon-mcp работает. MCP эндпоинт: /mcp");
    return;
  }
  if (path !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, rpcError(-32000, "Method not allowed"));
    return;
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, rpcError(-32700, "Parse error"));
    return;
  }
  console.log(`→ ${body?.method}${body?.params?.name ? " " + body.params.name : ""}`);

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
}
