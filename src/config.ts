// Настройки из переменных окружения
export const config = {
  /** HTTP-адрес отладочного порта Chrome */
  cdpUrl: process.env.CDP_URL ?? "http://127.0.0.1:9223",
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  /** Раз в сколько минут простоя обновлять cookie антибота (0 — не обновлять) */
  antibotRefreshMin: Number(process.env.OZON_REFRESH_MIN ?? 20),
};

export type Config = typeof config;
