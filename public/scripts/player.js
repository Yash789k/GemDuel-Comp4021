const Player = function (ctx, x, y, sheetUrl) {
  const sprite = Sprite(ctx, x, y);
  const sequences = {};
  const original = sheetUrl.includes('/char-green');

  for (const [row, facing] of ['Down', 'Left', 'Up', 'Right'].entries()) {
    const count = original ? (facing === 'Up' ? 1 : 3) : 8;

    sequences['idle' + facing] = {
      x: 0,
      y: row * 25,
      width: 24,
      height: 25,
      count,
      timing: original ? 800 : 250,
      loop: true,
    };

    sequences['move' + facing] = {
      x: 0,
      y: (row + 4) * 25,
      width: 24,
      height: 25,
      count: 10,
      timing: 50,
      loop: true,
    };
  }

  let animation = 'idleDown';

  sprite
    .setSequence(sequences[animation])
    .setScale(2)
    .setShadowScale({ x: 0.75, y: 0.2 })
    .useSheet(sheetUrl);

  function sync(player, scaleMultiplier = 1) {
    const next = (player.moving ? 'move' : 'idle') + player.facing;

    if (next !== animation) {
      sprite.setSequence(sequences[next]);
      animation = next;
    }

    sprite
      .setScale(2 * scaleMultiplier)
      .setXY(player.x, player.y + 14 - 25 * scaleMultiplier);
  }

  return {
    sync,
    draw: sprite.draw,
    update: sprite.update,
  };
};
