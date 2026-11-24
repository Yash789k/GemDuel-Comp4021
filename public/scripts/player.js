// Adapted from lab3_gem_rush/player.js. Fixed-step movement is in server/game.js.
// This function defines the Player module.
// - `ctx` - A canvas context for drawing
// - `x` - The initial x position of the player
// - `y` - The initial y position of the player
// - `gameArea` - The bounding box of the game area
// - `sheetUrl` - The character sprite sheet chosen from the player's avatar
const Player = function(ctx, x, y, sheetUrl) {

    // This is the sprite sequences of the player facing different directions.
    // It contains the idling sprite sequences `idleLeft`, `idleUp`, `idleRight` and `idleDown`,
    // and the moving sprite sequences `moveLeft`, `moveUp`, `moveRight` and `moveDown`.
    // The character sheets keep the lab's 24x25 frames and row order. Idle rows
    // now have 8 looping frames (a small breathe and a blink every 2 seconds).
    const sequences = {
        /* Idling sprite sequences for facing different directions */
        idleLeft:  { x: 0, y: 25, width: 24, height: 25, count: 8, timing: 250, loop: true },
        idleUp:    { x: 0, y: 50, width: 24, height: 25, count: 8, timing: 250, loop: true },
        idleRight: { x: 0, y: 75, width: 24, height: 25, count: 8, timing: 250, loop: true },
        idleDown:  { x: 0, y:  0, width: 24, height: 25, count: 8, timing: 250, loop: true },

        /* Moving sprite sequences for facing different directions */
        moveLeft:  { x: 0, y: 125, width: 24, height: 25, count: 10, timing: 50, loop: true },
        moveUp:    { x: 0, y: 150, width: 24, height: 25, count: 10, timing: 50, loop: true },
        moveRight: { x: 0, y: 175, width: 24, height: 25, count: 10, timing: 50, loop: true },
        moveDown:  { x: 0, y: 100, width: 24, height: 25, count: 10, timing: 50, loop: true }
    };

    // This is the sprite object of the player created from the Sprite module.
    const sprite = Sprite(ctx, x, y);

    // The sprite object is configured for the player sprite here.
    sprite.setSequence(sequences.idleDown)
          .setScale(1.9)
          .setShadowScale({ x: 0.75, y: 0.20 })
          .useSheet(sheetUrl || "/assets/characters/char-fox.png");

    // Network state selects animation only when direction or motion changes.
    let animation = "idleDown";
    const sync = function(player) {
        const next = (player.moving ? "move" : "idle") + player.facing;
        if (next !== animation) {
            sprite.setSequence(sequences[next]);
            animation = next;
        }
        sprite.setXY(player.x, player.y - 10);
    };
    return { sync, draw: sprite.draw, update: sprite.update };
};
