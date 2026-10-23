/*
 * levels.js: the levels of Dividers, in the order they are played.
 *
 * Legend:  .  floor      #  pin (blocks landing and swinging)
 *          o  hole (blocks landing only)      *  mark to prick
 *          A  coral leg   B  blue leg (the two must start side by side)
 * Everything off the sheet counts as pinned.
 *
 * Levels 1-9 each teach one thing (see `hint`). Levels 10 onward are the
 * puzzles proper: every pin and hole in them is load-bearing, which the tests
 * check by removing each one and watching the par or the solution count change.
 *
 * Loads as a classic browser script (window.DividersLevels) and under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.DividersLevels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return [
    {
      name: 'Swing',
      hint: 'Tap a dot to swing a leg there. Each leg swings a quarter turn around the other.',
      rows: ['.....', '.....', '..AB.', '.**..', '.....'],
    },
    {
      name: 'Hop',
      hint: 'The mark sits right beside the blue leg, but blue can never land there. Send the far leg over.',
      rows: ['.....', '.....', '.AB*.', '.....', '.....'],
    },
    {
      name: 'Walk',
      hint: 'Alternate legs to walk. Swing the same leg twice to hop it over the other.',
      rows: ['......', '.....*', 'AB....', '......', '...*..'],
    },
    {
      name: 'Corner',
      hint: 'A swinging leg passes through the corner. A pin in that corner stops it.',
      rows: ['.....', '.AB..', '.*#..', '.....', '.....'],
    },
    {
      name: 'Hollow',
      hint: 'A hole stops a leg from landing, not from swinging. Swing over it.',
      rows: ['......', '..AB..', '.*o.*.', '......'],
    },
    {
      name: 'Gap',
      hint: 'A one-wide gap is a wall: there is no corner to swing through. Go round.',
      rows: ['...#..', 'AB..*.', '...#..', '......', '......'],
    },
    {
      name: 'Nook',
      hint: 'A mark in a nook can be reached if the cells beside it are holes, not pins.',
      rows: ['###o*o##', '........', '...AB...', '........'],
    },
    {
      name: 'Rosette',
      hint: 'Four marks round one square. Only one leg can ever stand on that square.',
      rows: ['.......', '...*...', '..*.*..', '...*...', '.......', '..AB...'],
    },
    {
      name: 'Stair',
      hint: 'Stepping stones: three squares in an L are enough to swing from, if the corner is a hole.',
      rows: ['*o...', '..o..', 'o..o.', '.o...', '..AB.'],
    },
    {
      name: 'Garden',
      hint: 'No new rules from here on. Par is the shortest dance the solver can find.',
      rows: ['.*#....', '...#...', '...*...', '...o...', '....o*.', '.......', '...AB..'],
    },
    {
      name: 'Islands',
      hint: 'Which leg takes which mark? Every hole here matters.',
      rows: ['..*....', '...o...', '.o..*..', '..o.o..', '.*.o...', '.......', '...AB..'],
    },
    {
      name: 'Meadow',
      hint: 'Four marks, two routes. One of them is par.',
      rows: ['..*...*..', '...#.....', '..o...o.o', '....AB...', '..*.#.*..'],
    },
    {
      name: 'Lily pads',
      hint: 'Marks between holes. Plan the whole dance before the first swing.',
      rows: ['*......', '...o...', '..*o*..', '..o.o..', '..*o*..', '.......', '..AB...'],
    },
    {
      name: 'Pond',
      hint: 'One route, twenty-six swings. The solver found exactly one way to do it in par.',
      rows: ['.......', '...oo..', '..*.*..', '..o.o..', '..*.*..', '...o...', '..AB..*'],
    },
    {
      name: 'Star chart',
      hint: 'Five marks, six holes, one par line. The last sheet.',
      rows: ['...o....', '..*.....', '.oo.o.*.', '...*....', '...o....', '.*....*.', '...o....', '...AB...'],
    },
  ];
});
