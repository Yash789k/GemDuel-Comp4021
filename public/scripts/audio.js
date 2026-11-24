// Audio objects and restart-on-event playback adapted from gem_rush.html.
const GameAudio = (() => {
  let muted = false, unlocked = false;
  try { muted = localStorage.getItem('gemrush-muted') === 'true'; } catch {}
  const sounds = Object.fromEntries(Object.entries({ background: 'background.mp3', collect: 'collect.mp3', fire: 'fire-hit.wav', power: 'power-up.wav', gameover: 'gameover.mp3',
    countdown: 'countdown.mp3', go: 'go.mp3', freeze: 'freeze.mp3', cheat: 'cheat.mp3', win: 'win.mp3' }).map(([key, file]) => [key, new Audio(`/assets/${file}`)]));
  sounds.background.loop = true; sounds.background.volume = .22;
  Object.values(sounds).forEach(sound => { sound.preload = 'auto'; sound.muted = muted; });
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
    sound.play().catch(() => {}); // Autoplay/audio failure never blocks the match.
  };
  const stop = () => { Object.values(sounds).forEach(s => { s.pause(); s.currentTime = 0; }); };
  return {
    play, stop,
    unlock() {
      if (unlocked) return;
      unlocked = true;
      // Called synchronously inside a gesture; unlock every reusable Audio object.
      Object.values(sounds).forEach(s => {
        s.muted = true;
        s.play().then(() => { s.pause(); s.currentTime = 0; s.muted = muted; }).catch(() => { s.muted = muted; });
      });
    },
    toggle() { muted = !muted; Object.values(sounds).forEach(s => { s.muted = muted; }); try { localStorage.setItem('gemrush-muted', String(muted)); } catch {} return muted; },
    isMuted: () => muted,
    onFailure(callback) { Object.values(sounds).forEach(s => s.addEventListener('error', callback, { once: true })); }
  };
})();
