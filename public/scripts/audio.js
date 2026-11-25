const GameAudio = (() => {
  let muted = false;
  let unlocked = false;

  try {
    muted = localStorage.getItem('gemrush-muted') === 'true';
  } catch {}

  const files = {
    background: 'background.mp3',
    collect: 'collect.mp3',
    fire: 'fire-hit.wav',
    power: 'power-up.wav',
    gameover: 'gameover.mp3',
    countdown: 'countdown.mp3',
    go: 'go.mp3',
    freeze: 'freeze.mp3',
    cheat: 'cheat.mp3',
    win: 'win.mp3',
  };

  const sounds = Object.fromEntries(
    Object.entries(files).map(([key, file]) => [key, new Audio(`/assets/${file}`)]),
  );

  sounds.background.loop = true;
  sounds.background.volume = 0.22;

  Object.values(sounds).forEach((sound) => {
    sound.preload = 'auto';
    sound.muted = muted;
  });

  const play = (name, volume = 1) => {
    if (muted || !unlocked) return;

    const sound = sounds[name];
    if (!sound) return;

    if (name === 'background') {
      if (!sound.paused) return;
    } else {
      sound.volume = volume;
      sound.currentTime = 0;
    }

    sound.play().catch(() => {});
  };

  const stop = () => {
    Object.values(sounds).forEach((sound) => {
      sound.pause();
      sound.currentTime = 0;
    });
  };

  return {
    play,
    stop,

    unlock() {
      if (unlocked) return;
      unlocked = true;

      Object.values(sounds).forEach((sound) => {
        sound.muted = true;
        sound
          .play()
          .then(() => {
            sound.pause();
            sound.currentTime = 0;
            sound.muted = muted;
          })
          .catch(() => {
            sound.muted = muted;
          });
      });
    },

    toggle() {
      muted = !muted;
      Object.values(sounds).forEach((sound) => {
        sound.muted = muted;
      });

      try {
        localStorage.setItem('gemrush-muted', String(muted));
      } catch {}

      return muted;
    },

    isMuted: () => muted,

    onFailure(callback) {
      Object.values(sounds).forEach((sound) => {
        sound.addEventListener('error', callback, { once: true });
      });
    },
  };
})();
