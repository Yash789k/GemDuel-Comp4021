// Adapted from lab3_gem_rush/sprite.js; rendering only, collisions now live on the server.
// This function defines a Sprite module.
// - `ctx` - A canvas context for drawing
// - `x` - The initial x position of the sprite
// - `y` - The initial y position of the sprite
const Sprite = function(ctx, x, y) {

    // This is the image object for the sprite sheet.
    const sheet = new Image();

    // This is an object containing the sprite sequence information used by the sprite containing:
    // - `x` - The starting x position of the sprite sequence in the sprite sheet
    // - `y` - The starting y position of the sprite sequence in the sprite sheet
    // - `width` - The width of each sprite image
    // - `height` - The height of each sprite image
    // - `count` - The total number of sprite images in the sequence
    // - `timing` - The timing for each sprite image
    // - `loop` - `true` if the sprite sequence is looped
    let sequence = { x: 0, y: 0, width: 20, height: 20, count: 1, timing: 0, loop: false };

    // This is the index indicating the current sprite image used in the sprite sequence.
    let index = 0;

    // This is the scaling factor for drawing the sprite.
    let scale = 1;

    // This is the scaling factor to determine the size of the shadow, relative to the scaled sprite image size.
    // - `x` - The x scaling factor
    // - `y` - The y scaling factor
    let shadowScale = { x: 1, y: 0.25 };

    // This is the updated time of the current sprite image.
    // It is used to determine the timing to switch to the next sprite image.
    let lastUpdate = null; //changed from 0

    // This function uses a new sprite sheet in the image object.
    // - `spriteSheet` - The source of the sprite sheet (URL)
    const useSheet = function(spriteSheet) {
        sheet.src = spriteSheet;
        return this;
    };

    // This function returns the readiness of the sprite sheet image.
    const isReady = function() {
        return sheet.complete && sheet.naturalHeight != 0;
    };

    // This function gets the current sprite position.
    const getXY = function() {
        return {x, y};
    };

    // This function sets the sprite position.
    // - `xvalue` - The new x position
    // - `yvalue` - The new y position
    const setXY = function(xvalue, yvalue) {
        [x, y] = [xvalue, yvalue];
        return this;
    };

    // This function sets the sprite sequence.
    // - `newSequence` - The new sprite sequence to be used by the sprite
    const setSequence = function(newSequence) {
        sequence = newSequence;
        index = 0; //changed from 0
        lastUpdate = null;
        return this;
    };

    // This function sets the scaling factor of the sprite.
    // - `value` - The new scaling factor
    const setScale = function(value) {
        scale = value;
        return this;
    };

    // This function sets the scaling factor of the sprite shadow.
    // - `value` - The new scaling factor as an object
    //   - `value.x` - The x scaling factor
    //   - `value.y` - The y scaling factor
    const setShadowScale = function(value) {
        shadowScale = value;
        return this;
    };

    // This function gets the display size of the sprite.
    const getDisplaySize = function() {
        /* Find the scaled width and height of the sprite */
        const scaledWidth  = sequence.width * scale;
        const scaledHeight = sequence.height * scale;
        return {width: scaledWidth, height: scaledHeight};
    };

    // This function draws shadow underneath the sprite.
    const drawShadow = function() {
        /* Save the settings */
        ctx.save();

        /* Get the display size of the sprite */
        const size = getDisplaySize();

        /* Find the scaled width and height of the shadow */
        const shadowWidth  = size.width * shadowScale.x;
        const shadowHeight = size.height * shadowScale.y;

        /* Draw a semi-transparent oval */
        ctx.fillStyle = "black";
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(x, y + size.height / 2,
                    shadowWidth / 2, shadowHeight / 2, 0, 0, 2 * Math.PI);
        ctx.fill();

        /* Restore saved settings */
        ctx.restore();
    };

    // This function draws the sprite.
    const drawSprite = function() {
        /* Save the settings */
        ctx.save();

        /* Get the display size of the sprite */
        const size = getDisplaySize();

 // draw the image
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet,
                      sequence.x + index * sequence.width, sequence.y,
                      sequence.width, sequence.height,
                      Math.round(x - size.width / 2), Math.round(y - size.height / 2),
                      size.width, size.height);


        /* Restore saved settings */
        ctx.restore();
    };
     
    // This function draws the shadow and the sprite.
    const draw = function() {
        if (isReady()) {
            drawShadow();
            drawSprite();
        }
        return this;
    };


    const update = function(time){//update the sprite
        if (lastUpdate === null) lastUpdate = time;

        if (sequence.timing > 0){//if the timing is greater than 0
            const frames = Math.floor((time - lastUpdate) / sequence.timing);
            if (frames > 0){//if the frames is greater than 0
                if (sequence.loop)
                    index = (index + frames) % sequence.count;
                else
                    index = Math.min(index + frames, sequence.count - 1);
                lastUpdate += frames * sequence.timing;
            }
        }

        return this;
    };

    // The methods are returned as an object here.
    return {
        useSheet: useSheet,
        getXY: getXY,
        setXY: setXY,
        setSequence: setSequence,
        setScale: setScale,
        setShadowScale: setShadowScale,
        getDisplaySize: getDisplaySize,
        isReady: isReady,
        draw: draw,
        update: update
    };
};
