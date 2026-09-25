// Даты Ozon в заказах пишутся по-русски и без года: "7 октября", "22 - 25 сентября"
import { isoDate } from "../ozon/format.js";

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

/** "7 октября" -> "2026-10-07" (год выбирается ближайший к сегодняшней дате) */
export function parseRuDate(text: string | null | undefined, now = new Date()): string | null {
  const m = String(text ?? "").match(/(\d{1,2})\s+([а-яё]+)/i);
  if (!m) return null;
  const word = m[2]!.toLowerCase();
  // "ма" (мая) проверяем отдельно, чтобы не спутать с "март"
  const month = MONTHS.findIndex((p, i) => (i === 4 ? /^ма[яй]/.test(word) : word.startsWith(p)));
  if (month < 0) return null;
  const candidates = [-1, 0, 1].map((dy) => new Date(Date.UTC(now.getFullYear() + dy, month, Number(m[1]))));
  const distance = (d: Date) => Math.abs(d.getTime() - now.getTime());
  return isoDate(candidates.sort((a, b) => distance(a) - distance(b))[0]!);
}

/** Дней от сегодня до даты (отрицательное — дата прошла) */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(iso) - today) / 86_400_000);
}

/** "22 сентября ‑ 2 октября" -> { from, to } */
export function parseRuRange(text: string): { from: string | null; to: string | null } | null {
  const parts = text.split(/\s[-‑–—]\s/);
  if (parts.length < 2) {
    const d = parseRuDate(text);
    return d ? { from: d, to: d } : null;
  }
  const [first, second] = parts as [string, string];
  const to = parseRuDate(second);
  // "22 - 25 сентября": у первой даты может не быть месяца — берём его из второй
  const from = parseRuDate(first) ?? parseRuDate(first.replace(/\D+$/, "") + " " + second.split(/\s+/).pop());
  return from || to ? { from, to } : null;
}
