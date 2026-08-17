"""Cut XRK logo from generated PNG: drop black frame + cream plate → transparent mark."""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

SRC = r"C:\Users\sunflowerss\.cursor\projects\c-Users-sunflowerss-Desktop-XRKgrocery-XRK-harness\assets\xrk-logo-crisp.png"

OUTS = [
    r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\docs\assets\logo.png",
    r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\apps\web\public\logo.png",
    r"C:\Users\sunflowerss\Desktop\XRKbar\deepseek-harness\apps\web\public\logo.png",
    r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\vendor\dsh-web-static\logo.png",
]


def is_black(r: int, g: int, b: int, a: int) -> bool:
    return a > 200 and r < 45 and g < 45 and b < 45


def is_cream(r: int, g: int, b: int, a: int) -> bool:
    return a > 200 and r > 200 and g > 195 and b > 180 and abs(r - g) < 45


def save_scaled(img: Image.Image, path: str, size: int) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG")


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    px = im.load()
    assert px is not None

    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not is_black(r, g, b, a):
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("no non-black content")

    pad = 6
    left = max(0, min(xs) - pad)
    top = max(0, min(ys) - pad)
    right = min(w - 1, max(xs) + pad)
    bot = min(h - 1, max(ys) + pad)
    crop = im.crop((left, top, right + 1, bot + 1))
    cw, ch = crop.size
    cp = crop.load()
    assert cp is not None

    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    op = out.load()
    assert op is not None
    for y in range(ch):
        for x in range(cw):
            r, g, b, a = cp[x, y]
            edge = x < cw * 0.1 or x > cw * 0.9 or y < ch * 0.1 or y > ch * 0.9
            if is_cream(r, g, b, a):
                op[x, y] = (0, 0, 0, 0)
            elif is_black(r, g, b, a) and edge:
                op[x, y] = (0, 0, 0, 0)
            else:
                op[x, y] = (r, g, b, a)

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)

    mark = out
    mw, mh = mark.size
    side = max(mw, mh)
    pad2 = int(side * 0.1)
    canvas_side = side + pad2 * 2
    icon = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    icon.paste(mark, ((canvas_side - mw) // 2, (canvas_side - mh) // 2), mark)

    plate = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(plate)
    rr = int(canvas_side * 0.2)
    draw.rounded_rectangle(
        [0, 0, canvas_side - 1, canvas_side - 1],
        radius=rr,
        fill=(247, 246, 240, 255),
    )
    plate.paste(mark, ((canvas_side - mw) // 2, (canvas_side - mh) // 2), mark)

    for base in OUTS:
        save_scaled(icon, base, 512)
        save_scaled(icon, base.replace("logo.png", "favicon-mark.png"), 64)
        save_scaled(plate, base.replace("logo.png", "logo-plate.png"), 512)

    # SVG-friendly small transparent for favicon replacement companion
    docs = r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\docs\assets"
    save_scaled(icon, os.path.join(docs, "logo-transparent.png"), 256)
    save_scaled(plate, os.path.join(docs, "logo-plate.png"), 512)
    print("wrote", len(OUTS), "bases; mark", icon.size)


if __name__ == "__main__":
    main()
