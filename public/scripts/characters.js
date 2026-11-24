// One catalog supplies the signup picker, session validation and match artwork.
const Characters = (() => {
  const names = Object.freeze({
    green: 'Green Ranger', ember: 'Ember Courier', fox: 'Fox', cat: 'Cat',
    frog: 'Frog', owl: 'Owl', bunny: 'Bunny', bear: 'Bear', panda: 'Panda', penguin: 'Penguin'
  });
  const defaultId = 'green';
  const idFor = value => Object.hasOwn(names, value) ? value : defaultId;
  const sheet = (id, alternate = false) => {
    const suffix = alternate ? '-alt.png' : '.png';
    return '/assets/characters/char-' + idFor(id) + suffix;
  };
  function matchSheet(players, index) {
    const id = idFor(players[index].avatar);
    return sheet(id, index === 1 && idFor(players[0].avatar) === id);
  }
  function icon(value) {
    const id = idFor(value);
    return '/assets/avatar-' + id + (id === 'green' || id === 'ember' ? '.png' : '.svg');
  }
  return { names, defaultId, idFor, sheet, matchSheet, icon };
})();
if (typeof module !== 'undefined') module.exports = Characters;
