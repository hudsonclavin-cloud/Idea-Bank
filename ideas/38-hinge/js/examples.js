/* Hinge — built-in example cases. Loaded by the page (window.HingeExamples) and by the tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HingeExamples = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const startup = {
    key: 'startup',
    title: 'Take the startup offer, or stay?',
    unit: '$',
    goal: 'max',
    target: null,
    notes: 'Total money over the next four years. The offer is 140k plus 0.25% equity; my current job pays about 165k.',
    rows: [
      { id: 'r_years', name: 'years', kind: 'fixed', value: 4, note: 'horizon I am comparing over' },
      { id: 'r_stay', name: 'stay_comp', kind: 'range', lo: 160e3, hi: 175e3, shape: 'auto', note: 'per year if I stay; 165k now, raises uncertain' },
      { id: 'r_startup', name: 'startup_comp', kind: 'range', lo: 135e3, hi: 150e3, shape: 'auto', note: 'per year; the offer is 140k' },
      { id: 'r_equity', name: 'equity', kind: 'range', lo: 0.001, hi: 0.003, shape: 'auto', pct: true, note: 'my share at exit; 0.25% granted, dilution expected' },
      { id: 'r_survives', name: 'survives', kind: 'chance', p: 0.6, note: 'the company is still alive in four years' },
      { id: 'r_exit', name: 'exit_if_alive', kind: 'chance', p: 0.4, note: 'a liquidity event by then, if it is still alive (so 24% overall)' },
      { id: 'r_value', name: 'exit_value', kind: 'range', lo: 100e6, hi: 1e9, shape: 'auto', note: 'company value at that exit; pure guess' },
      { id: 'r_gap', name: 'gap_months', kind: 'range', lo: 1, hi: 4, shape: 'auto', note: 'months without pay if it folds' },
    ],
    options: [
      { id: 'o_stay', name: 'Stay', expr: 'stay_comp * years' },
      { id: 'o_go', name: 'Startup', expr: 'startup_comp * years - if(survives, 0, gap_months / 12 * startup_comp) + if(survives and exit_if_alive, equity * exit_value, 0)' },
    ],
  };

  const house = {
    key: 'house',
    title: 'Buy the place, or keep renting?',
    unit: '$',
    goal: 'min',
    target: null,
    notes: 'Net cost of housing over five years, including the return the down payment would have earned if invested instead.',
    rows: [
      { id: 'h_years', name: 'years', kind: 'fixed', value: 5, note: 'how long I would stay' },
      { id: 'h_price', name: 'price', kind: 'fixed', value: 450e3, note: 'the asking price' },
      { id: 'h_down', name: 'down_pct', kind: 'fixed', value: 0.2, pct: true, note: 'down payment' },
      { id: 'h_rate', name: 'rate', kind: 'fixed', value: 0.0625, pct: true, note: '30-year mortgage rate quoted this week' },
      { id: 'h_rent', name: 'rent', kind: 'fixed', value: 2200, note: 'my rent per month today' },
      { id: 'h_rentg', name: 'rent_growth', kind: 'range', lo: 0.02, hi: 0.05, shape: 'auto', pct: true, note: 'rent increase per year' },
      { id: 'h_appr', name: 'appreciation', kind: 'range', lo: -0.01, hi: 0.06, shape: 'auto', pct: true, note: 'house price change per year' },
      { id: 'h_mkt', name: 'market_return', kind: 'range', lo: 0.02, hi: 0.09, shape: 'auto', pct: true, note: 'what the down payment earns if invested instead' },
      { id: 'h_maint', name: 'maintenance', kind: 'range', lo: 0.005, hi: 0.02, shape: 'auto', pct: true, note: 'repairs per year, as a share of price' },
      { id: 'h_tax', name: 'taxes_insurance', kind: 'fixed', value: 6750, note: 'property tax and insurance per year' },
      { id: 'h_sell', name: 'selling_cost', kind: 'range', lo: 0.05, hi: 0.08, shape: 'auto', pct: true, note: 'agent fees and closing when I sell' },
      { id: 'h_buy', name: 'buying_cost', kind: 'fixed', value: 0.02, pct: true, note: 'closing costs when I buy' },
      { id: 'h_loan', name: 'loan', kind: 'formula', expr: 'price * (1 - down_pct)' },
      { id: 'h_r', name: 'r', kind: 'formula', expr: 'rate / 12', note: 'monthly rate' },
      { id: 'h_pay', name: 'payment', kind: 'formula', expr: 'loan * r / (1 - (1 + r)^(-360))', note: 'monthly mortgage payment' },
      { id: 'h_bal', name: 'balance', kind: 'formula', expr: 'loan * (1 + r)^(12 * years) - payment * ((1 + r)^(12 * years) - 1) / r', note: 'what I still owe when I sell' },
      { id: 'h_sale', name: 'sale', kind: 'formula', expr: 'price * (1 + appreciation)^years' },
      { id: 'h_up', name: 'upfront', kind: 'formula', expr: 'price * (down_pct + buying_cost)', note: 'cash tied up on day one' },
    ],
    options: [
      { id: 'o_buy', name: 'Buy', expr: 'upfront + (payment * 12 + maintenance * price + taxes_insurance) * years + upfront * ((1 + market_return)^years - 1) - (sale * (1 - selling_cost) - balance)' },
      { id: 'o_rent', name: 'Rent', expr: 'rent * 12 * ((1 + rent_growth)^years - 1) / rent_growth' },
    ],
  };

  const rewrite = {
    key: 'rewrite',
    title: 'How long will the rewrite take?',
    unit: 'weeks',
    goal: 'min',
    target: 12,
    notes: 'I promised twelve weeks. Calendar weeks for one person.',
    rows: [
      { id: 'w_feat', name: 'features', kind: 'range', lo: 8, hi: 14, shape: 'auto', note: 'we counted 10, but the list keeps growing' },
      { id: 'w_hours', name: 'hours_each', kind: 'range', lo: 6, hi: 20, shape: 'auto', note: 'honest hours per feature, tests included' },
      { id: 'w_rework', name: 'rework', kind: 'range', lo: 0.2, hi: 0.6, shape: 'auto', pct: true, note: 'share of the work redone after review' },
      { id: 'w_focus', name: 'focus_hours', kind: 'range', lo: 10, hi: 20, shape: 'auto', note: 'real focused hours per week' },
      { id: 'w_surp', name: 'surprises', kind: 'range', lo: 0, hi: 3, shape: 'uniform', note: 'weeks lost to things I cannot name yet' },
    ],
    options: [
      { id: 'o_weeks', name: 'Calendar weeks', expr: 'features * hours_each * (1 + rework) / focus_hours + surprises' },
    ],
  };

  const blank = {
    key: 'blank',
    title: 'Untitled decision',
    unit: '',
    goal: 'max',
    target: null,
    notes: '',
    rows: [{ id: 'b_a', name: 'a', kind: 'range', lo: 1, hi: 10, shape: 'auto', note: '' }],
    options: [{ id: 'b_o', name: 'Outcome', expr: 'a' }],
  };

  return [startup, house, rewrite, blank];
});
