// Ответ Ozon на /api/entrypoint-api.bx/page/json/v2: страница как набор виджетов.
// Формат не документирован и меняется, поэтому содержимое виджетов не типизируем
// и читаем через optional chaining.

/** Произвольный JSON от Ozon */
export type Raw = any;

export type PageData = {
  /** "<тип>-<id>-default-1" -> JSON-строка состояния виджета */
  widgetStates?: Record<string, string>;
  layoutTrackingInfo?: string;
  seo?: { script?: { innerHTML: string }[] };
  /** Признаки антибот-проверки */
  incidentId?: string;
  challengeURL?: string;
};

const widgetKeys = (data: PageData, prefix: string) =>
  Object.keys(data.widgetStates ?? {}).filter((k) => k.startsWith(prefix + "-"));

/** Состояние первого виджета с таким префиксом имени */
export function widget(data: PageData, prefix: string): Raw | null {
  const key = widgetKeys(data, prefix)[0];
  return key ? JSON.parse(data.widgetStates![key]!) : null;
}

/** Все виджеты с таким префиксом (например, описаний на странице бывает несколько) */
export function widgets(data: PageData, prefix: string): Raw[] {
  return widgetKeys(data, prefix).map((k) => JSON.parse(data.widgetStates![k]!));
}

/** schema.org-объект нужного типа из SEO-блока страницы */
export function ldJson(data: PageData, type: string): Raw | null {
  for (const s of data.seo?.script ?? []) {
    try {
      const obj = JSON.parse(s.innerHTML);
      if (obj?.["@type"] === type) return obj;
    } catch {
      // не JSON — пропускаем
    }
  }
  return null;
}
