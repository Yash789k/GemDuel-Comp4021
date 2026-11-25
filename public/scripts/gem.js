const Gem = function (ctx, x, y, color) {
  const sequences = {
    green: { x: 192, y: 0, width: 16, height: 16, count: 4, timing: 200, loop: true },
    red: { x: 192, y: 16, width: 16, height: 16, count: 4, timing: 200, loop: true },
    yellow: { x: 192, y: 32, width: 16, height: 16, count: 4, timing: 200, loop: true },
    purple: { x: 192, y: 48, width: 16, height: 16, count: 4, timing: 200, loop: true },
  };

  const sprite = Sprite(ctx, x, y);

  sprite
    .setSequence(sequences[color])
    .setScale(2)
    .setShadowScale({ x: 0.75, y: 0.2 })
    .useSheet('/assets/object_sprites.png');

  return {
    update: sprite.update,
    draw: sprite.draw,
  };
};
