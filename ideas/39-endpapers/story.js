// Endpapers — the passage graph. Plain data; the engine (engine.js) reads it.
// Loads as a classic <script> (defines STORY) and as CommonJS for the tests.
//
// Conventions: a passage is a page. `text` is a list of blocks; a plain string
// is a paragraph, {quote} is a thing written on paper, {hand} is a line in the
// register, {list: true} renders the register as it stands, {if, then, else}
// chooses blocks by state. Choice text may itself be conditional.
// Chapter heads live on the first passage of each chapter.

var STORY = {
  title: "Endpapers",
  start: "c1-kitchen",

  // Every variable the story can read, with its value before anyone has done anything.
  vars: {
    watched: "none",   // bird | book — what Ron kept his eyes on when the harrier came
    stayed: false,     // Ron stayed on the shingle for the evening
    entry: "none",     // none | query | tick — what Ron wrote in the register
    letter: "none",    // none | accepted | rejected — the committee's reply, kept in the book
    opened: false,     // Carol opened the book in 1989
    wrote: false,      // Carol wrote the woodpecker in the register
    fate: "none",      // charity | keep | skip — what Carol did with the book in 1989
    note: "book",      // book | carol — where Eileen's note is
    given: "none",     // 1989 | 2024 — when the book went to the hospice shop
    slip: "none",      // none | contact | name — what Carol tucked in the front in 2024
    phone: "none",     // look | photo — what Jas did when he first saw the egret
    looked: false,     // Jas wrote to the county recorder
    end: "none",       // which ending was reached
  },

  // The register in the back of the book, as the later hands find it.
  // Only firsts: a bird, a place, a date. Every one of Ron's dates is a Sunday;
  // Carol's one line (3 Feb 89, the funeral) is a Friday, and Chapter III says so.
  list: [
    { by: "ron", line: "Smew — Cliffe — 15 Jan 61" },
    { by: "ron", line: "Bearded Tit — Stodmarsh — 23 Apr 61" },
    { by: "ron", line: "Hoopoe — Sandwich Bay — 7 May 61" },
    { by: "ron", line: "Firecrest — Dungeness — 29 Oct 61" },
    { by: "ron", line: "Garganey — Stodmarsh — 18 Mar 62" },
    { by: "ron", line: "Pied Flycatcher — Dungeness — 30 Sep 62" },
    { by: "ron", line: "Waxwing — Hive Lane, the rowans by the Co-op — 27 Jan 63" },
    { by: "ron", line: "Snow Bunting — Dungeness — 3 Feb 63" },
    { by: "ron", line: "Black Tern — Cliffe — 16 Jun 63" },
    { by: "ron", line: "Ring Ouzel — Dungeness — 10 May 64" },
    { by: "ron", if: "entry=tick", line: ["Montagu’s Harrier, female — Dungeness — 10 May 64, 1.40 pm", { if: "stayed", text: " & 6.15 pm" }] },
    { by: "ron", if: "entry=query", line: ["Montagu’s Harrier (?) — Dungeness — 10 May 64, 1.40", { if: "stayed", text: " & 6.15" }, " pm. Ringtail, one."] },
    { by: "ron", line: "Spotted Crake — Stodmarsh — 19 Sep 65" },
    { by: "ron", line: "Avocet — Cliffe — 14 Apr 68" },
    { by: "ron", line: "Black Redstart — Northfleet, the works — 17 May 70" },
    { by: "ron", line: "Spoonbill — Cliffe — 11 Jun 72" },
    { by: "ron", line: "Osprey — Bough Beech — 10 Sep 72" },
    { by: "ron", line: "Rough-legged Buzzard — Sheppey — 19 Jan 75" },
    { by: "ron", line: "Golden Oriole — Lade — 29 May 77" },
    { by: "ron", line: "Purple Heron — Stodmarsh — 4 May 80" },
    { by: "ron", line: "Long-tailed Duck — Dungeness — 16 Jan 83" },
    { by: "ron", line: "Shore Lark — Sheppey — 20 Nov 83" },
    { by: "ron", line: "Red-necked Grebe — Dungeness — 5 Feb 84" },
    { by: "ron", line: "Mediterranean Gull — Cliffe — 15 Jun 86" },
    { by: "ron", line: "Great Grey Shrike — Sheppey — 27 Nov 88" },
    { by: "carol", if: "wrote", line: "Green Woodpecker. St Botolph’s, Northfleet. 3 Feb 89. At the funeral. C." },
  ],

  // The chain of hands, written the way an auction catalogue would write it.
  // Shown after an ending; every line is a function of the state.
  provenance: [
    { text: "Bought new, Christmas 1960, by Eileen Pettit of Northfleet, for her husband. Inscribed on the flyleaf." },
    { text: ["Ronald Pettit, Northfleet, 1960–1989. {ron_lines} lines in the endpapers, in pencil.",
             { if: "entry=tick", text: " One Montagu’s harrier, written down as certain." },
             { if: "entry=query", text: " One Montagu’s harrier, with a question mark." },
             { if: "entry=none", text: " No harrier." },
             { if: "letter=accepted", text: " One letter from a committee, accepting it, kept at the plate." },
             { if: "letter=rejected", text: " One letter from a committee, declining it, kept at the plate." },
             " One note from his wife, kept at the plate."] },
    { text: ["Carol Pettit, later Dunn, Northfleet, 1989",
             { if: "fate=keep", text: "–2024" },
             ".",
             { if: "not opened", text: " Did not open it." },
             { if: "wrote", text: " One line, in a rounder hand." },
             { if: "opened and fate!=keep", text: " Took the note." },
             { if: "fate=keep and end!=kept", text: " Kept it in a box through three lofts. Took the note in 2024." },
             { if: "fate=skip", text: " Left it on the chair." }] },
    { if: "fate=skip", text: "Bartlett's House Clearance, Northfleet, Monday 13 February 1989. The tip at Swanscombe. Landfill." },
    { if: "given=1989", text: "Hospice shop, the High Street, February 1989. Fifty pence." },
    { if: "given=1989", text: "D. Ashby, 1989–2024. One name in pencil. Nothing else known." },
    { if: "given=1989", text: "Hospice shop, the High Street, 2024. One pound fifty." },
    { if: "given=2024", text: ["Hospice shop, the High Street, March 2024. One pound fifty.",
             { if: "slip=contact", text: " With an envelope in the front: a phone number and a sentence." },
             { if: "slip=name", text: " With an envelope in the front: a name and two dates." }] },
    { if: "end=kept", text: ["Carol Dunn, Gravesend, 2024–. The shelf in the hall.", { if: "not wrote", text: " One line, thirty-five years late." }] },
    { if: "end=continue", text: "Jas Sandhu, Northfleet, 2024–. In his coat pocket. New lines, in capitals." },
    { if: "end=return", text: "Jas Sandhu, Northfleet, April–May 2024. Returned." },
    { if: "end=return", text: "Carol Dunn, Gravesend, 2024–." },
    { if: "end=dungeness", text: "Jas Sandhu, Northfleet, 2024–. One harrier, with a question mark." },
    { if: "end=shelf", text: "Jas Sandhu, Northfleet, 2024–. On the shelf above the bed, spine to the window." },
  ],

  passages: {

    // ───────────────────────── I. Ron ─────────────────────────

    "c1-kitchen": {
      head: { chapter: "I", who: "Ron", date: "Sunday 10 May 1964" },
      text: [
        "The wind went round to the south-east in the night. You know it before you are properly awake, because the chimney has stopped its moaning, and because the smoke from the works, which you can see from the bed if you lift your head, is leaning towards London instead of out over the river.",
        "Eileen is up, which at six is unlike her, but she is eight months gone and sleeps badly now and says so. She has cut the sandwiches: cheese and pickle, four rounds, in the greaseproof the loaf came in, and the flask, and she puts them on the table by your binoculars without a word, which is a word.",
        "‘Dungeness,’ you say, because it is better said than found out.",
        "‘Two o’clock. Mum’s coming at half past. I’m not sitting there telling her you’re looking at ducks.’",
        "‘Two.’",
        "‘Mind you are.’",
        "The Anglia starts the third time. Hive Lane is grey and empty and smells of the works, which it always does, which you only notice on the mornings you leave it. The Peterson is on the passenger seat: green cloth, her Christmas present to you in 1960. She wrote in the front of it. You write in the back, in pencil, small, as if it might need rubbing out: a bird, a place, a date, the first time only. Nine lines in three years. She calls it the register, and she is not being unkind, or not only.",
      ],
      choices: [
        { text: "Drive.", to: "c1-shingle" },
      ],
    },

    "c1-shingle": {
      text: [
        "Dungeness is not a place you arrive at. The road stops caring, and the houses thin to sheds, and the sheds thin to boats with their keels in the stones, and then there is the shingle, which goes on, pale as a beach that has forgotten the sea, to a skyline with two lighthouses on it and the new power station rising beside them in its scaffolding like a crate for something that has not been delivered.",
        "South-easterly, overcast, warm. It is the morning you have waited all spring for, and it does what those mornings do. Wheatears on every post. A whinchat. A tree pipit going over, calling. Two turtle doves purring in the broom by the Long Pits; a cuckoo; a ring ouzel on the open shingle by the old lighthouse, grey-scaled, with the white crescent, which goes in the register: your first, after eleven years. The warden says a wryneck was in the moat on Friday. You walk the moat twice and do not see it, and are not, you tell yourself, disappointed.",
        "At a quarter to one you sit with your back to a winch-house out of the wind and open the sandwiches. A piece of paper comes out with the first round, folded once, in her hand.",
        { quote: "Back by two. Mind you are. — E." },
        "You read it twice. You fold it along its fold and put it in the Peterson, in the plate of the harriers, because that is where the book falls open, and go on eating.",
        "At twenty to two a bird comes up the shingle from the south, low, slow, tilting. A harrier: a ringtail, brown, with the white rump, and your first thought is *hen harrier*, and your second is that it is the tenth of May, and your third is that it is too narrow, too light on the air; that it rows where a hen harrier would row and then it glides where a hen harrier would still be rowing.",
        "It is a hundred yards off and closing. You have perhaps thirty seconds.",
      ],
      choices: [
        { text: "Keep the glasses on it.", set: { watched: "bird" }, to: "c1-watch" },
        { text: "Get the book open.", set: { watched: "book" }, to: "c1-book" },
      ],
    },

    "c1-watch": {
      text: [
        "You do not look away. The glasses find it and hold it and it fills them, and you take it in as you would take in a face you will have to describe later to a policeman: the wings long and pointed and held up in a shallow V; four fingers at the tip, not five, you think, *you think*; the underwing barred, and across the secondaries a dark bar, a second bar, which the hen harrier does not have, which you have never in your life seen and have read about so often that you cannot be certain whether you are seeing it or only know where it ought to be.",
        "It crosses the track. It goes out over the Long Pits. It drops behind the broom and does not come up.",
        "You stand with your arms still raised for a while, like a man who has been asked to hold something.",
        "Then the book. The harrier plate, with her note lying across the Montagu’s like a strip of bandage. You read the text you know by heart. *Slimmer, longer-winged, more buoyant. Dark bar across secondaries.* The book agrees with you. The book is not a witness.",
        "Eight minutes to two. Northfleet is a hundred minutes away if the A2 is kind, and it is a Sunday, and it is never kind.",
      ],
      choices: [
        { text: "Go now. You’ll be late, but not by much.", set: { stayed: false }, to: "c1-home" },
        { text: "Stay. They come back along the shingle in the evening. They do.", set: { stayed: true }, to: "c1-stay" },
      ],
    },

    "c1-book": {
      text: [
        "Your hands know where the harriers are. The book opens at the plate and the note falls out of it into the stones and you let it lie; the painted females sit in their row, hen, Montagu’s, pallid, with the little arrows pointing at what you are meant to see: the five fingers and the four; the narrow wing; the bar across the secondaries.",
        "You look up.",
        "It is over the Long Pits already, going away, a brown shape against the brown of the broom, and then a speck, and then nothing. You had the bird for four seconds and the picture for twenty.",
        "You pick up the note, which has a damp corner now, and put it back in the plate, and stand there with the book open and nothing left to check it against.",
        "Eight minutes to two.",
      ],
      choices: [
        { text: "Go now. You’ll be late, but not by much.", set: { stayed: false }, to: "c1-home" },
        { text: "Stay. They come back along the shingle in the evening. They do.", set: { stayed: true }, to: "c1-stay" },
      ],
    },

    "c1-home": {
      text: [
        "You are home at twenty to four. Her mother’s coat is on the hook. You sit in the Anglia for a minute with the engine ticking and then go in by the back, as if that made it earlier.",
        "The table has been laid for three and cleared for two. Your plate is in the oven under another plate, and the gravy has got a skin, and Eileen, who is in the front room with her feet up on the pouffe and her mother opposite, says, ‘Yours is in the oven,’ pleasantly, which is the worst thing she could have said, and goes back to the pram catalogue.",
        "You eat it standing up at the stove. It is very good.",
        "At nine, when her mother has gone for the bus and the wireless is off and Eileen has gone up, you sit at the kitchen table with the Peterson and the pencil and turn to the back. The register. Nine lines, ten with the ouzel, in your small hand, going back to a smew at Cliffe in the January of ’61. The note is still in the harrier plate. You take it out and read it and put it in your waistcoat pocket, and then you take it out of there and put it back in the book, at the page, where it was.",
        { if: "watched=bird",
          then: "You know what you saw. You had it for thirty seconds in good glasses in flat light and it had the bar. You were alone. There is nobody who can say otherwise, and nobody who can say so.",
          else: "You saw a harrier and you saw a page. You have been doing this for eleven years and you know the difference, and the difference is that a page is never a hen harrier." },
      ],
      choices: [
        { if: "watched=bird", hand: true, text: "Montagu’s Harrier, female. Dungeness. 10 May 64, 1.40 pm.", set: { entry: "tick" }, to: "c1-tick" },
        { hand: true, text: "Montagu’s Harrier (?). Dungeness. 10 May 64, 1.40 pm. Ringtail, one.", set: { entry: "query" }, to: "c1-years" },
        { text: "Close the book. Write nothing.", set: { entry: "none" }, to: "c1-years" },
      ],
    },

    "c1-stay": {
      text: [
        "You stay.",
        "The afternoon goes grey and then gold. You walk the shingle to the point and back, and sit against the winch-house and eat the second round, and the note lies in the book on your knee. At four you think about the telephone box outside the Pilot and what you would say into it, and what she would say, and you do not go. At five a short-eared owl comes out and quarters the broom, which on any other day would have been the day.",
        "At a quarter past six it comes back.",
        { if: "watched=bird",
          then: "From the north this time, along the line of the pits, lower and slower and nearer, in the long light, and it is not a question. The bar on the secondaries is a bar. The wing is a Montagu’s wing. It turns once over the broom and shows you everything, and goes south over the road, and that is that. You have had it twice, in two lights, and you were not wrong.",
          else: "From the north this time, along the line of the pits, lower and nearer, in the long light, and this time you do not touch the book. You have the page in your head. Narrow wing. Four fingers. The bar. You look for the bar and you see a bar, and you will never, in the whole of your life, be certain whether you saw it or put it there. It goes south over the road." },
        "You are home at twenty past nine. The house is dark downstairs. Eileen is in bed with the light off and her back to the door, and she is not asleep, and she says nothing, and you say nothing, and you undress in the dark; and that is the conversation, and you will both remember it, and neither of you will ever mention it.",
        "You write it up at midnight at the kitchen table, in pencil, in the back, under the ouzel. First you take the note out of the harrier plate and read it. Then you put it back, at the page.",
      ],
      choices: [
        { hand: true, text: "Montagu’s Harrier, female. Dungeness. 10 May 64, 1.40 pm & 6.15 pm.", set: { entry: "tick" }, to: "c1-tick" },
        { hand: true, text: "Montagu’s Harrier (?). Dungeness. 10 May 64, 1.40 & 6.15 pm. Ringtail, one.", set: { entry: "query" }, to: "c1-years" },
      ],
    },

    "c1-tick": {
      text: [
        "There. It has a line. It is the first bird in the register with a time on it, because you wanted the time, you are not sure why; because a time is a kind of proof.",
        "You know the form. The Society has a sheet. A description, written at the time or as near as possible; date, hour, light, distance, optics; the observer’s previous experience of the species (none); the observer’s previous experience of the similar species (eleven years of hen harriers). You post it to the County Recorder in Maidstone, who hands it to a committee of four men you have never met, who decide, over the winter, whether it happened.",
        { if: "stayed and watched=bird",
          then: "You have thirty seconds and then a quarter of an hour, in two lights. You have the bar, twice. You have a description a committee would find hard to argue with, and no witness, and a wife.",
          else: [
            { if: "watched=bird",
              then: "You have thirty seconds and the bar, once, and no witness, and the description of a man who was watching the clock.",
              else: "You have a quarter of an hour of a bird you had been told what to look for in, and a picture, and no witness." },
          ] },
      ],
      choices: [
        { text: "Write it up on the sheet and post it in the morning.", to: [{ if: "stayed and watched=bird", id: "c1-reply-yes" }, { id: "c1-reply-no" }] },
        { text: "Leave it in the book. It happened.", to: "c1-years" },
      ],
    },

    "c1-reply-yes": {
      set: { letter: "accepted" },
      text: [
        "The letter comes in August, when Carol is nine weeks old and nobody in the house has slept. Typed, on the Society’s paper, from a man in Maidstone.",
        { quote: "Dear Mr Pettit, I am pleased to tell you that the Records Committee has accepted your record of a female Montagu’s Harrier at Dungeness on 10th May. It will appear in the Report for 1964. The Committee was impressed by the care of your description, and in particular by the second observation. Yours sincerely," },
        "You read it in the hall with the door open and the pram across the step. You do not say anything about it to Eileen, who would say, ‘Oh, well done,’ and mean it, and that would be worse than if she didn’t. You fold it in three and put it in the book, in the harrier plate, with her note.",
      ],
      choices: [
        { text: "The years after.", to: "c1-years" },
      ],
    },

    "c1-reply-no": {
      set: { letter: "rejected" },
      text: [
        "The letter comes in August, when Carol is nine weeks old and nobody in the house has slept. Typed, on the Society’s paper, from a man in Maidstone.",
        { quote: "Dear Mr Pettit, Thank you for your description of the harrier at Dungeness on 10th May. The Committee considered it carefully. I am afraid it felt that, on the evidence supplied, the bird could not be safely separated from a Hen Harrier, which has occurred at Dungeness in May. The record will be published as ‘harrier sp.’ I am sorry to send a disappointing reply, and hope you will not be put off submitting in future. Yours sincerely," },
        "*Not proven.* You read it in the hall with the door open and the pram across the step. Then you read it again, standing on the step. Four men in Maidstone, over a winter, with your sheet of paper and not the bird. You do not say anything about it to Eileen. You fold it in three and put it in the book, in the harrier plate, with her note, and you do not rub out the line.",
      ],
      choices: [
        { text: "The years after.", to: "c1-years" },
      ],
    },

    "c1-years": {
      text: [
        { if: "entry=query",
          then: "A question mark is a strange thing to put beside a bird. You have never put one in the register; the register is for things that happened. But a question mark is a thing that happened, too. You sharpen the pencil before you write it, so that the mark is small and clean, and then you look at it for a long time." },
        { if: "entry=none",
          then: "You close the book with the note in it, at the page. The page can keep it. There was a harrier on the shingle at twenty to two and you were there, and nobody needs to know which harrier, and nobody will, because the register is for things you are sure of, and you are sure of nothing except that you were late." },
        "Carol is born on the eleventh of June, at Gravesend, at four in the morning, and when they let you in to see her she is asleep with her fists up by her ears like a boxer.",
        "The register goes on. The first time only: a bird, a place, a date.",
        { list: true },
        "Eileen dies in the November of 1983, of the thing in her chest that she had not told you about until it was a thing; and after that you go on Sundays as before, and are back by one, and sit in the chair with the Radio Times. Carol comes for her dinner. She is in a building society in Gravesend. She does not ask about the birds, and you do not tell her, which has always been the arrangement, though neither of you made it.",
        "The last line is a great grey shrike on Sheppey, the twenty-seventh of November 1988. The pencil goes back in the spine. The book goes on the arm of the chair.",
      ],
      choices: [
        { text: "Chapter II.", to: "c2-box" },
      ],
    },

    // ───────────────────────── II. Carol ─────────────────────────

    "c2-box": {
      head: { chapter: "II", who: "Carol", date: "Saturday 11 February 1989" },
      text: [
        "The man from Bartlett’s is coming Monday with a van and two lads and will take, he says, everything that is left. Anything you want goes in the back bedroom with the door shut. Anything for the hospice shop goes in the bags he has given you. He will do the rest, and the rest is the house.",
        "You have done the kitchen. You have done the airing cupboard, which took a morning, because it was all her still, labelled in her writing: *double*, *single*, *good*. You have done his wardrobe without looking at it. Now the front room, and the chair, and on the arm of the chair, under the Radio Times for the week he died, the bird book.",
        "You know it the way you know the clock. Green cloth, the spine gone pale where the sun got at it, a brown mark on the edge of the pages that was there before you were. He took it out every Sunday of your life and brought it back and put it on the arm of the chair, and you never once opened it, because it was not yours to open; and because, if you are honest, which the house is making you, you did not want to know what was in it that was better than being in.",
        "It is four o’clock. There are three boxes to go.",
      ],
      choices: [
        { text: "Open it.", set: { opened: true }, to: "c2-open" },
        { text: "Put it in the hospice bag with the Reader’s Digests.", set: { fate: "charity", note: "book", given: "1989" }, to: "c2-bag" },
        { text: "Leave it on the chair for Monday.", set: { fate: "skip" }, to: "end-skip" },
      ],
    },

    "c2-open": {
      text: [
        "The front: *To Ron, Christmas 1960, with all my love, E.* Her writing before it went small.",
        "The back. The endpapers, both sides and onto the inside of the board, in pencil, in his hand, which was always one size, a size that would fit on a form. A list. A bird, a place, a date.",
        { list: true },
        "You read it standing up. Then you sit in his chair, which you have not done, and read it again, and it is not birds you are reading. It is Sundays. *Cliffe, 11 Jun 72* was your eighth birthday; there was a party, and he came in at one with his boots in his hand. *Stodmarsh, 4 May 80* was the week before your O-levels. *Sheppey, 20 Nov 83* was eleven days after the funeral. He went. Of course he went. You had not known that he had gone.",
        { if: "entry!=none", then: [
          "And this, a month before you were born, the only line in the list with a time on it:",
          { hand: ["Montagu’s Harrier", { if: "entry=query", text: " (?)" }, { if: "entry=tick", text: ", female" }, " — Dungeness — 10 May 64, 1.40", { if: "entry=tick and stayed", text: " pm" }, { if: "stayed", text: " & 6.15" }, " pm", { if: "entry=query", text: ". Ringtail, one." }] },
          { if: "stayed",
            then: "Twenty to two, and a quarter past six. He was there till a quarter past six.",
            else: "Twenty to two. He would have been home for his dinner, nearly." },
          { if: "entry=query", then: "And a question mark. He filled in forms for a living. He never put a question mark on anything in his life." },
        ] },
        "Something is in the middle of the book. You open it where it is thick: a plate of harriers, brown birds with pale undersides and white at the base of the tail, and lying across them a piece of greaseproof paper, folded once, gone soft as cloth.",
        { quote: "Back by two. Mind you are. — E." },
        "Mum.",
        { if: "entry!=none", then: [
          { if: "stayed",
            then: "You do not need to work out which day. The only line with a time on it, and the page it is keeping. She said two. He was on a beach at a quarter past six. And he kept this. He kept it for twenty-five years, at the page.",
            else: "You do not need to work out which day. The only line with a time on it, and the page it is keeping. She said two, and he wrote twenty to two; he would have made it, near enough. And he kept this. He kept it for twenty-five years, at the page." },
        ], else: "You do not know what day it was. There is nothing in the list for this page, no harrier at all. It is a page he marked and never wrote on, with her note across it for twenty-five years, keeping the place of nothing." },
        "You hold it a long time.",
      ],
      choices: [
        { text: "Go on.", to: "c2-found" },
      ],
    },

    "c2-found": {
      text: [
        { if: "letter=accepted",
          then: "There is a letter in the plate too, under the note: typed, on a society’s paper, from a man in Maidstone, dated August 1964. *Dear Mr Pettit, I am pleased to tell you that the Records Committee has accepted your record of a female Montagu’s Harrier at Dungeness on 10th May.* He never said. There was a committee in Maidstone that knew what he had seen, and you did not." },
        { if: "letter=rejected",
          then: "There is a letter in the plate too, under the note: typed, on a society’s paper, from a man in Maidstone, dated August 1964. *The Committee felt that, on the evidence supplied, the bird could not be safely separated from a Hen Harrier. The record will be published as ‘harrier sp.’ I am sorry to send a disappointing reply.* He kept it. He kept a letter telling him he was wrong, at the page, with her note, for twenty-five years; and the line in the back still says Montagu’s, and there is no question mark on it." },
        "At the funeral there was a bird. You were standing by the wall at St Botolph’s while they did the thing with the cords, and on the grass between the stones, twenty feet off, there was a green bird the size of a pigeon with a red cap, hopping, stabbing at the ground, and it laughed. It actually laughed: a loud, falling laugh. Then it flew off low and showed a yellow rump, and you thought, in the middle of everything, *Dad would know what that is.*",
        "You look it up. It takes you ten minutes, because you do not know how the book is arranged. Green Woodpecker. *Call a loud, laughing “yaffle”.*",
        "The pencil is in the spine where he kept it. The last line is *Sheppey, 27 Nov 88.* There is room underneath.",
      ],
      choices: [
        { hand: true, text: "Green Woodpecker. St Botolph’s, Northfleet. 3 Feb 89. At the funeral. C.", set: { wrote: true }, to: "c2-decide" },
        { text: "Put the pencil back.", set: { wrote: false }, to: "c2-decide" },
      ],
    },

    "c2-decide": {
      text: [
        { if: "wrote",
          then: "It looks wrong under his lines: rounder, bigger, a size that would not fit on a form. It looks as if someone has got into the register. You leave it.",
          else: "You leave the space. It is his. You were never in it, and you are not going to start now, at the end, with a woodpecker." },
        "It is dark outside. Bartlett’s at nine on Monday; the hospice shop opens at two. The back bedroom has one cardboard box in it, with her rings and his watch and the clock and a photograph, and that is everything, so far, that you have decided to carry out of this house.",
      ],
      choices: [
        { text: "The back bedroom. Keep it.", set: { fate: "keep" }, to: "c2-keep" },
        { text: "The hospice bag.", set: { fate: "charity", note: "carol", given: "1989" }, to: "c2-charity" },
        { text: "Leave it on the chair for Monday.", set: { fate: "skip", note: "carol" }, to: "end-skip" },
      ],
    },

    "c2-bag": {
      text: [
        "You put it in the bag between the Reader’s Digests and a Catherine Cookson, and the bag in the hall with the others. On Monday afternoon, when Bartlett’s have been and the house is a noise you can hear from the street, you carry the bags down the hill to the High Street, and the woman at the hospice shop says ‘Lovely,’ and puts them behind the counter, and you walk back up the hill with your hands empty.",
        "You do not open it. You never find out what was in the middle of it.",
        "It sells on the Thursday, for fifty pence, to somebody; and that somebody has it for thirty-five years, and writes their name in it once, and nothing else; and then they die too, as people do, and somebody clears their house, as you did, and the book comes back down the same hill to the same shop.",
      ],
      choices: [
        { text: "Chapter III.", to: "c3-foreshore" },
      ],
    },

    "c2-charity": {
      text: [
        "The note goes in your purse, behind your driving licence, where it still is.",
        "The book goes in the bag between the Reader’s Digests and a Catherine Cookson, and on Monday afternoon, when Bartlett’s have been and the house is a noise you can hear from the street, you carry the bags down the hill to the High Street, and the woman at the hospice shop says ‘Lovely,’ and puts them behind the counter, and you walk back up the hill with your hands empty.",
        "It sells on the Thursday, for fifty pence, to somebody; and that somebody has it for thirty-five years, and writes their name in it once, and nothing else; and then they die too, as people do, and somebody clears their house, as you did, and the book comes back down the same hill to the same shop.",
      ],
      choices: [
        { text: "Chapter III.", to: "c3-foreshore" },
      ],
    },

    "c2-keep": {
      text: [
        "You take it to the back bedroom with the note still in it, at its page, and put it in the box with her rings and his watch and the clock, and shut the door on it.",
        "The box goes with you. It goes to the flat in Perry Street, and then the house in Perry Street, and then the house at Shorne, and in each of them it goes in the loft, and you do not open it, because the once was enough and you have been afraid of the twice.",
      ],
      choices: [
        { text: "Interleaf.", to: "c2b-loft" },
      ],
    },

    "c2b-loft": {
      head: { chapter: "Interleaf", who: "Carol", date: "Sunday 10 March 2024" },
      text: [
        "The house at Shorne is sold. The flat has no loft, and Mick’s knees have made the decision about what goes up a ladder from now on, which is nothing.",
        "You are fifty-nine. You open the box on the landing, because you cannot kneel in a loft any more either. Her rings, which you wear. His watch, which stopped. The clock went to your daughter, who has it in a kitchen in Leeds. A photograph. And the book: green, pale on the spine, with the mark, and the note still in it at the harriers.",
        { quote: "Back by two. Mind you are. — E." },
        { if: "wrote",
          then: "You open it at the back. His list. And under it, in a hand you do not at first recognise as yours, round, a girl’s hand: *Green Woodpecker. St Botolph’s, Northfleet. 3 Feb 89. At the funeral. C.* You were twenty-four. You thought you were old.",
          else: "You open it at the back. His list, ending at Sheppey, November ’88, and under it the space you left for him, which he did not use, having died." },
        "Nobody in the flat will want this. Your daughter does not know a sparrow from a brick and has said so. It is a book of birds from before the motorway, with a dead man’s Sundays in the back of it, and it is the most himself of anything he left, and that is exactly what is wrong with keeping it. It does nothing in a box. It is a book. It wants hands.",
        "The hospice shop is still on the High Street. You have a biro and the back of an envelope.",
      ],
      choices: [
        { text: "Write your mobile number, and *This was my father’s. Ring me and tell me what you see.* Tuck it in the front.", set: { slip: "contact" }, to: "c2b-shop" },
        { text: "Write *R. Pettit, Northfleet, 1960–1989. Please don’t throw this away.* Tuck it in the front.", set: { slip: "name" }, to: "c2b-shop" },
        { text: "Give it as it is. Let it be a book.", set: { slip: "none" }, to: "c2b-shop" },
        { text: "Put it back in the box. It goes to the flat.", to: "end-kept" },
      ],
    },

    "c2b-shop": {
      set: { given: "2024", note: "carol" },
      text: [
        "The note comes out first and goes in your purse, behind your licence. You are not giving them that.",
        { if: "wrote", then: "You think about rubbing out the woodpecker, and don’t." },
        "The girl in the hospice shop has a lanyard and is nineteen and says ‘Lovely,’ because they are trained to, and puts it on the trolley. It is on the shelf by Thursday at one pound fifty, between a book about the Kent coalfield and a Bill Oddie.",
      ],
      choices: [
        { text: "Chapter III.", to: "c3-foreshore" },
      ],
    },

    // ───────────────────────── III. Jas ─────────────────────────

    "c3-foreshore": {
      head: { chapter: "III", who: "Jas", date: "April 2024" },
      text: [
        "The shift ends at six and the car park empties in four minutes, which you have timed, and then there is the question of what to do with a body that has been awake all night in a building the size of a village, moving other people’s parcels from one belt to another belt, and is now standing in the cold with its blood going the wrong way.",
        "Home is eleven minutes. Home is your old room, and the top bunk your brother used to be in, and your mum up at seven for the lunches, and the television through the floor, and lying with your eyes shut while the house gets on with its day. You tried that for a month.",
        "So instead you walk down through what used to be the works, where it is all fencing and Portakabins and a hoarding for a development with a picture on it of people who do not exist, to the river, and the path along the top of the wall. The tide is out most mornings at this hour, this fortnight. The mud goes out a hundred yards to the water and the water goes out a mile to Essex, where the sun is coming up behind the oil tanks.",
        "And there is a bird. It is there every morning, in the same creek in the mud: white, the size of a heron but not a heron, standing like a question mark over its own reflection, and sometimes it runs, three quick steps, and stabs, and comes up with something. Pure white. Black beak. You have no word for it. Nobody you know would have a word for it. It is fifty yards off, and the light is coming, and it has not seen you.",
      ],
      choices: [
        { text: "Stand still and look.", set: { phone: "look" }, to: "c3-shop" },
        { text: "Get the phone up.", set: { phone: "photo" }, to: "c3-shop" },
      ],
    },

    "c3-shop": {
      text: [
        { if: "phone=look",
          then: "You stand still for the longest time you have stood still since you cannot remember. It walks. It has yellow feet — yellow, bright, as if somebody has put socks on it — and when it lifts, which it does when the dog comes, it tucks its neck in and trails the yellow feet behind it and goes off up the river, low and slow and white against the mud, and you say, out loud, to nobody, ‘What *are* you.’",
          else: "The phone makes it a white mark on brown. You zoom and it is a white mark, bigger. You take nine pictures, and in the ninth it has gone, lifted, and you look up and it is going off up the river, low and white, with something trailing behind it — its feet? — and you say, out loud, to nobody, ‘What *are* you.’ At home you look at the nine pictures and they are nine white marks." },
        "The hospice shop is on the High Street between the vape shop and the one that is always closing down. You go in on the Thursday, because it is on the way to the chemist, and because it is the only place you can think of that would have a book about birds that is not a screen, and your eyes have had enough screen.",
        "There is a shelf. A Bill Oddie. A thing about the Kent coalfield. A thing with a puffin on it for children. And a green cloth book with no jacket and a pale spine, *A Field Guide to the Birds of Britain and Europe*, 1954, which is older than your dad. One pound fifty, in pencil, inside the cover.",
        { if: "given=1989",
          then: "Under the price, in an older pencil, *D. Ashby, Mar. 89*; and under that, in ink gone brown, in a woman’s hand: *To Ron, Christmas 1960, with all my love, E.*",
          else: "Under the price, in ink gone brown, in a woman’s hand: *To Ron, Christmas 1960, with all my love, E.*" },
        { if: "slip=contact", then: "An envelope falls out of the front, folded, with a mobile number on it in biro and, under the number: *This was my father’s. Ring me and tell me what you see.*" },
        { if: "slip=name", then: "An envelope falls out of the front, folded, in biro: *R. Pettit, Northfleet, 1960–1989. Please don’t throw this away.*" },
        "You find the bird in the shop, standing up, with the girl at the till watching you. Herons. There it is, painted: white, the yellow feet, two thin plumes off the back of the head. *Little Egret.* And under the name, in italics: *Vagrant. A few records.*",
        "A few records. You have had it every morning for a fortnight.",
      ],
      choices: [
        { text: "One pound fifty.", to: "c3-list" },
      ],
    },

    "c3-list": {
      text: [
        { if: "note=book", then: [
          "At home, in the room, with the blind down and the house going on underneath you, you go through it. The margins are clean; nobody wrote in the book itself. It falls open in one place, at a plate of brown hawks with white at the base of their tails, and lying across them is a piece of greaseproof paper, folded once, soft as cloth, with six words on it in the hand from the front.",
          { quote: "Back by two. Mind you are. — E." },
        ], else: "At home, in the room, with the blind down and the house going on underneath you, you go through it. The margins are clean; nobody wrote in the book itself. It falls open in one place, at a plate of brown hawks with white at the base of their tails, and across them is a mark where something lay for a long time: a rectangle a shade paler than the page, and nothing in it now." },
        { if: "letter=accepted",
          then: "There is a letter in the same plate, folded in three. Typed, on headed paper, August 1964. *Dear Mr Pettit, I am pleased to tell you that the Records Committee has accepted your record of a female Montagu’s Harrier at Dungeness on 10th May.* Somebody saw a bird, and wrote to a committee, and the committee said yes, and he kept the yes for the rest of his life at the page it was about." },
        { if: "letter=rejected",
          then: "There is a letter in the same plate, folded in three. Typed, on headed paper, August 1964. *The Committee felt that, on the evidence supplied, the bird could not be safely separated from a Hen Harrier. The record will be published as ‘harrier sp.’ I am sorry to send a disappointing reply.* Somebody kept a letter telling them they were wrong, for sixty years, at the page they were wrong about." },
        "Then the back. The endpapers, both sides and onto the board, in pencil, a list.",
        { list: true },
        { if: "entry!=none", then: [
          ["*Montagu’s Harrier. Dungeness, 10 May 64.* ",
           { if: "entry=query", text: "And a question mark. " },
           "The only harrier in the list, and the only line with a time on it; so that is the page, you work out, that is what was lying in the plate. You look up Montagu’s harrier on your phone in the end, because the book cannot tell you what has happened since the book. It bred in Britain then: a few pairs, in Norfolk, in the West Country. It has not bred in Britain since 2019."],
          { if: "entry=query", then: "He put a question mark. Whoever he was, he was not sure, and wrote it down anyway, and wrote down that he was not sure. You have never in your life seen anybody do that." },
          { if: "entry=tick and stayed", then: "Twenty to two, and a quarter past six. He waited for it. He waited four and a half hours on a beach for a bird to come back, and it came back." },
        ], else: [
          { if: "note=book",
            then: "There is no harrier in the list. The page her note was keeping is a page he never wrote about.",
            else: "There is no harrier in the list. The page with the pale mark on it is a page he never wrote about." },
        ] },
        { if: "wrote", then: "And under the last of his, in a different pencil, in a rounder hand: *Green Woodpecker. St Botolph’s, Northfleet. 3 Feb 89. At the funeral. C.* You know St Botolph’s; it is the church on the hill above the old works. You went to a wedding there. 1989. You were not born." },
        ["The list is dates, and every one ",
         { if: "wrote", text: "of his " },
         "is a Sunday; you check, on your phone, and it takes a while. Twenty-eight years of Sundays",
         { if: "wrote", text: ", and then one Friday, in the round hand, which was a funeral" },
         ". The places are all places you could get to from here: Cliffe, Sheppey, Dungeness, the marsh at Stodmarsh; his county; your county. Half the birds you have never heard of, and some of them, you find out, are gone, or going: the golden oriole he had at Lade in 1977 does not nest in England any more. And the egret, which was a vagrant, a few records, and which you have every morning in a creek below a hoarding."],
        ["The society is still going. Its website has an address for the Recorder. You could write and ask what the county had at Dungeness on the tenth of May 1964. ",
         { if: "entry=tick", text: "Whether he was right." },
         { if: "entry=query", text: "Whether anybody else saw it." },
         { if: "entry=none", text: "What else was there that day." }],
      ],
      choices: [
        { text: "Write to the Recorder.", set: { looked: true }, to: "c3-report" },
        { text: "Leave it as the book says.", to: "c3-choose" },
      ],
    },

    "c3-report": {
      text: [
        "The reply comes nine days later, from a man who signs himself the Honorary Recorder, who says the 1964 report is in a box in his garage and he has had a look. Attached is a photograph of a page, taken on a phone, a bit skewed, with his thumb in the corner.",
        { if: "letter=accepted", then: [
          { quote: "MONTAGU’S HARRIER. Dungeness, 10th May, a female (R. Pettit). The only record of the year." },
          "That is all of it. Thirteen words in a county report in a box in a garage, and his name, and it was true.",
        ] },
        { if: "letter=rejected", then: [
          { quote: "HARRIER SP. Dungeness, 10th May, one ‘ringtail’, not specifically identified (R.P.)." },
          "His initials and no bird. They took the bird off him and left him the initials. And in the back of the book, in his own pencil, it still says Montagu’s, and there is no question mark on it, and now you have both.",
        ] },
        { if: "letter=none and entry!=none", then: [
          { quote: "MONTAGU’S HARRIER. No records." },
          { if: "entry=query",
            then: "Nothing at Dungeness on the tenth of May. Whatever he saw, he kept: a question mark in a book that he never sent anywhere.",
            else: "Nothing at Dungeness on the tenth of May. Whatever he saw, he kept: a tick in a book that he never sent anywhere, which is a different thing from a lie, you think, though you could not say exactly how." },
        ] },
        { if: "entry=none", then: [
          { quote: "RING OUZEL. Dungeness, 10th May, one (per Obs.)." },
          ["An ouzel. The same ouzel that is in his list, from the Observatory’s log, without his name. Nothing else that day. Whatever lay in the hawk plate ",
           { if: "note=carol and given=1989", text: "all those years", else: "for sixty years" },
           ", there is no record of it anywhere, except that it lay there."],
        ] },
        "The Recorder adds, at the bottom: *Is this a relative? We’d be interested in the book, if it ever wants a home. Old lists are worth more than people think.*",
      ],
      choices: [
        { text: "Saturday.", to: "c3-choose" },
      ],
    },

    "c3-choose": {
      text: [
        ["It is Saturday. You have the book, and a bird with a name, and a list that stops in ",
         { if: "wrote", text: "1989", else: "1988" },
         ", and a page of hawks with ",
         { if: "note=book", text: "a dead man’s Sunday lying across it in his wife’s writing", else: ["a pale mark on it where something lay for ", { if: "given=1989", text: "a long time", else: "sixty years" }] },
         ". The tenth of May is a fortnight off.",
         { if: "slip=contact", text: " The number on the envelope is a mobile. It will work or it won’t." }],
        "What are you going to do with it.",
      ],
      choices: [
        { text: "Write the egret under the last line.", to: "end-continue" },
        { if: "slip=contact", text: "Ring the number.", to: "end-return" },
        { if: "entry!=none", text: "Go to Dungeness on the tenth.", to: "end-dungeness" },
        { text: "Put it on the shelf. It’s a book.", to: "end-shelf" },
      ],
    },

    // ───────────────────────── Endings ─────────────────────────

    "end-skip": {
      ending: "Monday",
      set: { end: "skip" },
      text: [
        { if: "opened",
          then: "The note goes in your purse, behind your driving licence, where it still is. The book goes back on the arm of the chair, with the Radio Times on top of it, the way he left it, and you shut the front-room door.",
          else: "You leave it on the arm of the chair, under the Radio Times, the way he left it, and you shut the front-room door." },
        "On Monday at nine Bartlett’s come with the van and two lads, and in forty minutes the house is a noise you can hear from the street, and then it is empty. The lad carries the chair out with the book still on the arm of it, and the book slides off at the gate, and he picks it up and puts it on the seat and goes on. The chair goes to a saleroom in Dartford. The book does not. It goes with the Reader’s Digests and the curtains and the lino to the tip at Swanscombe, and from there, in time, to landfill, which is a field with a fence round it.",
        { if: "opened",
          then: "You kept the note. Of all the things in that house, the thing you carried out in your hand was six words on greaseproof paper. You could not have said why, then. You can now.",
          else: "Nobody reads the note again." },
        ["Thirty-five years later you are in a flat by the river with a view of Essex, and you have been to Dungeness once, with Mick, for the fish, and stood on the shingle in the wind and thought: he came here. ", { if: "opened", text: "You remember some of the list. A snow bunting. A firecrest. A long-tailed duck. All of them Sundays.", else: "You do not know what he saw." }],
      ],
    },

    "end-kept": {
      ending: "The flat",
      set: { end: "kept" },
      text: [
        "It goes to the flat. It goes on the shelf in the hall between the road atlas and the directory nobody has opened since 2009, where you can see the spine from the kitchen.",
        { if: "wrote",
          then: "You do not open it again for a year. When you do, it is to show your daughter, at Christmas, your line under his: the woodpecker, the church, the funeral, *C.* She says, ‘That’s your writing?’ and you say it was, once.",
          else: "One evening in the winter you take it down, and the pencil is still in the spine, a stub, and you sharpen it with the potato knife and write, under *Sheppey, 27 Nov 88*, thirty-five years late: *Green Woodpecker. St Botolph’s, Northfleet. 3 Feb 89. At the funeral. C.* It looks wrong under his lines. It looks as if someone has got into the register. You leave it." },
        "You go to Dungeness in the spring, with Mick, for the fish, and stand on the shingle in a wind that comes straight off the sea, with the book in your coat, and do not take it out. A big brown bird goes along the back of the beach, slow, tilting. You have no idea what it is. He would have. You watch it till it has gone, and that, it turns out, is the whole of the thing he did on Sundays, and it is enough.",
      ],
    },

    "end-continue": {
      ending: "The next line",
      set: { end: "continue" },
      text: [
        ["There is a pencil in the spine, a stub, and you sharpen it with the kitchen knife, and under ",
         { if: "wrote", text: "the woodpecker", else: "*Sheppey, 27 Nov 88*" },
         " you write, in capitals, because your writing is bad:"],
        { hand: ["LITTLE EGRET. NORTHFLEET FORESHORE, BELOW THE OLD WORKS. 27 APR 24, 6.20 AM. ", { if: "phone=look", text: "YELLOW FEET.", else: "ONE." }] },
        "It looks wrong. It looks like a text message in a letter. You leave it.",
        "Then, because a line on its own looks like an accident, the next morning’s: a small brown bird on the mud that the book, after twenty minutes, says is a redshank. And the big one with the long beak, which is a curlew, which the book says is common, and which, when you look it up on your phone, has halved. And so on.",
        ["The list stops in November 1988 and starts again in April 2024, and in between is ",
         { if: "wrote", text: "one woodpecker and " },
         "nothing, which is how lists are. ",
         { if: "given=1989", text: "Somebody called D. Ashby had it thirty-five years and wrote nothing in it but their name, which is also a kind of entry. " },
         "The book goes in your coat pocket in the mornings now. It is the right size for a pocket. It was made to be."],
        ["You do not know who ", { if: "letter!=none or slip=name", text: "R. Pettit", else: "Ron" }, " was. You know what he saw, and where, and when, and the order he saw it in. It is more than you know about most people. It is more than you know about your dad."],
      ],
    },

    "end-return": {
      ending: "The river",
      set: { end: "return" },
      text: [
        "She is nearly sixty. Her name is Carol, and she says it the way people say a thing they are used to having to spell. You say you have got her father’s bird book, from the hospice shop, and there is a pause on the line that you will think about afterwards, and then she says, ‘Right. Well. What did you see?’",
        "She comes to the river on the Sunday, because you say that is where the bird is. She stands on the wall at twenty past six in a good coat with her hands in her pockets, and the egret is there, in its creek, and she looks at it for a long time, and says, ‘He’d have liked that,’ which, you are learning, is what people say.",
        { if: "wrote",
          then: "Then she opens the book at the back and finds her own line under his, the woodpecker, and puts her thumb on it, and leaves it there, and does not say anything about it, and nor do you.",
          else: "Then she opens the book at the back and looks at the space under his last line, which is still a space, and does not say anything about it, and nor do you." },
        { if: "looked and letter=accepted", then: "You tell her about the Recorder’s garage, and the page with the thumb in the corner. ‘The only record of the year,’ she says. ‘He never said.’" },
        { if: "looked and letter=rejected", then: "You tell her about the Recorder’s garage, and the page with the thumb in the corner. ‘Harrier sp.,’ she says. ‘That sounds like him. That sounds exactly like what he’d have been given.’" },
        { if: "looked and letter=none", then: "You tell her about the Recorder’s garage, and the page with the thumb in the corner, and the nothing on it. ‘No,’ she says. ‘He wouldn’t have sent it. He didn’t like bothering people.’" },
        "You give it to her. She tries to give it back. ‘I put it in a shop,’ she says. ‘I put it in a shop so that somebody would have it.’ You say you have got the name now; that is what you wanted. This is not quite true, and she knows it, and takes it.",
        "It goes back up the hill in her pocket. The egret is still there when she has gone, and you have no book, and you watch it anyway, and find that you do not need the book to know what it is. That was the thing, then.",
      ],
    },

    "end-dungeness": {
      ending: "The tenth",
      set: { end: "dungeness" },
      text: [
        "Friday the tenth of May 2024. You swap a shift for it. The train to Ashford, and the small one to Rye, and the bus, and then the walk, and then the shingle, which goes on, pale, to a skyline with two lighthouses on it and the power station beside them, switched off now and being emptied, slowly, over decades, like a house.",
        "The Observatory is still in its cottage. A woman with a clipboard says the wind is wrong, north-westerly, nothing doing, a few wheatears; and you say that’s all right, you’re not here for anything in particular, which is a lie, and she can tell.",
        ["At twenty to two you are sitting with your back to a winch-house out of the wind, with the book open on your knee at the harriers",
         { if: "note=book", text: ", and her note across the plate" },
         ", and you look south along the shingle, and nothing comes. Of course nothing comes. The bird he saw has been dead for fifty years, and its kind does not nest in the country any more."],
        "At ten to two a bird comes up the shingle from the south, low, slow, tilting. Brown. Big. It has a cream head and broad wings held up in a V, and it is not in a hurry, and your heart does the thing, and you do not reach for the book.",
        "It goes over the track and out over the pits. You find it in the plate afterwards, by elimination: marsh harrier, which the book says is *very rare, a few pairs*, and which the woman with the clipboard says, when you tell her, now breeds in every reedbed in Kent. ‘They’re everywhere,’ she says. ‘Lovely, though.’",
        "You write it in the back on the train home, in capitals:",
        { hand: "HARRIER. MARSH (?). DUNGENESS. 10 MAY 24, 1.50 PM." },
        { if: "entry=query",
          then: "With a question mark, like his. You are fairly sure. He was fairly sure. The book has two of them now, sixty years apart, at the same place, in the same fortnight, and neither of you could prove it to a committee, and neither of you minds.",
          else: "With a question mark. He did not put one. You are not the birder he was, and you know it, and the mark says so; it is the most honest thing in the list, and it is yours." },
        "The egret is in the creek on Saturday morning, as if nothing had happened, which it hadn’t.",
      ],
    },

    "end-shelf": {
      ending: "The shelf",
      set: { end: "shelf" },
      text: [
        "You do not write in it. It is not yours to write in; you can tell that from the back; it is somebody’s, even now. It goes on the shelf above the bed, next to the sports science textbooks you did not sell.",
        "You take it to the river a few mornings, and then you stop needing to. Egret. The small brown ones on the mud are redshank. The big brown one with the beak is a curlew. The black-and-white one that looks like a duck that has been to a wedding is a shelduck. By June you have eleven, and you have not written them down anywhere, and you do not need to, because you can see them, which is the point of a name.",
        { if: "slip=contact", then: "You do not ring the number. You think about it, on the wall, in the mornings, with the book in your pocket. She wanted to know what you saw. You could tell her. You find you want to keep it a bit longer first, and then a bit longer, and then it is August." },
        { if: "wrote", then: "Sometimes you open it at the back and read the last line, the woodpecker, in the round hand. *At the funeral. C.* Somebody stood in a churchyard in the middle of it all and looked at a bird. You know the churchyard." },
        "The book stays on the shelf. It is there now. Nobody writes in it again, that you know of; and the pale spine faces the window, and goes paler.",
      ],
    },
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = STORY;
