"""Авто-нарезка Default Gifts.png на отдельные PNG-плитки.

Алгоритм:
1) Анализируем альфа-канал (или яркость для не-RGBA): находим строки и столбцы,
   в которых есть «контент» (не фон).
2) Группируем подряд идущие «контентные» строки/столбцы в полосы.
3) Пересекаем полосы → получаем bbox каждой плитки.
4) Каждую плитку обрезаем до её собственного bbox, ресайзим до 256x256,
   сохраняем в public/gifts/gift-XXX.png.
5) Пишем gifts.json со списком файлов.
"""

import json
import os
from pathlib import Path

from PIL import Image
Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'Default Gifts.png'
OUT_DIR = ROOT / 'src' / 'miniapp' / 'public' / 'gifts'
MANIFEST = ROOT / 'src' / 'miniapp' / 'src' / 'gifts.json'
TILE_SIZE = 256
MIN_GAP_PX = 12  # минимальный «пустой» промежуток между рядами/колонками


def content_mask(img: Image.Image):
    """1D-массивы: какие строки/колонки содержат непрозрачные/тёмные пиксели."""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    a = img.split()[-1]  # alpha
    # быстрая аппроксимация: max по строке/колонке
    w, h = a.size
    pixels = a.load()

    rows_has = [False] * h
    cols_has = [False] * w

    # сэмплируем каждые 2 пикселя — достаточно
    step = 2
    for y in range(0, h, step):
        for x in range(0, w, step):
            if pixels[x, y] > 16:
                rows_has[y] = True
                cols_has[x] = True
    return rows_has, cols_has


def group_runs(mask, min_gap):
    """Возвращает список (start, end) непрерывных True-полос, игнорируя короткие пустоты."""
    runs = []
    n = len(mask)
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        start = i
        while i < n and (mask[i] or _gap_short(mask, i, min_gap)):
            i += 1
        end = i - 1
        # сжать концы до последнего True
        while end > start and not mask[end]:
            end -= 1
        if end - start >= 4:  # минимальная высота/ширина плитки
            runs.append((start, end))
    return runs


def _gap_short(mask, i, gap):
    """Истина если последовательность пустых пикселей с позиции i короче gap."""
    n = len(mask)
    j = i
    while j < n and not mask[j]:
        j += 1
    return (j - i) <= gap


def main():
    print(f'reading {SRC}')
    img = Image.open(SRC).convert('RGBA')
    print('size', img.size)

    rows_has, cols_has = content_mask(img)
    rows = group_runs(rows_has, MIN_GAP_PX)
    cols = group_runs(cols_has, MIN_GAP_PX)
    print(f'rows: {len(rows)} bands, cols: {len(cols)} bands')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # очистим старые
    for old in OUT_DIR.glob('gift-*.png'):
        old.unlink()

    manifest = []
    n = 0
    for ri, (y0, y1) in enumerate(rows):
        for ci, (x0, x1) in enumerate(cols):
            tile = img.crop((x0, y0, x1 + 1, y1 + 1))
            # доп. trim по альфе (плотный bbox)
            bbox = tile.getbbox()
            if not bbox:
                continue
            tile = tile.crop(bbox)
            # вписать в TILE_SIZE с сохранением пропорций, белый прозрачный фон
            tile.thumbnail((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
            canvas = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
            ox = (TILE_SIZE - tile.size[0]) // 2
            oy = (TILE_SIZE - tile.size[1]) // 2
            canvas.paste(tile, (ox, oy), tile)
            n += 1
            name = f'gift-{n:03d}.png'
            canvas.save(OUT_DIR / name, optimize=True)
            manifest.append({'id': f'gift-{n:03d}', 'file': name, 'row': ri, 'col': ci})

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'saved {n} tiles to {OUT_DIR}')
    print(f'manifest: {MANIFEST}')


if __name__ == '__main__':
    main()
