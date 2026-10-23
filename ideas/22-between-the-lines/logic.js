(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Between = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const scenes = [
    { id: 'quiet', label: 'A quiet reply', time: 'Tuesday, 18:42', message: 'You don’t have to come.', relationship: 'Someone you care about, before a small gathering.',
      contexts: [
        { name: 'Afraid of being a burden', color: '#d7a269', thought: 'I want you here. I don’t want you to feel obliged.', detail: 'An invitation can wear the clothes of permission when asking feels risky.' },
        { name: 'Needing a little space', color: '#8ba7a0', thought: 'I’m tired. Tonight might need to be smaller.', detail: 'Distance can be a need for rest, without being a judgment about closeness.' },
        { name: 'Hurt, but not ready', color: '#c77d77', thought: 'I hoped you would choose this without being asked.', detail: 'Disappointment sometimes arrives indirectly. This is one possible story, not a verdict.' }
      ], clue: 'There is no missing line that settles this. The person’s meaning is still theirs to tell you.',
      openers: ['I’d like to be there.', 'I’m not sure how to read this.'], asks: ['Would company feel good, or would you prefer a quiet night?', 'Do you mean there’s no pressure, or that you’d rather I didn’t?'], offers: ['Either answer is okay with me.', 'We can talk tomorrow if tonight is too much.'] },
    { id: 'later', label: 'A postponed call', time: 'Wednesday, 21:06', message: 'Can we talk later?', relationship: 'A friend, in the middle of an unfinished conversation.',
      contexts: [
        { name: 'Overwhelmed', color: '#8ba7a0', thought: 'There is too much happening for me to listen well.', detail: 'Postponing can be an attempt to offer more attention, rather than less.' },
        { name: 'Anxious about the subject', color: '#d7a269', thought: 'I need a moment to find words that won’t hurt us.', detail: 'Hesitation may come from care, fear, or both. A short text cannot separate them.' },
        { name: 'Simply interrupted', color: '#c77d77', thought: 'The doorbell just rang. This is about timing.', detail: 'Not every delay carries an emotional message. Ordinary interruptions also exist.' }
      ], clue: 'A pause tells you when someone cannot talk. It rarely tells you why.',
      openers: ['Yes, we can pause.', 'This matters to me, and I can wait.'], asks: ['Would tomorrow be a good time to return to it?', 'Would you like some space before we pick this up?'], offers: ['No need to explain right now.', 'Send a time that works when you can.'] },
    { id: 'fine', label: 'A small full stop', time: 'Friday, 12:18', message: 'It’s fine.', relationship: 'A sibling, after you changed a shared plan.',
      contexts: [
        { name: 'Actually fine', color: '#8ba7a0', thought: 'Plans change. I’ve already moved on to lunch.', detail: 'Sometimes the plain reading is a reasonable possibility too.' },
        { name: 'Disappointed', color: '#c77d77', thought: 'I was looking forward to this more than I said.', detail: 'A small response can conceal a larger feeling, but brevity alone proves nothing.' },
        { name: 'Trying to be generous', color: '#d7a269', thought: 'I’m a little sad, and I still want your day to work.', detail: 'Acceptance and disappointment can belong to the same person at the same time.' }
      ], clue: 'Your own guilt might make the punctuation feel louder. That is information about your reading, not their intent.',
      openers: ['I’m sorry for changing our plan.', 'I was looking forward to seeing you.'], asks: ['Would you like to find another day?', 'How has the change landed with you?'], offers: ['You don’t have to make it easy for me.', 'I can make the next plan if you’d like.'] },
    { id: 'good', label: 'Good news, quietly', time: 'Sunday, 09:31', message: 'I got it.', relationship: 'A friend, after waiting weeks for an important decision.',
      contexts: [
        { name: 'Relieved', color: '#8ba7a0', thought: 'I can finally let out the breath I was holding.', detail: 'Relief does not always sound like celebration. Sometimes it sounds like three words.' },
        { name: 'Excited, and a little scared', color: '#d7a269', thought: 'I wanted this. Now my life is about to change.', detail: 'Good news can open a door and create uncertainty at the same time.' },
        { name: 'Still absorbing it', color: '#c77d77', thought: 'It doesn’t feel real enough to explain yet.', detail: 'A person can know an outcome before knowing how they feel about it.' }
      ], clue: 'The outcome may be clear. The feeling does not have to be.',
      openers: ['That’s big news.', 'I’m glad you told me.'], asks: ['How are you feeling about it now?', 'Would you like to celebrate, or just let it settle?'], offers: ['There’s room for more than one feeling.', 'I’m here for the excited part and the uncertain part.'] }
  ];
  function initial(scene = 0) {
    if (!Number.isInteger(scene) || !scenes[scene]) throw new RangeError('Unknown scene');
    return { scene, lens: 0, held: [0], reply: [0,0,0], unfolded: false };
  }
  function reduce(state, action) {
    if (action.type === 'scene') return initial(action.value);
    if (action.type === 'reset') return initial(state.scene);
    if (action.type === 'lens') {
      if (!Number.isInteger(action.value) || action.value < 0 || action.value > 2) throw new RangeError('Unknown lens');
      return { ...state, lens: action.value };
    }
    if (action.type === 'hold') {
      const held = state.held.includes(state.lens) ? state.held.filter(n => n !== state.lens) : [...state.held, state.lens].sort();
      return { ...state, held };
    }
    if (action.type === 'reply') {
      if (!Number.isInteger(action.part) || action.part < 0 || action.part > 2 || ![0,1].includes(action.value)) throw new RangeError('Unknown reply part');
      return { ...state, reply: state.reply.map((n,i) => i === action.part ? action.value : n) };
    }
    if (action.type === 'unfold') return { ...state, unfolded: !state.unfolded };
    throw new Error('Unknown action');
  }
  function compose(state) {
    const scene = scenes[state.scene];
    return [scene.openers[state.reply[0]], scene.asks[state.reply[1]], scene.offers[state.reply[2]]].join(' ');
  }
  return { scenes, initial, reduce, compose };
});
