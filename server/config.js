// All balancing and lifecycle defaults are here. Times are milliseconds.
module.exports = Object.freeze({
  width: 854, height: 480,
  bounds: { left: 60, right: 800, top: 165, bottom: 420 },
  radius: 17, speed: 180, target: 50, duration: 120000,
  step: 1000 / 30, countdown: 3000, loadTimeout: 15000,
  grace: 10000, resultRetention: 120000, inputTimeout: 600,
  gemLifetime: 6000, gemInterval: 650, maxGems: 12, initialGems: 8,
  powerInterval: 8000, powerLifetime: 10000, maxPowers: 2,
  bootsDuration: 5000, freezeDuration: 2000, stunDuration: 1000,
  growthDuration: 5000, laserLifetime: 1800, laserSpeed: 360,
  laserLockDuration: 1000, laserVisionDuration: 2000,
  fireCooldown: 1500, fireCount: 3,
  // Rising tension: one extra fire joins when 60 s and 30 s remain, and the
  // last 20 s are a Gem Frenzy where gems spawn twice as often.
  fireWaves: [60000, 30000], frenzyAt: 20000, frenzyInterval: 325,
  gemValues: { green: 1, red: 2, yellow: 3, purple: 5 }
});
