"""Draw Ember Courier and collectible artwork. Run with Python 3 + Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'assets'
CHARS = ASSETS / 'characters'
INK = '#211d27'
BRONZE, LIGHT, SHADE = '#cd804e', '#ffd588', '#885145'
CLOAK, FOLD, EDGE = '#30657b', '#154454', '#75bdd2'
PLUME, TIP = '#ec624d', '#ffac62'
GOLD, GLOW = '#e7a13f', '#fff0a5'

def courier(direction, frame, walking):
    """Draw one 24x25 cell. Soles share baseline y=23 across every frame."""
    side = direction in ('left', 'right')
    back = direction == 'up'
    phase = (0, 1, 2, 2, 1, 0, -1, -2, -2, -1)[frame] if walking else 0
    lift = int(walking and abs(phase) == 2)
    breathe = int(not walking and frame in (3, 4, 5))
    blink = not walking and frame == 7
    bob = breathe - lift
    im = Image.new('RGBA', (24, 25))
    d = ImageDraw.Draw(im)
    def poly(points, color, dy=0):
        d.polygon([(x,y+dy) for x,y in points], fill=color, outline=INK)
    def rect(x,y,xx,yy,color):
        d.rectangle((x,y,xx,yy), fill=color)
    # Alternating boots keep one sole planted, including the elongated side-view stride.
    for x, step in ((9, phase), (14, -phase)):
        end = 23 - (1 if step > 0 else 0)
        shift = step if side else 0
        poly([(x-1,18),(x+2,18),(x+2+shift,end-2),(x+3+shift,end-1),
              (x+2+shift,end),(x-2+shift,end),(x-2+shift,end-2)], SHADE)
        rect(x-1+shift,end-2,x+1+shift,end-2,BRONZE)
    # Layered short travelling cloak and the cross-body bag.
    poly([(9,12),(15,12),(17,15),(18,19),(15,21),(7,20),(6,17)], CLOAK, bob)
    rect(8,17+bob,9,19+bob,FOLD)
    d.line((10,14+bob,15,18+bob), fill=LIGHT, width=2)
    rect(14,17+bob,17,20+bob,INK)
    rect(15,18+bob,16,19+bob,BRONZE)
    # Low, overhanging helmet brim, a riveted faceplate and swept feather.
    poly([(5,8),(6,5),(8,4),(14,3),(17,5),(18,8),(19,9),
          (19,11),(17,11),(16,14),(13,16),(8,15),(6,13),(6,11),(4,10)],BRONZE,bob)
    d.line((7,7+bob,9,5+bob,13,5+bob), fill=LIGHT)
    rect(6,9+bob,18,10+bob,SHADE)
    rect(5,9+bob,17,9+bob,LIGHT)
    if back:
        rect(8,11+bob,15,13+bob,SHADE)
        rect(10,11+bob,14,12+bob,BRONZE)
        d.point((16,12+bob),fill=LIGHT)
    else:
        start = 5 if side else 8
        rect(start+1,10+bob,start+8,13+bob,INK)
        rect(start+2,11+bob,start+7,12+bob,FOLD)
        if not blink:
            rect(start+2,11+bob,start+3,12+bob,EDGE)
            if not side: rect(start+6,11+bob,start+7,12+bob,EDGE)
        d.point((16,12+bob),fill=LIGHT)
    tip = int((walking and phase>0) or breathe)
    poly([(10,6),(10,3),(12,1),(17,1),(20,0+tip),(19,3+tip),
          (16,4),(13,4),(12,6)],PLUME,bob)
    d.line((12,3+bob,15,2+bob,17,2+bob),fill=TIP)
    # Small hanging lantern follows the carrying hand.
    lx = (4 if not back else 18) + (1 if phase>0 else 0)
    ly = 15+bob
    d.arc((lx-1,ly-1,lx+3,ly+3),180,360,fill=INK)
    rect(lx-2,ly+2,lx+4,ly+5,INK);rect(lx-1,ly+6,lx+3,ly+6,INK)
    rect(lx-1,ly+3,lx+2,ly+4,GOLD);rect(lx,ly+3,lx+1,ly+4,GLOW)
    return ImageOps.mirror(im) if direction == 'right' else im

def alternate(sheet, swaps):
    result = sheet.copy()
    rgb = {tuple(bytes.fromhex(a)):tuple(bytes.fromhex(b)) for a,b in swaps.items()}
    for y in range(result.height):
        for x in range(result.width):
            r,g,b,a = result.getpixel((x,y))
            if a and (r,g,b) in rgb:
                result.putpixel((x,y), (*rgb[r,g,b],a))
    return result

def pickups():
    # Objects share the arena gem sheet's 16-pixel grid and one-pixel dark keyline.
    im=Image.new('RGBA',(16,16)); d=ImageDraw.Draw(im)
    d.polygon([(2,6),(5,4),(8,4),(9,1),(14,0),(13,4),(10,5),(13,7),(14,10),
               (13,13),(10,15),(5,15),(2,13),(1,10)],fill=INK)
    d.polygon([(9,4),(11,2),(13,1),(12,3)],fill='#83b749')
    d.ellipse((2,5,13,14),fill='#ed9961')
    d.ellipse((3,5,12,13),fill='#ffe8a2');d.ellipse((4,6,11,12),fill='#ed695f')
    d.line((5,6,8,9,10,6),fill='#ffd89a');d.line((4,11,8,9,11,11),fill='#ffd89a')
    d.line((8,9,8,12),fill='#ffd89a');d.point((5,8),fill='#ffaba3');d.point((10,8),fill='#ffaba3')
    im.save(ASSETS/'grapefruit.png')

    im=Image.new('RGBA',(16,16)); d=ImageDraw.Draw(im)
    d.polygon([(1,8),(5,4),(7,4),(11,0),(13,0),(15,2),(15,4),(11,8),(10,10),
               (7,11),(6,14),(4,15),(2,13),(3,10),(1,10)],fill=INK)
    d.polygon([(2,8),(5,5),(8,5),(11,2),(14,3),(10,7),(9,9),(6,10),(4,9)],fill='#6889a5')
    d.line((5,6,8,6,11,3),fill='#c2efff');d.line((6,8,9,7,12,4),fill='#41617b')
    d.line((4,13,6,10),fill='#bd8157',width=2);d.line((11,1,14,4),fill='#d94960',width=2)
    d.line((12,1,14,3),fill='#ffb5a0');d.point((7,7),fill='#ffefaa')
    im.save(ASSETS/'laser.png')

    # Side-facing plasma round: dark casing, luminous nose and a tapered exhaust.
    bolt = Image.new('RGBA', (20, 10))
    pen = ImageDraw.Draw(bolt)
    pen.polygon([(0,4),(5,3),(3,1),(8,2),(10,1),(15,1),(19,4),
                 (19,5),(15,8),(9,8),(6,7),(2,8),(4,5),(0,5)], fill=INK)
    pen.polygon([(2,4),(7,4),(5,2),(10,3),(10,6),(5,7),(7,5),(2,5)], fill='#ff5f99')
    pen.polygon([(9,3),(12,2),(15,2),(18,4),(18,5),(15,7),(11,7),(9,6)], fill='#ff4086')
    pen.rectangle((11,3,15,5), fill='#fff2ec')
    pen.line((15,3,17,4), fill='#ffffff')
    pen.line((9,6,14,6), fill='#ffaecd')
    bolt.save(ASSETS/'laser-bolt.png')

def main():
    sheet=Image.new('RGBA',(240,200))
    for row in range(8):
        for i in range(10 if row>=4 else 8):
            sheet.paste(courier(('down','left','up','right')[row%4],i,row>=4),(24*i,25*row))
    sheet.save(CHARS/'char-ember.png')
    alternate(sheet, {'30657b':'795392','154454':'443459','75bdd2':'b999d3',
                      'ec624d':'4dc4b1','ffac62':'a8f3d5'}).save(CHARS/'char-ember-alt.png')
    green=Image.open(CHARS/'char-green.png').convert('RGBA')
    alternate(green, {'107b29':'3b5797','41a429':'648bc1','0d420d':'243458'}).save(CHARS/'char-green-alt.png')
    for name,art in [('green',green),('ember',sheet)]:
        art.crop((0,0,24,25)).save(ASSETS/f'avatar-{name}.png')
    pickups()

if __name__=='__main__':
    main()
