#!/usr/bin/env python3
"""펀드 모의고사 런처 아이콘 생성기.

다크 네이비(#061124~#0B2340) 배경 + 스카이블루(#38BDF8) 'F' 심볼.
- mipmap-*dpi/ic_launcher.png, ic_launcher_round.png  (레거시 아이콘)
- mipmap-*dpi/ic_launcher_foreground.png              (적응형 아이콘 전경)
- adaptive-icon XML 은 mipmap-anydpi-v26/ 에 고정 파일로 둔다.

'F' 는 폰트 글리프 대신 기하 도형(세로 기둥 + 위·가운데 가로획)으로 그린다.
획 두께를 세 방향 모두 같게 맞춰 작은 크기(48dp)에서도 균형이 유지된다.

실행:  python3 android/tools/make_icons.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.abspath(os.path.join(HERE, "..", "app", "src", "main", "res"))

DEEP = (6, 17, 36)          # #061124
DEEP2 = (11, 35, 64)        # #0B2340
DEEP3 = (18, 58, 99)        # #123A63
SKY = (56, 189, 248)        # #38BDF8
SKY_SOFT = (125, 211, 252)  # #7DD3FC

# 'F' 비율(캔버스 대비) — 기둥 두께와 가로획 두께를 동일하게 유지한다.
F_STROKE = 0.115
F_WIDTH = 0.460
F_HEIGHT = 0.580
F_MID_BAR = 0.470     # 가운데 획의 높이 위치(세로 비율)
F_MID_WIDTH = 0.880   # 가운데 획 길이(전체 폭 대비)
F_TOP_WIDTH = 1.000   # 위 획 길이(전체 폭 대비)
F_RISE = 0.050        # 광학 중심 보정(아래 프로그레스 바 자리 확보)

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def gradient(size: int) -> Image.Image:
    """대각선 다크 네이비 그라디언트."""
    img = Image.new("RGB", (size, size), DEEP)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        for x in range(size):
            # 좌상단에서 우하단으로 살짝 더 밝아지는 결
            k = (x / max(1, size - 1)) * 0.18 + t * 0.82
            px[x, y] = (
                int(DEEP[0] + (DEEP3[0] - DEEP[0]) * k * 0.55),
                int(DEEP[1] + (DEEP3[1] - DEEP[1]) * k * 0.55),
                int(DEEP[2] + (DEEP3[2] - DEEP[2]) * k * 0.55),
            )
    return img


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def draw_f(draw: ImageDraw.ImageDraw, size: int, fill: tuple[int, int, int, int]) -> None:
    """'F' 를 세 개의 사각 획으로 그린다(같은 두께·각진 끝단)."""
    stroke = int(size * F_STROKE)
    width = int(size * F_WIDTH)
    height = int(size * F_HEIGHT)

    left = (size - width) // 2
    top = (size - height) // 2 - int(size * F_RISE)

    # 세로 기둥
    draw.rectangle((left, top, left + stroke, top + height), fill=fill)
    # 위 가로획
    draw.rectangle(
        (left, top, left + int(width * F_TOP_WIDTH), top + stroke), fill=fill
    )
    # 가운데 가로획
    mid_y = top + int(height * F_MID_BAR)
    draw.rectangle(
        (left, mid_y, left + int(width * F_MID_WIDTH), mid_y + stroke), fill=fill
    )


def draw_mark(size: int, width_ratio: float = 1.0) -> Image.Image:
    """스카이블루 'F' + 아래 얇은 진행 바 — 투명 레이어."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 부드러운 스카이 글로우
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_f(ImageDraw.Draw(glow), size, SKY + (90,))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.018))
    layer = Image.alpha_composite(layer, glow)

    draw = ImageDraw.Draw(layer)
    draw_f(draw, size, SKY + (255,))

    # F 아래 슬림 바(로딩 화면의 프로그레스 바 모티프)
    bar_w = size * 0.46 * width_ratio
    bar_h = max(3, int(size * 0.045))
    bx = (size - bar_w) / 2
    by = size * 0.775
    draw.rounded_rectangle(
        (bx, by, bx + bar_w, by + bar_h),
        radius=bar_h / 2,
        fill=SKY + (90,),
    )
    fill_w = bar_w * 0.62
    draw.rounded_rectangle(
        (bx, by, bx + fill_w, by + bar_h),
        radius=bar_h / 2,
        fill=SKY + (255,),
    )
    return layer


def make_legacy(size: int, round_icon: bool) -> Image.Image:
    s = size * 4
    bg = gradient(s).convert("RGBA")
    mask = circle_mask(s) if round_icon else rounded_mask(s, s * 0.215)

    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    mark = draw_mark(int(s * 0.90))
    off = (s - mark.width) // 2
    mark_alpha = ImageChops.multiply(mark.getchannel("A"), mask)
    mark.putalpha(mark_alpha)
    img.alpha_composite(mark, (off, (s - mark.height) // 2))

    return img.resize((size, size), Image.LANCZOS)


def make_foreground(size: int) -> Image.Image:
    """적응형 아이콘 전경(108dp 캔버스) — 안전 영역 안쪽에 F 만."""
    s = size * 4
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner = int(s * 0.70)
    mark = draw_mark(inner)
    off = (s - mark.width) // 2
    layer.alpha_composite(mark, (off, off))
    return layer.resize((size, size), Image.LANCZOS)


def make_previews() -> None:
    """저장소 루트의 미리보기 이미지(icon_preview.png, mark_preview.png) 갱신."""
    root = os.path.abspath(os.path.join(HERE, "..", ".."))

    tile = 176
    canvas = Image.new("RGB", (384, 384), DEEP)
    square = make_legacy(tile, round_icon=False).resize((tile, tile), Image.LANCZOS)
    circle = make_legacy(tile, round_icon=True).resize((tile, tile), Image.LANCZOS)
    mark = draw_mark(tile)
    mark_bg = Image.new("RGB", (tile, tile), DEEP)
    mark_bg.paste(mark, (0, 0), mark)

    canvas.paste(square.convert("RGB"), (32, 24))
    canvas.paste(mark_bg, (208, 24))
    canvas.paste(circle.convert("RGB"), (32, 208))
    canvas.save(os.path.join(root, "icon_preview.png"))

    big = draw_mark(300)
    mark_canvas = Image.new("RGB", (300, 300), DEEP)
    mark_canvas.paste(big, (0, 0), big)
    mark_canvas.save(os.path.join(root, "mark_preview.png"))


def main() -> None:
    for dens, scale in DENSITIES.items():
        out = os.path.join(RES, f"mipmap-{dens}")
        os.makedirs(out, exist_ok=True)

        legacy = int(48 * scale)
        make_legacy(legacy, round_icon=False).save(os.path.join(out, "ic_launcher.png"))
        make_legacy(legacy, round_icon=True).save(
            os.path.join(out, "ic_launcher_round.png")
        )

        fg = int(108 * scale)
        make_foreground(fg).save(os.path.join(out, "ic_launcher_foreground.png"))
        print(f"{dens}: launcher {legacy}px, foreground {fg}px")

    make_previews()
    print("previews: icon_preview.png, mark_preview.png")


if __name__ == "__main__":
    main()
