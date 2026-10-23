/* Generated copy of gears.json for the page (file:// cannot fetch JSON). The tests check that the two are identical. */
window.AK_GEARS = {
 "title": "Gearing of the Antikythera mechanism as modelled on this page",
 "reconstruction": "Lunar and Saros trains: Freeth et al. 2006. Metonic, Games and Callippic trains: Freeth et al. 2008. Planetary period relations: Freeth et al. 2021. Where these differ from earlier work (Price 1974; Wright 2002-2007) the later Freeth reconstruction is followed, because it is the only one that accounts for the 223-tooth gear e3, the pin-and-slot pair k1/k2 and the back-dial inscriptions together.",
 "evidence_key": {
  "ct": "The gear survives in the fragments and its tooth count is an estimate from the surviving teeth (radiographs from Price and Karakalos in the 1970s, linear tomography by Wright, and the 2005 microfocus CT used by Freeth et al. 2006). Most surviving gears are incomplete, so these counts are estimates, not tallies.",
  "inferred": "The gear survives but its tooth count cannot be read from it; the count used is the one the train needs.",
  "hypothetical": "No such gear survives. It was proposed to complete a train that the surviving dials require; its count is the one that train needs, and it may have been arranged differently."
 },
 "sources": {
  "Price1974": "D. de Solla Price, Gears from the Greeks: The Antikythera Mechanism, a Calendar Computer from ca. 80 B.C. Transactions of the American Philosophical Society 64(7), 1974.",
  "Wright": "M. T. Wright, series of papers 2002-2007 (e.g. 'Counting months and years: the upper back dial of the Antikythera mechanism', Bulletin of the Scientific Instrument Society 87, 2005; 'The Antikythera mechanism and the early history of the moon-phase display', Antiquarian Horology 29, 2006).",
  "F2006": "T. Freeth, Y. Bitsakis, X. Moussas, J. H. Seiradakis et al., Decoding the ancient Greek astronomical calculator known as the Antikythera Mechanism. Nature 444, 587-591 (2006), doi:10.1038/nature05357, with Supplementary Notes.",
  "F2008": "T. Freeth, A. Jones, J. M. Steele, Y. Bitsakis, Calendars with Olympiad display and eclipse prediction on the Antikythera Mechanism. Nature 454, 614-617 (2008), doi:10.1038/nature07130, with Supplementary Notes (amended 2011).",
  "F2021": "T. Freeth, D. Higgon, A. Dacanalis, L. MacDonald, M. Georgakopoulou, A. Wojcik, A Model of the Cosmos in the ancient Greek Antikythera Mechanism. Scientific Reports 11, 5821 (2021), doi:10.1038/s41598-021-84310-w.",
  "Tsigkros2015": "N. Tsigkros, Mathematical aspects of the Antikythera Mechanism, bachelor thesis, Freie Universitaet Berlin, 2015 (tabulates tooth counts, including Efstathiou's).",
  "Voulgaris2021": "A. Voulgaris, C. Mouratidis, A. Vossinakis, The Draconic gearing of the Antikythera Mechanism: assembling the Fragment D, its role and operation. Mediterranean Archaeology and Archaeometry (2022), arXiv:2104.06181 (lists the b1 counts of Karakalos, Price, Wright and Freeth et al.).",
  "Carman2012": "C. C. Carman, A. Thorndike, J. Evans, On the pin-and-slot device of the Antikythera mechanism, with a new application to the superior planets. Journal for the History of Astronomy 43, 93-116 (2012).",
  "Spinellis2008": "D. Spinellis, The Antikythera Mechanism: a computer science perspective. IEEE Computer 41(5), 22-27 (2008) (gives the Metonic train 64/38 x 53/96 x 15/53 = 5/19 and the Callippic reduction 15/60 x 12/60)."
 },
 "gears": [
  {
   "id": "a1",
   "teeth": 48,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "a",
   "role": "Crown (contrate) gear at the edge of b1; in Price's reconstruction, and most since, the input turned by the crank.",
   "count_note": "48 per Freeth et al. 2006 and later papers that use it. Whether the crank really drove a1 is itself an inference (Price 1974); Voulgaris et al. have argued for a different input.",
   "sources": [
    "F2006",
    "Price1974"
   ]
  },
  {
   "id": "b1",
   "teeth": 223,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "b",
   "role": "Main drive wheel, four spokes; one turn per year. Carries the mean Sun on the front.",
   "count_note": "Estimates of the present gear differ: Freeth et al. 2006 223-224, Price 225, Karakalos 223-226, Wright 216-231 (as tabulated by Voulgaris et al.). 223 is used here. b1's count changes only how many crank turns make a year, never any dial ratio.",
   "sources": [
    "F2006",
    "Price1974",
    "Voulgaris2021"
   ]
  },
  {
   "id": "b2",
   "teeth": 64,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "b",
   "role": "Fixed to b1; drives both the lunar train (c1) and the calendar/eclipse trains (l1).",
   "count_note": "64.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "c1",
   "teeth": 38,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "c",
   "role": "Lunar train.",
   "count_note": "38.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "c2",
   "teeth": 48,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "c",
   "role": "Lunar train.",
   "count_note": "48.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "d1",
   "teeth": 24,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "d",
   "role": "Lunar train.",
   "count_note": "24.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "d2",
   "teeth": 127,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "d",
   "role": "Lunar train. 127 is half of 254, the number of sidereal months in 19 years.",
   "count_note": "127; Price also counted 127.",
   "sources": [
    "F2006",
    "Price1974",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e2",
   "teeth": 32,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_moon",
   "role": "Lunar train; turns at the mean sidereal rate of the Moon (254/19 per year).",
   "count_note": "32.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e5",
   "teeth": 50,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_moon",
   "role": "Fixed to e2 on the e-axis; drives k1 on the turntable e3.",
   "count_note": "50.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "k1",
   "teeth": 50,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "k1",
   "role": "Epicyclic gear riding on e3; carries the pin.",
   "count_note": "50.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "k2",
   "teeth": 50,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "k2",
   "role": "Epicyclic gear riding on e3, on an axis about 1.1 mm from k1's; carries the slot that the pin drives.",
   "count_note": "50.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e6",
   "teeth": 50,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_out",
   "role": "Driven by k2; returns the varying lunar motion to the e-axis.",
   "count_note": "50.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e1",
   "teeth": 32,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_out",
   "role": "Fixed to e6; drives b3.",
   "count_note": "32.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "b3",
   "teeth": 32,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "b_moon",
   "role": "On a tube on the b-axis; carries the Moon pointer to the front.",
   "count_note": "32.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e3",
   "teeth": 223,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_platform",
   "role": "The turntable that carries k1 and k2; it turns with the Moon's line of apsides. 223 is the number of synodic months in a Saros.",
   "count_note": "223 per Freeth et al. 2006. With b1 (223 or 224) it is one of the two largest wheels.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "e4",
   "teeth": 188,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "e_platform",
   "role": "Fixed to e3; drives the Saros train.",
   "count_note": "188.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "f1",
   "teeth": 53,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "f",
   "role": "Saros train. Its 53 cancels the 53 of l2.",
   "count_note": "53.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "f2",
   "teeth": 30,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "f",
   "role": "Saros train.",
   "count_note": "30.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "g1",
   "teeth": 54,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "g",
   "role": "Carries the Saros pointer (lower back dial).",
   "count_note": "54.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "g2",
   "teeth": 20,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "g",
   "role": "Exeligmos train.",
   "count_note": "20.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "h1",
   "teeth": 60,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "h",
   "role": "Exeligmos train.",
   "count_note": "60.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "h2",
   "teeth": 15,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "h",
   "role": "Exeligmos train.",
   "count_note": "15.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "i1",
   "teeth": 60,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "i",
   "role": "Carries the Exeligmos pointer (subsidiary dial inside the Saros spiral).",
   "count_note": "60.",
   "sources": [
    "F2006",
    "F2008",
    "Tsigkros2015"
   ]
  },
  {
   "id": "l1",
   "teeth": 38,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "l",
   "role": "Calendar and eclipse trains.",
   "count_note": "38.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "l2",
   "teeth": 53,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "l",
   "role": "Calendar and eclipse trains. 53 is prime; it cancels against n1 (Metonic) and f1 (Saros).",
   "count_note": "53.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "m1",
   "teeth": 96,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "m",
   "role": "Calendar and eclipse trains.",
   "count_note": "96.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "m2",
   "teeth": 15,
   "evidence": "ct",
   "fragment": "A",
   "arbor": "m",
   "role": "Metonic train.",
   "count_note": "15.",
   "sources": [
    "F2006",
    "Tsigkros2015"
   ]
  },
  {
   "id": "m3",
   "teeth": 27,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "m",
   "role": "Drives the turntable e3 from the broken-off m shaft.",
   "count_note": "Proposed by Freeth et al. 2006. Given the surviving counts, 27 is the only whole number that makes the Saros dial turn 4 times in 223 lunar months (checked in the tests).",
   "sources": [
    "F2006"
   ]
  },
  {
   "id": "n1",
   "teeth": 53,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "n",
   "role": "Carries the Metonic pointer (upper back dial).",
   "count_note": "Hypothetical in Freeth et al. 2006 ('proposed previously') and kept in 2008. Given m2 = 15, 53 is the only whole number that gives 5 turns in 19 years.",
   "sources": [
    "F2006",
    "F2008",
    "Spinellis2008"
   ]
  },
  {
   "id": "n2",
   "teeth": 15,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "n",
   "role": "Callippic train.",
   "count_note": "Hypothetical in Freeth et al. 2006 ('proposed previously') and kept in 2008. Any reduction of 1/20 would do; 15/60 x 12/60 is the published choice.",
   "sources": [
    "F2006",
    "F2008",
    "Spinellis2008"
   ]
  },
  {
   "id": "p1",
   "teeth": 60,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "p",
   "role": "Callippic train.",
   "count_note": "As n2.",
   "sources": [
    "F2006",
    "F2008",
    "Spinellis2008"
   ]
  },
  {
   "id": "p2",
   "teeth": 12,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "p",
   "role": "Callippic train.",
   "count_note": "As n2.",
   "sources": [
    "F2006",
    "F2008",
    "Spinellis2008"
   ]
  },
  {
   "id": "q1",
   "teeth": 60,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "q",
   "role": "Carries the Callippic pointer (76-year subsidiary dial).",
   "count_note": "Freeth et al. 2008.",
   "sources": [
    "F2008"
   ]
  },
  {
   "id": "n3",
   "teeth": 57,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": "n",
   "role": "Drives the Games dial gear o1.",
   "count_note": "Freeth et al. 2008. With o1 = 60, 57 is the only whole number that turns the Games dial once in 4 years.",
   "sources": [
    "F2008"
   ]
  },
  {
   "id": "o1",
   "teeth": 60,
   "evidence": "ct",
   "fragment": "B",
   "arbor": "o",
   "role": "Under the Games (Olympiad) dial; the only gear in Fragment B.",
   "count_note": "60 (Efstathiou's count, as tabulated by Tsigkros 2015). Supplementary notes to the Freeth et al. papers describe it as severely cracked and worn, with about a third of its teeth in good condition; the 2008 notes identify it on the Games dial's axis.",
   "sources": [
    "F2008",
    "Tsigkros2015"
   ]
  },
  {
   "id": "ma1",
   "teeth": null,
   "evidence": "ct",
   "fragment": "C",
   "arbor": "phase",
   "role": "Small contrate gear of the Moon-phase display: turns the half-silvered phase ball at the rate of the Moon relative to the Sun.",
   "count_note": "Survives in Fragment C. I could not verify a tooth count, so none is used; the phase ball is modelled by its rate (Moon minus Sun), which does not depend on it.",
   "sources": [
    "Wright",
    "F2006"
   ]
  },
  {
   "id": "D63",
   "teeth": 63,
   "evidence": "ct",
   "fragment": "D",
   "arbor": null,
   "role": "The lone gear of Fragment D. Freeth et al. 2021 place it in their Venus train; Voulgaris et al. place it in a draconic (lunar node) train. Not used on this page.",
   "count_note": "63 (Freeth et al. 2021).",
   "sources": [
    "F2021",
    "Voulgaris2021"
   ]
  },
  {
   "id": "F51",
   "teeth": 51,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": null,
   "role": "Fixed gear shared by the Mercury and Venus trains in the 2021 model. Not drawn; the page drives the planets by their period relations.",
   "count_note": "Freeth et al. 2021.",
   "sources": [
    "F2021"
   ]
  },
  {
   "id": "F56",
   "teeth": 56,
   "evidence": "hypothetical",
   "fragment": null,
   "arbor": null,
   "role": "Fixed gear shared by the Mars, Jupiter, Saturn and true-Sun trains in the 2021 model. Not drawn; the page drives the planets by their period relations.",
   "count_note": "Freeth et al. 2021.",
   "sources": [
    "F2021"
   ]
  }
 ],
 "arbors": {
  "a": [
   "a1"
  ],
  "b": [
   "b1",
   "b2"
  ],
  "b_moon": [
   "b3"
  ],
  "c": [
   "c1",
   "c2"
  ],
  "d": [
   "d1",
   "d2"
  ],
  "e_moon": [
   "e2",
   "e5"
  ],
  "e_platform": [
   "e3",
   "e4"
  ],
  "e_out": [
   "e6",
   "e1"
  ],
  "k1": [
   "k1"
  ],
  "k2": [
   "k2"
  ],
  "f": [
   "f1",
   "f2"
  ],
  "g": [
   "g1",
   "g2"
  ],
  "h": [
   "h1",
   "h2"
  ],
  "i": [
   "i1"
  ],
  "l": [
   "l1",
   "l2"
  ],
  "m": [
   "m1",
   "m2",
   "m3"
  ],
  "n": [
   "n1",
   "n2",
   "n3"
  ],
  "o": [
   "o1"
  ],
  "p": [
   "p1",
   "p2"
  ],
  "q": [
   "q1"
  ]
 },
 "meshes": [
  [
   "a1",
   "b1"
  ],
  [
   "b2",
   "c1"
  ],
  [
   "c2",
   "d1"
  ],
  [
   "d2",
   "e2"
  ],
  [
   "e5",
   "k1"
  ],
  [
   "k2",
   "e6"
  ],
  [
   "e1",
   "b3"
  ],
  [
   "b2",
   "l1"
  ],
  [
   "l2",
   "m1"
  ],
  [
   "m3",
   "e3"
  ],
  [
   "e4",
   "f1"
  ],
  [
   "f2",
   "g1"
  ],
  [
   "g2",
   "h1"
  ],
  [
   "h2",
   "i1"
  ],
  [
   "m2",
   "n1"
  ],
  [
   "n2",
   "p1"
  ],
  [
   "p2",
   "q1"
  ],
  [
   "n3",
   "o1"
  ]
 ],
 "epicyclic": {
  "carrier": "e3",
  "riders": [
   "k1",
   "k2"
  ],
  "note": "k1 meshes with e5 and k2 with e6, both measured relative to the turning e3."
 },
 "pin_and_slot": {
  "offset_mm": 1.1,
  "pin_radius_mm": 9.6,
  "note": "The axes of k1 and k2 are about 1.1 mm apart (Freeth et al. 2006). The pin sits about 9.6 mm from k1's axis; the ratio 1.1/9.6 = 0.1146 is the figure later authors quote for the device. Both are measurements from CT of a corroded original, good to perhaps 5 per cent.",
  "sources": [
   "F2006",
   "Carman2012"
  ]
 },
 "trains": [
  {
   "id": "moon",
   "name": "Moon, mean motion",
   "meshes": [
    [
     "b2",
     "c1"
    ],
    [
     "c2",
     "d1"
    ],
    [
     "d2",
     "e2"
    ]
   ],
   "output": "e2",
   "relation": "254 sidereal months in 19 years: 235 synodic months plus the 19 laps the Sun makes",
   "expect": [
    254,
    19
   ]
  },
  {
   "id": "platform",
   "name": "Turntable e3 (line of apsides)",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m3",
     "e3"
    ]
   ],
   "output": "e3",
   "relation": "the Moon's mean motion minus its anomalistic motion, with 239 anomalistic months in 223 synodic months: 254/19 - (239/223)(235/19)",
   "expect": [
    477,
    4237
   ]
  },
  {
   "id": "metonic",
   "name": "Metonic pointer",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m2",
     "n1"
    ]
   ],
   "output": "n1",
   "relation": "235 synodic months in 19 years, laid out as 5 turns of 47 cells: 235 / (47 x 19)",
   "expect": [
    5,
    19
   ]
  },
  {
   "id": "callippic",
   "name": "Callippic pointer",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m2",
     "n1"
    ],
    [
     "n2",
     "p1"
    ],
    [
     "p2",
     "q1"
    ]
   ],
   "output": "q1",
   "relation": "one turn in 76 years, four Metonic cycles",
   "expect": [
    1,
    76
   ]
  },
  {
   "id": "games",
   "name": "Games (Olympiad) pointer",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m2",
     "n1"
    ],
    [
     "n3",
     "o1"
    ]
   ],
   "output": "o1",
   "relation": "one turn in 4 years",
   "expect": [
    1,
    4
   ]
  },
  {
   "id": "saros",
   "name": "Saros pointer",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m3",
     "e3"
    ],
    [
     "e4",
     "f1"
    ],
    [
     "f2",
     "g1"
    ]
   ],
   "output": "g1",
   "relation": "223 synodic months laid out as 4 turns: 4 x (235/19) / 223",
   "expect": [
    940,
    4237
   ]
  },
  {
   "id": "exeligmos",
   "name": "Exeligmos pointer",
   "meshes": [
    [
     "b2",
     "l1"
    ],
    [
     "l2",
     "m1"
    ],
    [
     "m3",
     "e3"
    ],
    [
     "e4",
     "f1"
    ],
    [
     "f2",
     "g1"
    ],
    [
     "g2",
     "h1"
    ],
    [
     "h2",
     "i1"
    ]
   ],
   "output": "i1",
   "relation": "one turn in 3 Saros cycles (669 synodic months): (235/19) / 669",
   "expect": [
    235,
    12711
   ]
  },
  {
   "id": "moon_out",
   "name": "Moon pointer, return path",
   "meshes": [
    [
     "e5",
     "k1"
    ],
    [
     "k2",
     "e6"
    ],
    [
     "e1",
     "b3"
    ]
   ],
   "output": "b3",
   "relation": "on average b3 turns exactly with e2 (50/50 x 50/50 x 32/32), so the pin and slot add a variation and nothing else",
   "expect": [
    1,
    1
   ]
  }
 ],
 "planets": [
  {
   "name": "Mercury",
   "synodic_cycles": 1513,
   "years": 480,
   "inner": true,
   "basis": "Derived by Freeth et al. 2021 (shares the factor 17 with Venus); not inscribed."
  },
  {
   "name": "Venus",
   "synodic_cycles": 289,
   "years": 462,
   "inner": true,
   "basis": "462 is read on the Front Cover Inscription; the relation (289, 462) is Freeth et al. 2021's reading."
  },
  {
   "name": "Mars",
   "synodic_cycles": 133,
   "years": 284,
   "inner": false,
   "basis": "Derived by Freeth et al. 2021 (shares the factor 7 with Saturn); not inscribed."
  },
  {
   "name": "Jupiter",
   "synodic_cycles": 315,
   "years": 344,
   "inner": false,
   "basis": "Derived by Freeth et al. 2021 (shares the factor 7 with Saturn); not inscribed."
  },
  {
   "name": "Saturn",
   "synodic_cycles": 427,
   "years": 442,
   "inner": false,
   "basis": "442 is read on the Front Cover Inscription; the relation (427, 442) is Freeth et al. 2021's reading."
  }
 ]
};
