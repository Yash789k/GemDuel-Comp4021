"""
Gem Rush Duel character sprite sheets.

Each character sheet is 10 columns x 8 rows of 24x25 frames (240 x 200):
  row 0 idleDown  row 1 idleLeft  row 2 idleUp  row 3 idleRight   (8 frames)
  row 4 moveDown  row 5 moveLeft  row 6 moveUp  row 7 moveRight   (10 frames)
Every species has a main palette and an "alt" palette used when both
players choose the same character.
"""
import math, os, sys
from PIL import Image

W, H = 24, 25
SCALE_PREVIEW = 6


def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


class Frame:
    def __init__(self):
        self.g = [[None] * W for _ in range(H)]

    def px(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H and c:
            self.g[y][x] = c

    def ell(self, cx, cy, rx, ry, c):
        for y in range(H):
            for x in range(W):
                if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1:
                    self.g[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.px(x, y, c)

    def poly(self, pts, c):
        for y in range(H):
            for x in range(W):
                X, Y = x + .5, y + .5
                inside = False
                j = len(pts) - 1
                for i in range(len(pts)):
                    xi, yi = pts[i]; xj, yj = pts[j]
                    if (yi > Y) != (yj > Y) and X < (xj - xi) * (Y - yi) / (yj - yi) + xi:
                        inside = not inside
                    j = i
                if inside:
                    self.g[y][x] = c

    def outline(self, c):
        filled = [[self.g[y][x] is not None for x in range(W)] for y in range(H)]
        for y in range(H):
            for x in range(W):
                if filled[y][x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    X, Y = x + dx, y + dy
                    if 0 <= X < W and 0 <= Y < H and filled[Y][X]:
                        self.g[y][x] = c
                        break

    def mirrored(self):
        f = Frame()
        f.g = [row[::-1] for row in self.g]
        return f

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for y in range(H):
            for x in range(W):
                if self.g[y][x]:
                    im.putpixel((x, y), self.g[y][x])
        return im


# ---------------------------------------------------------------- helpers
def eyes_front(f, P, y, blink, lx=8, rx=15, big=False):
    for ex in (lx, rx):
        if blink:
            f.rect(ex, y + 1, ex + 1, y + 1, P['eye'])
        else:
            f.rect(ex, y, ex + 1, y + (2 if big else 1), P['eye'])
            f.px(ex, y, P['shine'])


def eye_side(f, P, x, y, blink, big=False):
    if blink:
        f.rect(x, y + 1, x + 1, y + 1, P['eye'])
    else:
        f.rect(x, y, x + 1, y + (2 if big else 1), P['eye'])
        f.px(x, y, P['shine'])


def feet(f, P, d, step, col=None):
    """step: -1/0/1 for the walk cycle; d: direction."""
    c = col or P['dark']
    if d in ('down', 'up'):
        ly = 22 - (1 if step > 0 else 0)
        ry = 22 - (1 if step < 0 else 0)
        f.rect(8, ly, 10, ly + 1, c)
        f.rect(13, ry, 15, ry + 1, c)
    else:  # left view: front/back feet slide
        f.rect(9 - 2 * step, 22, 11 - 2 * step, 23, c)
        f.rect(13 + 2 * step, 22, 15 + 2 * step, 23, c)


def arms(f, P, d, b, swing, col=None):
    c = col or P['main']
    if d in ('down', 'up'):
        f.rect(6, 16 - b + swing, 7, 18 - b + swing, c)
        f.rect(16, 16 - b - swing, 17, 18 - b - swing, c)
    else:
        f.rect(11 + swing, 16 - b, 12 + swing, 18 - b, c)


# ---------------------------------------------------------------- species
def fox(f, P, d, b, step, swing, blink):
    if d != 'up':
        tail_x = 19 if d != 'left' else 19
        f.ell(tail_x, 16 - b, 2.6, 3.6, P['main'])
        f.ell(tail_x + .5, 13.2 - b, 1.8, 1.6, P['light'])
    feet(f, P, d, step)
    f.ell(12 if d != 'left' else 12.5, 17.5 - b, 4.5, 3.8, P['main'])
    f.ell(12 if d != 'left' else 11.5, 18.5 - b, 2.4, 2.4, P['light'])
    if d == 'up':
        f.ell(12, 19.5 - b, 2.8, 3.4, P['main'])
        f.ell(12, 22 - b, 2, 1.4, P['light'])
    arms(f, P, d, b, swing)
    if d == 'left':
        f.poly([(9, 7 - b), (11, 0 - b), (14, 6 - b)], P['main'])
        f.poly([(10.5, 5 - b), (11.2, 2 - b), (12.6, 5 - b)], P['accent'])
        f.ell(11, 9.5 - b, 5.4, 5, P['main'])
        f.poly([(2.5, 11 - b), (7, 7.5 - b), (8, 13 - b)], P['main'])
        f.poly([(2.5, 11.2 - b), (8, 11 - b), (8, 13.5 - b)], P['light'])
        f.ell(10, 12 - b, 3, 2, P['light'])
        f.px(2, 11 - b, P['eye'])
        eye_side(f, P, 7, 8 - b, blink)
    else:
        for s in (-1, 1):
            f.poly([(12 + s * 6, 8 - b), (12 + s * 5.5, 0.5 - b), (12 + s * 1.5, 5 - b)], P['main'])
            if d == 'down':
                f.poly([(12 + s * 5.2, 5.5 - b), (12 + s * 5.2, 2 - b), (12 + s * 3, 5 - b)], P['accent'])
        f.ell(12, 9.5 - b, 6.5, 5.4, P['main'])
        if d == 'down':
            f.ell(12, 12.3 - b, 5, 2.6, P['light'])
            eyes_front(f, P, 8 - b, blink)
            f.rect(11, 11 - b, 12, 11 - b, P['eye'])


def cat(f, P, d, b, step, swing, blink):
    if d != 'up':
        f.rect(17, 12 - b, 18, 20 - b, P['main'])
        f.rect(18, 10 - b, 19, 13 - b, P['main'])
        f.px(19, 10 - b, P['stripe'])
    feet(f, P, d, step, P['light'])
    f.ell(12 if d != 'left' else 12.5, 17.5 - b, 4.3, 3.8, P['main'])
    f.rect(10, 16 - b, 14, 16 - b, P['stripe']) if d == 'up' else f.ell(12 if d != 'left' else 11.5, 18.6 - b, 2.2, 2.2, P['light'])
    if d == 'up':
        f.rect(11, 18 - b, 12, 23 - b, P['main'])
        f.rect(12, 21 - b, 14, 22 - b, P['main'])
    arms(f, P, d, b, swing)
    if d == 'left':
        f.poly([(8, 6 - b), (9, 1 - b), (12.5, 5 - b)], P['main'])
        f.poly([(9, 5 - b), (9.4, 2.5 - b), (11, 5 - b)], P['accent'])
        f.ell(10.5, 9.8 - b, 5.6, 5, P['main'])
        f.rect(9, 5 - b, 12, 5 - b, P['stripe'])
        f.rect(13, 7 - b, 15, 7 - b, P['stripe'])
        f.ell(6.5, 12 - b, 2.5, 2, P['light'])
        f.px(4, 11 - b, P['accent'])
        eye_side(f, P, 6, 8 - b, blink, big=True)
        f.px(1, 12 - b, P['whisker']); f.px(2, 12 - b, P['whisker'])
    else:
        for s in (-1, 1):
            f.poly([(12 + s * 6.5, 7.5 - b), (12 + s * 6, 1.5 - b), (12 + s * 2, 5 - b)], P['main'])
            if d == 'down':
                f.poly([(12 + s * 5.7, 5.5 - b), (12 + s * 5.6, 3 - b), (12 + s * 3.4, 5.2 - b)], P['accent'])
        f.ell(12, 9.8 - b, 6.8, 5.3, P['main'])
        f.rect(11, 5 - b, 12, 6 - b, P['stripe'])
        f.rect(9, 5 - b, 9, 6 - b, P['stripe']); f.rect(14, 5 - b, 14, 6 - b, P['stripe'])
        if d == 'down':
            f.ell(12, 12.3 - b, 2.8, 1.8, P['light'])
            eyes_front(f, P, 8 - b, blink, big=True)
            f.px(11, 11 - b, P['accent']); f.px(12, 11 - b, P['accent'])
            for s in (-1, 1):
                f.px(12 + s * 7, 11 - b, P['whisker']); f.px(12 + s * 7 - (1 if s > 0 else 0), 12 - b, P['whisker'])
        else:
            f.rect(10, 8 - b, 13, 8 - b, P['stripe'])


def frog(f, P, d, b, step, swing, blink):
    # wide webbed feet
    c = P['dark']
    if d in ('down', 'up'):
        ly = 22 - (1 if step > 0 else 0); ry = 22 - (1 if step < 0 else 0)
        f.rect(6, ly + 1, 10, ly + 1, c); f.rect(8, ly, 9, ly, c)
        f.rect(13, ry + 1, 17, ry + 1, c); f.rect(14, ry, 15, ry, c)
    else:
        f.rect(7 - 2 * step, 23, 11 - 2 * step, 23, c); f.rect(9 - 2 * step, 22, 10 - 2 * step, 22, c)
        f.rect(13 + 2 * step, 23, 17 + 2 * step, 23, c); f.rect(14 + 2 * step, 22, 15 + 2 * step, 22, c)
    f.ell(12, 17.6 - b, 5.4, 4, P['main'])
    if d != 'up':
        f.ell(12 if d == 'down' else 11, 18.6 - b, 3.4, 2.6, P['light'])
    else:
        f.px(10, 17 - b, P['spot']); f.px(14, 18 - b, P['spot']); f.px(12, 20 - b, P['spot'])
    arms(f, P, d, b, swing)
    if d == 'left':
        f.ell(11, 11 - b, 6.5, 4.4, P['main'])
        f.ell(9, 6.8 - b, 3, 2.8, P['main'])
        f.ell(8.6, 6.8 - b, 2, 1.8, P['light'])
        eye_side(f, P, 7, 6 - b, blink)
        f.rect(4, 13 - b, 10, 13 - b, P['dark'])
        f.px(15, 9 - b, P['spot']); f.px(13, 11 - b, P['spot'])
    else:
        f.ell(12, 11 - b, 7.6, 4.3, P['main'])
        for s in (-1, 1):
            f.ell(12 + s * 4.5, 6.8 - b, 3, 2.8, P['main'])
            if d == 'down':
                f.ell(12 + s * 4.5, 6.8 - b, 2, 1.8, P['light'])
        if d == 'down':
            eyes_front(f, P, 6 - b, blink, lx=7, rx=16)
            f.rect(8, 12 - b, 15, 12 - b, P['dark'])
            f.px(7, 11 - b, P['dark']); f.px(16, 11 - b, P['dark'])
            f.px(6, 11 - b, P['blush']); f.px(17, 11 - b, P['blush'])
        else:
            f.px(10, 10 - b, P['spot']); f.px(14, 11 - b, P['spot'])


def owl(f, P, d, b, step, swing, blink):
    feet(f, P, d, step, P['accent'])
    cx = 12 if d != 'left' else 12
    f.ell(cx, 13.5 - b, 7, 8.6, P['main'])
    # ear tufts
    if d == 'left':
        f.poly([(9, 6 - b), (10, 1 - b), (13, 5 - b)], P['main'])
    else:
        for s in (-1, 1):
            f.poly([(12 + s * 6.5, 7 - b), (12 + s * 6, 1 - b), (12 + s * 2.5, 5 - b)], P['main'])
    # wings flap while walking
    lift = abs(swing)
    if d in ('down', 'up'):
        for s in (-1, 1):
            f.poly([(12 + s * 6, 12 - b - lift), (12 + s * 9, 16 - b - lift), (12 + s * 6.5, 20 - b)], P['dark'])
    else:
        f.poly([(13, 12 - b), (18 + lift, 15 - b - lift), (16, 20 - b)], P['dark'])
    if d == 'down':
        f.ell(12, 17 - b, 4.2, 4, P['light'])
        for (x, y) in ((10, 15), (13, 15), (11, 17), (14, 17), (10, 19), (13, 19)):
            f.px(x, y - b, P['dark'])
        for s in (-1, 1):
            f.ell(12 + s * 3, 8.5 - b, 2.8, 2.8, P['face'])
        eyes_front(f, P, 7 - b, blink, lx=8, rx=14, big=True)
        f.poly([(11, 10.5 - b), (13, 10.5 - b), (12, 13.2 - b)], P['beak'])
    elif d == 'left':
        f.ell(8, 9 - b, 3, 3, P['face'])
        eye_side(f, P, 6, 7 - b, blink, big=True)
        f.poly([(3, 10 - b), (5.5, 9 - b), (5.5, 12 - b)], P['beak'])
        f.ell(9, 16.5 - b, 3, 3.5, P['light'])
    else:
        for (x, y) in ((10, 10), (14, 10), (12, 13), (10, 16), (14, 16)):
            f.px(x, y - b, P['dark'])


def bunny(f, P, d, b, step, swing, blink):
    feet(f, P, d, step, P['light'])
    f.ell(12 if d != 'left' else 12.5, 17.8 - b, 4.4, 3.8, P['main'])
    if d != 'up':
        f.ell(12 if d != 'left' else 11.5, 18.6 - b, 2.3, 2.4, P['light'])
    arms(f, P, d, b, swing)
    if d == 'left':
        f.ell(17.5, 18 - b, 1.8, 1.8, P['light'])
        f.ell(13, 4 - b, 1.8, 4.6, P['main']); f.ell(13, 4 - b, .8, 3.4, P['accent'])
        f.ell(15.5, 5 - b, 1.6, 4, P['main'])
        f.ell(10.5, 11 - b, 5.4, 4.6, P['main'])
        f.ell(6.5, 12.5 - b, 2.4, 1.8, P['light'])
        f.px(4, 11 - b, P['accent'])
        f.px(5, 14 - b, P['tooth'])
        eye_side(f, P, 7, 9 - b, blink, big=True)
    else:
        for s in (-1, 1):
            f.ell(12 + s * 2.6, 3.8 - b, 1.9, 4.8, P['main'])
            if d == 'down':
                f.ell(12 + s * 2.6, 4 - b, .8, 3.4, P['accent'])
        f.ell(12, 11 - b, 6.4, 4.8, P['main'])
        if d == 'down':
            f.ell(12, 13 - b, 2.8, 1.7, P['light'])
            eyes_front(f, P, 9 - b, blink, big=True)
            f.px(11, 12 - b, P['accent']); f.px(12, 12 - b, P['accent'])
            f.px(11, 14 - b, P['tooth']); f.px(12, 14 - b, P['tooth'])
            f.px(7, 12 - b, P['blush']); f.px(16, 12 - b, P['blush'])
        else:
            f.ell(12, 20 - b, 2, 1.8, P['light'])


def bear(f, P, d, b, step, swing, blink):
    feet(f, P, d, step)
    f.ell(12 if d != 'left' else 12.5, 17.5 - b, 5.2, 4.2, P['main'])
    if d != 'up':
        f.ell(12 if d != 'left' else 11.5, 18.4 - b, 2.8, 2.6, P['light'])
    else:
        f.ell(12, 20 - b, 1.5, 1.3, P['light'])
    arms(f, P, d, b, swing, P['dark'])
    if d == 'left':
        f.ell(13, 5.5 - b, 2.2, 2.2, P['main']); f.ell(13, 5.5 - b, 1, 1, P['accent'])
        f.ell(11, 10 - b, 5.8, 5.2, P['main'])
        f.ell(6, 11.8 - b, 2.8, 2.2, P['light'])
        f.rect(3, 10 - b, 4, 11 - b, P['eye'])
        eye_side(f, P, 8, 8 - b, blink)
    else:
        for s in (-1, 1):
            f.ell(12 + s * 5, 5 - b, 2.3, 2.3, P['main'])
            if d == 'down':
                f.ell(12 + s * 5, 5 - b, 1.1, 1.1, P['accent'])
        f.ell(12, 10 - b, 6.6, 5.6, P['main'])
        if d == 'down':
            f.ell(12, 12.6 - b, 3, 2.2, P['light'])
            f.rect(11, 11 - b, 12, 12 - b, P['eye'])
            eyes_front(f, P, 8 - b, blink)


def panda(f, P, d, b, step, swing, blink):
    feet(f, P, d, step, P['patch'])
    f.ell(12 if d != 'left' else 12.5, 17.8 - b, 5, 4.2, P['main'])
    # black shoulder band
    f.rect(7 if d != 'left' else 9, 15 - b, 17 if d != 'left' else 16, 16 - b, P['patch'])
    arms(f, P, d, b, swing, P['patch'])
    if d == 'left':
        f.ell(13.5, 5.2 - b, 2.2, 2.2, P['patch'])
        f.ell(10.8, 10 - b, 5.8, 5.2, P['main'])
        f.ell(7, 9.6 - b, 2, 2.2, P['patch'])
        f.ell(5.5, 12.4 - b, 2.4, 1.6, P['main'])
        f.rect(3, 11 - b, 4, 11 - b, P['eye'])
        if not blink:
            f.px(7, 9 - b, P['shine'])
    else:
        for s in (-1, 1):
            f.ell(12 + s * 5.2, 4.8 - b, 2.4, 2.4, P['patch'])
        f.ell(12, 10 - b, 6.8, 5.6, P['main'])
        if d == 'down':
            for s in (-1, 1):
                f.ell(12 + s * 3.2, 9.6 - b, 1.9, 2.3, P['patch'])
                if not blink:
                    f.px(12 + s * 3.2 - (1 if s < 0 else 0), 9 - b, P['shine'])
            f.rect(11, 12 - b, 12, 12 - b, P['eye'])
            f.px(7, 12 - b, P['blush']); f.px(16, 12 - b, P['blush'])


def penguin(f, P, d, b, step, swing, blink):
    feet(f, P, d, step, P['beak'])
    f.ell(12, 13.5 - b, 6.4, 9, P['main'])
    if d == 'down':
        f.ell(12, 15 - b, 4.4, 6.8, P['light'])
        f.ell(12, 9.5 - b, 4.6, 3.4, P['light'])
        eyes_front(f, P, 8 - b, blink, lx=9, rx=14)
        f.poly([(10.5, 10.5 - b), (13.5, 10.5 - b), (12, 12.8 - b)], P['beak'])
        f.px(8, 11 - b, P['blush']); f.px(15, 11 - b, P['blush'])
    elif d == 'left':
        f.ell(9.5, 15 - b, 3.4, 6, P['light'])
        f.ell(8.5, 9 - b, 3, 2.8, P['light'])
        eye_side(f, P, 7, 7 - b, blink)
        f.poly([(2.5, 10 - b), (6, 8.5 - b), (6, 11 - b)], P['beak'])
    else:
        f.rect(11, 4 - b, 13, 4 - b, P['dark'])
    # flippers
    lift = abs(swing)
    if d in ('down', 'up'):
        for s in (-1, 1):
            f.poly([(12 + s * 5.5, 11 - b), (12 + s * (8.5 + lift), 17 - b - lift), (12 + s * 6, 18 - b)], P['dark'])
    else:
        f.poly([(13, 11 - b), (17 + lift, 17 - b - lift), (14.5, 18 - b)], P['dark'])
    # crest feathers (penguin has a little head tuft so it reads at small size)
    f.px(12 if d != 'left' else 11, 4 - b, P['crest']); f.px(13 if d != 'left' else 12, 3 - b, P['crest'])


SPECIES = {
    'fox': (fox, {
        'main': '#f0913c', 'light': '#ffedbd', 'dark': '#7a3c1c', 'accent': '#5a2a14', 'eye': '#111b25', 'shine': '#ffffff', 'outline': '#3a1a0c'
    }, {'main': '#e8eef5', 'light': '#ffffff', 'dark': '#7f8fa6', 'accent': '#9fb0c4', 'eye': '#111b25', 'shine': '#ffffff', 'outline': '#3b4658'}),
    'cat': (cat, {
        'main': '#7ac2df', 'light': '#f7dab6', 'stripe': '#4a8fb0', 'dark': '#3b6f8a', 'accent': '#ff8fa8', 'eye': '#263e56', 'shine': '#ffffff', 'whisker': '#e9f6ff', 'outline': '#1d3a4a'
    }, {'main': '#3a3a48', 'light': '#d9d9e3', 'stripe': '#26262f', 'dark': '#22222b', 'accent': '#ff8fa8', 'eye': '#ffd84a', 'shine': '#ffffff', 'whisker': '#c8c8d8', 'outline': '#121218'}),
    'frog': (frog, {
        'main': '#6fcf73', 'light': '#e4f7c3', 'dark': '#2c7a38', 'spot': '#3f9e4a', 'blush': '#ff9f9f', 'eye': '#142b35', 'shine': '#ffffff', 'outline': '#173f22'
    }, {'main': '#4aa8ff', 'light': '#d9f0ff', 'dark': '#1b4e9e', 'spot': '#15214a', 'blush': '#ffb0c8', 'eye': '#101a33', 'shine': '#ffffff', 'outline': '#0e2450'}),
    'owl': (owl, {
        'main': '#a98ae6', 'light': '#e6dbff', 'dark': '#6c4fb2', 'face': '#f8efcf', 'beak': '#f1bd5d', 'accent': '#f1bd5d', 'eye': '#172331', 'shine': '#ffffff', 'outline': '#30205a'
    }, {'main': '#eef1f6', 'light': '#ffffff', 'dark': '#9aa6b8', 'face': '#ffffff', 'beak': '#3a3a3a', 'accent': '#f1bd5d', 'eye': '#e0a020', 'shine': '#ffffff', 'outline': '#4a5466'}),
    'bunny': (bunny, {
        'main': '#f4e9f2', 'light': '#ffffff', 'dark': '#c7aec2', 'accent': '#ff8fbf', 'blush': '#ffb6d2', 'tooth': '#ffffff', 'eye': '#3a2340', 'shine': '#ffffff', 'outline': '#6a4a66'
    }, {'main': '#b68a62', 'light': '#f0dcc2', 'dark': '#7a5634', 'accent': '#f2a6a6', 'blush': '#ffb6a6', 'tooth': '#ffffff', 'eye': '#2a1a10', 'shine': '#ffffff', 'outline': '#3e2814'}),
    'bear': (bear, {
        'main': '#a8703f', 'light': '#e8c49a', 'dark': '#6e4422', 'accent': '#6e4422', 'eye': '#1a120c', 'shine': '#ffffff', 'outline': '#3a220e'
    }, {'main': '#f4f7fa', 'light': '#ffffff', 'dark': '#b9c4d0', 'accent': '#c9d3de', 'eye': '#1a1a22', 'shine': '#ffffff', 'outline': '#4c5a6a'}),
    'panda': (panda, {
        'main': '#f6f6f2', 'patch': '#25282e', 'eye': '#25282e', 'shine': '#ffffff', 'blush': '#ffb0c0', 'outline': '#15171b'
    }, {'main': '#e9763a', 'patch': '#4a2216', 'eye': '#2a120a', 'shine': '#ffffff', 'blush': '#ffd0a0', 'outline': '#2a120a'}),
    'penguin': (penguin, {
        'main': '#2f4a6b', 'light': '#f4f8ff', 'dark': '#1c2f47', 'beak': '#ffa53a', 'crest': '#ffd24a', 'blush': '#ffb0c0', 'eye': '#101820', 'shine': '#ffffff', 'outline': '#0c1522'
    }, {'main': '#6b2f5a', 'light': '#fff4fb', 'dark': '#451c3a', 'beak': '#ffcf3a', 'crest': '#ff6ad5', 'blush': '#ffb0c0', 'eye': '#101820', 'shine': '#ffffff', 'outline': '#240c1e'}),
}


def render(fn, pal, d, b, step, swing, blink):
    P = {k: hexc(v) for k, v in pal.items()}
    P.setdefault('dark', P['outline']); P.setdefault('light', P['main'])
    f = Frame()
    base = 'left' if d == 'right' else d
    fn(f, P, base, b, step, swing, blink)
    f.outline(P['outline'])
    return f.mirrored() if d == 'right' else f


def sheet(fn, pal):
    im = Image.new('RGBA', (W * 10, H * 8), (0, 0, 0, 0))
    dirs = ['down', 'left', 'up', 'right']
    for r, d in enumerate(dirs):
        # idle: 8 frames looping at 250 ms (breathe in frames 2-3, blink in frame 7)
        for i in range(8):
            b = 1 if i in (2, 3) else 0
            im.paste(render(fn, pal, d, b, 0, 0, i == 7).image(), (i * W, r * H))
        # walk: 10 frames at 50 ms
        for i in range(10):
            ph = i / 10 * 2 * math.pi
            s = math.sin(ph)
            step = 1 if s > .35 else -1 if s < -.35 else 0
            b = 1 if abs(math.cos(ph)) < .5 else 0
            swing = 1 if s > .35 else -1 if s < -.35 else 0
            im.paste(render(fn, pal, d, b, step, swing, False).image(), (i * W, (r + 4) * H))
    return im


# ---------------------------------------------------------------- avatars
# Avatar icons are drawn from the same pixels as the idle-down frame,
# so the avatar a player picks is exactly the character they play.
def avatar_svg(fn, pal):
    f = render(fn, pal, 'down', 0, 0, 0, False)
    s, ox, oy = 2.4, 3.2, 3.0
    parts = []
    for y in range(H):
        x = 0
        while x < W:
            c = f.g[y][x]
            if not c:
                x += 1; continue
            x0 = x
            while x < W and f.g[y][x] == c:
                x += 1
            col = '#%02x%02x%02x' % c[:3]
            parts.append(f'<rect x="{ox + x0 * s:.1f}" y="{oy + y * s:.1f}" width="{(x - x0) * s + .05:.2f}" height="{s + .05:.2f}" fill="{col}"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
            '<rect width="64" height="64" rx="12" fill="#192c39"/>' + ''.join(parts) + '</svg>')


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: make_characters.py SHEET_DIR [PREVIEW_PNG [AVATAR_DIR]]')
    output_dir = sys.argv[1]
    os.makedirs(output_dir, exist_ok=True)
    preview_rows = []
    for name, (fn, main, alt) in SPECIES.items():
        for tag, pal in (('', main), ('-alt', alt)):
            sh = sheet(fn, pal)
            sh.save(os.path.join(output_dir, f'char-{name}{tag}.png'))
            preview_rows.append(sh)
    if len(sys.argv) > 2:
        # preview: idle down/left/up/right frame 0 + 4 walk frames down, for each sheet
        cols = []
        for sh in preview_rows:
            strip = Image.new('RGBA', (W * 8, H), (60, 120, 60, 255))
            for k, (cx, ry) in enumerate([(0, 0), (0, 1), (0, 2), (0, 3), (1, 4), (3, 4), (6, 4), (2, 5)]):
                fr = sh.crop((cx * W, ry * H, cx * W + W, ry * H + H))
                strip.alpha_composite(fr, (k * W, 0))
            cols.append(strip)
        big = Image.new('RGBA', (W * 8 * 2 + 8, H * (len(cols) // 2)), (40, 40, 40, 255))
        for i, s in enumerate(cols):
            big.alpha_composite(s, ((i % 2) * (W * 8 + 8), (i // 2) * H))
        big.resize((big.width * SCALE_PREVIEW, big.height * SCALE_PREVIEW), Image.NEAREST).save(sys.argv[2])
    print('characters ok')

    if len(sys.argv) > 3:
        for name, (fn, main, alt) in SPECIES.items():
            with open(os.path.join(sys.argv[3], f'avatar-{name}.svg'), 'w') as fh:
                fh.write(avatar_svg(fn, main))
        print('avatars ok')


if __name__ == '__main__':
    main()
