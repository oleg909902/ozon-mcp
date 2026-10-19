// Коллаж из фото товаров: одна картинка-сетка, на каждой плитке крупный номер.
// Модель смотрит на одну картинку вместо десятков и по номеру находит товар в текстовой таблице.
// Номера рисуются векторными семисегментными цифрами: в alpine-контейнере нет шрифтов,
// и обычный <text> в SVG не отрисовался бы.
import sharp from "sharp";

/** Сегменты цифры в клетке 10x18: a — верх, b/c — справа, d — низ, e/f — слева, g — середина */
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [1, 0, 8, 2],
  b: [8, 1, 2, 8],
  c: [8, 9, 2, 8],
  d: [1, 16, 8, 2],
  e: [0, 9, 2, 8],
  f: [0, 1, 2, 8],
  g: [1, 8, 8, 2],
};
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

/** SVG-фрагмент числа: прямоугольники сегментов, s — масштаб (высота цифры 18*s) */
function numberSvg(n: number, x: number, y: number, s: number, color: string): string {
  return [...String(n)]
    .map((ch, i) =>
      [...DIGITS[Number(ch)]]
        .map((seg) => {
          const [sx, sy, w, h] = SEGMENTS[seg];
          return `<rect x="${x + (i * 13 + sx) * s}" y="${y + sy * s}" width="${w * s}" height="${h * s}" rx="${0.6 * s}" fill="${color}"/>`;
        })
        .join("")
    )
    .join("");
}

/** Плашка с номером в левом верхнем углу плитки */
function badge(n: number, tile: number): Buffer {
  const s = Math.max(1.6, tile / 130); // высота цифры ~14% плитки
  const digits = String(n).length;
  const w = Math.round((digits * 13 - 3) * s + 12 * s);
  const h = Math.round(18 * s + 10 * s);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="${w}" height="${h}" rx="${4 * s}" fill="#e3203a"/>${numberSvg(n, 6 * s, 5 * s, s, "#fff")}</svg>`;
  return Buffer.from(svg);
}

export type CollageTile = { n: number; image: Buffer | null };

export type CollageOptions = { columns?: number; tile?: number; gap?: number; quality?: number };

/** Склеивает плитки в сетку JPEG. Пустая плитка (нет фото) — серая. */
export async function buildCollage(tiles: CollageTile[], { columns = 6, tile = 300, gap = 6, quality = 82 }: CollageOptions = {}): Promise<Buffer> {
  const cols = Math.min(columns, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * tile + (cols + 1) * gap;
  const height = rows * tile + (rows + 1) * gap;

  const layers = await Promise.all(
    tiles.map(async (t, i) => {
      const left = gap + (i % cols) * (tile + gap);
      const top = gap + Math.floor(i / cols) * (tile + gap);
      const photo = t.image
        ? await sharp(t.image)
            .resize(tile, tile, { fit: "contain", background: "#ffffff" })
            .flatten({ background: "#ffffff" })
            .toBuffer()
            .catch(() => null)
        : null;
      const base = photo ?? (await sharp({ create: { width: tile, height: tile, channels: 3, background: "#d9d9d9" } }).png().toBuffer());
      const labelled = await sharp(base).composite([{ input: badge(t.n, tile), left: 4, top: 4 }]).png().toBuffer();
      return { input: labelled, left, top };
    })
  );

  return sharp({ create: { width, height, channels: 3, background: "#9a9a9a" } })
    .composite(layers)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/** Качает картинки параллельно (не больше concurrency одновременно); неудачные — null */
export async function downloadImages(urls: (string | null)[], concurrency = 8, timeoutMs = 15_000): Promise<(Buffer | null)[]> {
  const out: (Buffer | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      if (!url) continue;
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
      if (res?.ok) out[i] = Buffer.from(await res.arrayBuffer());
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}
