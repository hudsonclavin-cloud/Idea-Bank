// The lessons, in teaching order. Each has a program and its documented result,
// which aloft.test.mjs checks exactly. Classic script (window.AloftExamples) and CommonJS.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AloftExamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

  return [
    {
      id: 'one-ball',
      title: 'One ball',
      text: [
        'Aloft has no variables. A program is a loop of beats. On each beat the juggler catches whatever lands, does a little arithmetic, and throws it back up.',
        '`throw n + 1 up 1` throws the new value so that it lands one beat later, where `catch n` picks it up again. `balls 1` says what is already in the air when the program starts. `stop when` ends the run.',
      ],
      src: `# Count to five with one ball.
balls 1

catch n
  say n
  stop when n == 5
  throw n + 1 up 1
`,
      expect: { status: 'stopped', beats: 5, siteswap: '1', balls: 1, output: range(1, 5) },
    },
    {
      id: 'two-beats',
      title: 'Two beats',
      text: [
        'Two `catch` lines make a loop of two beats. They take turns, top to bottom, then round again.',
        'A name lasts only for the beat that catches it. The `n` on the second beat is a new catch of the same ball, one beat later. Try using `n` in a beat that doesn\'t catch it, and read the error.',
      ],
      src: `# Two beats take turns.
balls 1

catch n
  say "tick", n
  throw n up 1

catch n
  say "tock", n
  stop when n == 3
  throw n + 1 up 1
`,
      expect: {
        status: 'stopped', beats: 6, siteswap: '11', balls: 1,
        output: ['tick 1', 'tock 1', 'tick 2', 'tock 2', 'tick 3', 'tock 3'],
      },
    },
    {
      id: 'cascade',
      title: 'Higher throws hold more',
      text: [
        'A throw\'s height is how many beats the value stays in the air before you need it again. In a one-beat loop, `up 3` means three balls are always in flight and one lands every beat. Jugglers call it the cascade. Here three counters take turns without ever touching.',
        'The number of balls in the air is the average height of the throws: 3 / 1 beat = 3. The checker works that out before the program runs, so `balls` has to list three.',
      ],
      src: `# Three balls, each thrown up 3.
balls 100 200 300

catch x
  say x
  stop when x == 302
  throw x + 1 up 3
`,
      expect: {
        status: 'stopped', beats: 9, siteswap: '3', balls: 3,
        output: ['100', '200', '300', '101', '201', '301', '102', '202', '302'],
      },
    },
    {
      id: 'two-at-once',
      title: 'Catching two at once',
      text: [
        'When two balls land on the same beat, one hand catches both. They are caught in the order they were thrown, so `a` is the ball from the first `throw` line and `b` is the one from the second.',
        'This is Fibonacci with two balls. Throw the old `b` back up as the new `a`, and the sum as the new `b`.',
      ],
      src: `# Fibonacci with two balls.
balls 0 1

catch a b
  say a
  stop when a > 100
  throw b up 1
  throw a + b up 1
`,
      expect: {
        status: 'stopped', beats: 13, siteswap: '[11]', balls: 2,
        output: ['0', '1', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144'],
      },
    },
    {
      id: 'twice',
      title: 'Remembering twice costs a ball',
      text: [
        'Here each Fibonacci number is worked out once and thrown twice: up 1 to be added on the next beat, and up 2 to be added on the beat after. That takes three balls, (1 + 2) / 1, where the last lesson needed two.',
        'Memory in Aloft is the total time you keep values for, divided by the length of the loop. `let` names a value for the rest of one beat and keeps nothing.',
        'The `balls` line lists values in the order they land: on the first beat 1 and 0 (the two numbers before the start), then 0 again, the copy of the second, which lands one beat later.',
      ],
      src: `# Fibonacci, every number thrown twice.
balls 1 0 0

catch a b
  let f = a + b
  say f
  stop when f > 100
  throw f up 1
  throw f up 2
`,
      expect: {
        status: 'stopped', beats: 12, siteswap: '[12]', balls: 3,
        output: ['1', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '144'],
      },
    },
    {
      id: 'collatz',
      title: 'Choose the value, not the throw',
      text: [
        '`if … then … else …` chooses a value. A throw can never be skipped (the ball has to go up either way), so to branch you choose what the ball carries.',
        'This is the Collatz walk: halve an even number, triple an odd one and add 1. It starts from 7; try 27. A line break inside brackets is ignored, so a long expression can span lines.',
      ],
      src: `# Collatz, starting from 7.
balls 7

catch n
  say n
  stop when n == 1
  throw (if n % 2 == 0 then n / 2
         else 3 * n + 1) up 1
`,
      expect: {
        status: 'stopped', beats: 17, siteswap: '1', balls: 1,
        output: ['7', '22', '11', '34', '17', '52', '26', '13', '40', '20', '10', '5', '16', '8', '4', '2', '1'],
      },
    },
    {
      id: '531',
      title: 'Who goes where: 531',
      text: [
        'A three-beat loop with heights 5, 3 and 1 is the juggling trick called 531. It has three balls, because (5 + 3 + 1) / 3 = 3.',
        'Which ball does each beat catch? Each ball carries its name in its last digit and adds 10 every time it is thrown. One ball only ever gets the 3; the other two take turns at the 5 and the 1. The heights decide where every value goes.',
      ],
      src: `# 531, a three-ball juggling trick.
# Last digit: the ball's name.
balls 1 2 3

catch x
  say "ball", x % 10, "goes up 5"
  stop when x > 40
  throw x + 10 up 5

catch x
  say "ball", x % 10, "goes up 3"
  throw x + 10 up 3

catch x
  say "ball", x % 10, "goes up 1"
  throw x + 10 up 1
`,
      expect: {
        status: 'stopped', beats: 13, siteswap: '531', balls: 3,
        output: [
          'ball 1 goes up 5', 'ball 2 goes up 3', 'ball 3 goes up 1',
          'ball 3 goes up 5', 'ball 2 goes up 3', 'ball 1 goes up 1',
          'ball 1 goes up 5', 'ball 2 goes up 3', 'ball 3 goes up 1',
          'ball 3 goes up 5', 'ball 2 goes up 3', 'ball 1 goes up 1',
          'ball 1 goes up 5',
        ],
      },
    },
    {
      id: 'broken',
      title: 'Broken on purpose',
      text: [
        'This one doesn\'t run. Before a program starts, the checker works out where every throw lands: a throw on beat i of an n-beat loop, with height h, lands on beat (i + h) mod n. Here all three throws land on the first beat and nothing lands on the other two.',
        'Swap any two of the heights and it runs. That single test (every beat receives exactly the balls it catches) is the rule jugglers use to tell which patterns can be juggled at all. It is also Aloft\'s whole type system. A program that passes it can never reach for a ball that isn\'t there, and never has two balls land where it expects one.',
      ],
      src: `# Doesn't run yet. Read the error,
# then swap two of the heights.
balls 1 2

catch x
  say x
  stop when x > 6
  throw x + 1 up 3

catch x
  say x
  throw x + 1 up 2

catch x
  say x
  throw x + 1 up 1
`,
      expect: { error: { kind: 'check', line: 5, col: 1, includes: '3 balls land on this beat' } },
    },
    {
      id: 'window',
      title: 'A value you\'ll need later',
      text: [
        'The sum of the last three squares, kept up to date as `k` counts up. Each new square is needed twice: now, to add it, and three beats from now, to take it away when it leaves the window. So it is thrown up 3, and it comes down exactly when it is due. There is no array and no index. The delay is the address.',
        'At the start, three balls land together (`old`, `sum`, `k`), then two more `old`s, one per beat.',
      ],
      src: `# Sum of the last three squares.
# first beat: old, sum, k
balls 0 0 1
# then two more olds
balls 0 0

catch old sum k
  let sq = k * k
  let s = sum + sq - old
  say k, sq, s
  stop when k == 6
  throw sq up 3
  throw s up 1
  throw k + 1 up 1
`,
      expect: {
        status: 'stopped', beats: 6, siteswap: '[311]', balls: 5,
        output: ['1 1 1', '2 4 5', '3 9 14', '4 16 29', '5 25 50', '6 36 77'],
      },
    },
    {
      id: 'josephus',
      title: 'A circle of seven',
      text: [
        'Seven people stand in a circle and count round; every third one leaves. This is the Josephus problem. The circle is seven balls thrown up 7, so each person comes round once every seven beats.',
        'Two more balls go up 1 each beat: the count, and how many people are left. A person who has left becomes 0 and is skipped. Comparisons give 1 or 0, so `count + (p != 0)` adds one only for someone still in the circle.',
      ],
      src: `# Josephus: 7 in a circle, every
# third one leaves.
# person 1, count, people left:
balls 1 0 7
# the rest of the circle:
balls 2 3 4 5 6 7

catch p count left
  let c = count + (p != 0)
  let out = c == 3
  say p when out
  stop when out and left == 1
  throw if out then 0 else p up 7
  throw c % 3 up 1
  throw left - out up 1
`,
      expect: {
        status: 'stopped', beats: 46, siteswap: '[711]', balls: 9,
        output: ['3', '6', '2', '7', '5', '1', '4'],
      },
    },
    {
      id: 'fractran',
      title: 'Everything in one ball',
      text: [
        'One ball thrown up 1, forever, is enough for any computation, as long as the number on it can grow. This is Conway\'s FRACTRAN (1987): multiply n by the first fraction in a list that gives a whole number, and stop when none does.',
        'Start from 648 = 2³ × 3⁴. These six fractions multiply the exponents and end at 5¹² = 244140625. Change 648 to 2^a × 3^b to multiply other numbers.',
      ],
      src: `# FRACTRAN in one ball.
# 648 = 2^3 * 3^4; ends at 5^(3*4).
balls 648

catch n
  let next = (
    if n % 33 == 0 then n / 33 * 455
    else if n % 13 == 0 then n / 13 * 11
    else if n % 11 == 0 then n / 11
    else if n % 7 == 0 then n / 7 * 3
    else if n % 2 == 0 then n / 2 * 11
    else if n % 3 == 0 then n / 3
    else 0)
  say n when next == 0
  stop when next == 0
  throw next up 1
`,
      expect: { status: 'stopped', beats: 47, siteswap: '1', balls: 1, output: ['244140625'] },
    },
    {
      id: 'e',
      title: 'e, from fifteen balls',
      text: [
        'The finale: the digits of e after "2.", by a spigot algorithm (A. H. J. Sale, 1968). It uses e = 2 + 1/2(1 + 1/3(1 + 1/4(1 + …))).',
        'Twelve balls thrown up 12 form a ring of remainders, one for each term from 1/13 down to 1/2. Each pass round the ring multiplies them by 10 and carries from term to term, and the carry that falls out of the last term is the next digit. Three more balls go up 1: the carry, the term `i`, and a digit counter. That makes fifteen balls, (12 + 1 + 1 + 1) / 1, and nothing else in the program remembers anything.',
      ],
      src: `# Digits of e after "2.", by spigot.
# first beat: a, carry, i, digits
balls 1 0 13 0
# then the eleven other a's:
balls 1 1 1 1 1 1 1 1 1 1 1

catch a carry i digits
  let last = i == 2
  let x = a * 10 + carry
  say x / i when last
  stop when last and digits == 8
  throw x % i up 12
  throw if last then 0 else x / i up 1
  throw if last then 13 else i - 1 up 1
  throw digits + last up 1
`,
      expect: {
        status: 'stopped', beats: 108, siteswap: '[c111]', balls: 15,
        output: ['7', '1', '8', '2', '8', '1', '8', '2', '8'],
      },
    },
  ];
});
