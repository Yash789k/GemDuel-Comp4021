const Sprite = function (ctx, x, y) {
  const sheet = new Image();

  let sequence = { x: 0, y: 0, width: 20, height: 20, count: 1, timing: 0, loop: false };
  let index = 0;
  let scale = 1;
  let shadowScale = { x: 1, y: 0.25 };
  let lastUpdate = null;

  const useSheet = function (spriteSheet) {
    sheet.src = spriteSheet;
    return this;
  };

  const isReady = function () {
    return sheet.complete && sheet.naturalHeight !== 0;
  };

  const setXY = function (xvalue, yvalue) {
    [x, y] = [xvalue, yvalue];
    return this;
  };

  const setSequence = function (newSequence) {
    sequence = newSequence;
    index = 0;
    lastUpdate = null;
    return this;
  };

  const setScale = function (value) {
    scale = value;
    return this;
  };

  const setShadowScale = function (value) {
    shadowScale = value;
    return this;
  };

  const getDisplaySize = function () {
    return {
      width: sequence.width * scale,
      height: sequence.height * scale,
    };
  };

  const drawShadow = function () {
    const size = getDisplaySize();
    const shadowWidth = size.width * shadowScale.x;
    const shadowHeight = size.height * shadowScale.y;

    ctx.save();
    ctx.fillStyle = 'black';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y + size.height / 2, shadowWidth / 2, shadowHeight / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawSprite = function () {
    const size = getDisplaySize();

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      sequence.x + index * sequence.width,
      sequence.y,
      sequence.width,
      sequence.height,
      Math.round(x - size.width / 2),
      Math.round(y - size.height / 2),
      size.width,
      size.height,
    );
    ctx.restore();
  };

  const draw = function () {
    if (isReady()) {
      drawShadow();
      drawSprite();
    }
    return this;
  };

  const update = function (time) {
    if (lastUpdate === null) lastUpdate = time;

    if (sequence.timing > 0) {
      const frames = Math.floor((time - lastUpdate) / sequence.timing);
      if (frames > 0) {
        if (sequence.loop) {
          index = (index + frames) % sequence.count;
        } else {
          index = Math.min(index + frames, sequence.count - 1);
        }
        lastUpdate += frames * sequence.timing;
      }
    }

    return this;
  };

  return { useSheet, setXY, setSequence, setScale, setShadowScale, draw, update };
};
