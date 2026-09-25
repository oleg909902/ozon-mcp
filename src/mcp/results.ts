import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const jsonResult = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 1) }],
});

/** Ошибки отдаём модели как isError, чтобы она могла сообщить о них или повторить запрос */
export const safe =
  <A>(fn: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      return { content: [{ type: "text", text: `Ошибка: ${(e as Error).message}` }], isError: true };
    }
  };

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
