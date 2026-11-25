const Fire = function (ctx, x, y) {
  const sprite = Sprite(ctx, x, y);

  sprite
    .setSequence({ x: 0, y: 160, width: 16, height: 16, count: 8, timing: 100, loop: true })
    .setScale(2)
    .setShadowScale({ x: 0.75, y: 0.2 })
    .useSheet('/assets/object_sprites.png');

  return {
    setXY: sprite.setXY,
    update: sprite.update,
    draw: sprite.draw,
  };
};
