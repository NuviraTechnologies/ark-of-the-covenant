#!/usr/bin/env python3
"""Render the v3 closing card (1920x1080 PNG) into film/cards/.
Per Richard's order (2026-11-11): the closing card carries ONLY the
project name, the track tagline, the single builder credit, the vault
explorer address, and 'Live on NEAR testnet'. No narrator credit, no
company name."""
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
BG = (11, 14, 20)
GREEN = (126, 231, 135)
BLUE = (121, 192, 255)
WHITE = (240, 246, 252)
DIM = (139, 148, 158)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cards")
TAGLINE = "Give AI money without giving it the keys to everything."


def centered(d, text, font, fill, y):
    w = d.textlength(text, font=font)
    d.text(((W - w) / 2, y), text, font=font, fill=fill)


def closing_card():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    centered(d, "ARK OF THE COVENANT", ImageFont.truetype(SANS_B, 62), WHITE, 300)
    centered(d, TAGLINE, ImageFont.truetype(SANS, 34), GREEN, 420)
    centered(d, "Built by Richard Vigslist", ImageFont.truetype(SANS_B, 44), WHITE, 540)
    centered(d, "https://testnet.nearblocks.io/address/ark3vault2120.testnet",
             ImageFont.truetype(MONO, 27), BLUE, 650)
    centered(d, "Live on NEAR testnet", ImageFont.truetype(SANS, 36), GREEN, 730)
    return img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    closing_card().save(os.path.join(OUT, "closing-v3.png"))
    print("card written to", OUT)
