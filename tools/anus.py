from pathlib import Path
from PIL import Image, ImageFile
import pytesseract
import re
import json
import shutil

ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

SOURCE_IMAGE = Path("../Default Gifts.png")
OUT_DIR = Path("../src/miniapp/public/gifts_named")
OUT_JSON = Path("../src/miniapp/src/gifts_named.json")

ROWS = 36
COLS = 10

# Если tesseract не найден, раскомментируй:
# pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9а-яё\s_-]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", "-", text)
    return text[:70] or "gift"

def clean_name(text: str, index: int) -> str:
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    bad = {"default", "gifts", "gift", "telegram", "svg", "community", "figma"}

    candidates = []
    for line in lines:
        line = re.sub(r"[^A-Za-zА-Яа-яЁё0-9 '&()._-]", "", line).strip()
        if len(line) < 2:
            continue
        if line.lower() in bad:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        candidates.append(line)

    if candidates:
        return candidates[0]

    return f"Gift {index:03d}"

def main():
    if not SOURCE_IMAGE.exists():
        raise FileNotFoundError(f"Не найден файл: {SOURCE_IMAGE.resolve()}")

    print("Opening image...")
    img = Image.open(SOURCE_IMAGE).convert("RGBA")
    w, h = img.size

    tile_w = w // COLS
    tile_h = h // ROWS

    print(f"Image size: {w}x{h}")
    print(f"Tile size: {tile_w}x{tile_h}")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    catalog = []
    used = set()
    count = 0

    for row in range(ROWS):
        for col in range(COLS):
            count += 1

            left = col * tile_w
            top = row * tile_h
            right = left + tile_w
            bottom = top + tile_h

            tile = img.crop((left, top, right, bottom))

            # OCR по уменьшенной плитке. Если плохо читает — увеличиваем.
            ocr_img = tile.convert("RGB")
            ocr_img = ocr_img.resize((tile_w * 2, tile_h * 2))

            try:
                raw_text = pytesseract.image_to_string(
                    ocr_img,
                    lang="eng",
                    config="--psm 6"
                )
            except Exception as e:
                raw_text = ""
                print(f"OCR error on {count}: {e}")

            display_name = clean_name(raw_text, count)
            slug = slugify(display_name)

            filename = f"{count:03d}-{slug}.png"
            n = 2
            while filename in used:
                filename = f"{count:03d}-{slug}-{n}.png"
                n += 1

            used.add(filename)
            out_path = OUT_DIR / filename
            tile.save(out_path)

            catalog.append({
                "id": count,
                "name": display_name,
                "icon": f"/gifts_named/{filename}",
                "status": "active"
            })

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Done. Saved {count} gifts to {OUT_DIR}")
    print(f"Catalog: {OUT_JSON}")

if __name__ == "__main__":
    main()