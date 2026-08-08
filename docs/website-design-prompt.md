# Design prompt for the Clearspace marketing site

Paste everything below the line into Claude.

---

Design and build a single-page marketing site for **Clearspace**, a tool that turns photographs of a house or storage unit into a finished auction lot catalogue.

## Who is reading this page, and how they got here

An **estate liquidator**: the owner of a small auction house, typically 2 to 20 staff, who runs timed online estate auctions on HiBid or Auction Flex. Not a consumer, not an enterprise buyer.

The critical fact for your design: **they arrive cold.** There is no salesperson, no demo call, and no funnel. Most will land here from a one-to-one email and give the page under a minute. The page has to do the entire job of convincing them by itself.

This rules out the standard SaaS landing page, which is built to produce a booked demo. Do not design toward a contact form.

## What they currently do, and why they'd care

Cataloguing is their cost of goods. A staff member photographs each lot, works out what it is, researches a value, writes a title and description, and types it into an import sheet. That is 10 to 20 minutes per lot. A 300-lot estate is weeks of someone's salary.

Clearspace takes photographs (taken quickly, badly, one-handed) and returns a finished catalogue: numbered lots, titles, written descriptions, condition, and a low/high estimate range with the sources it actually researched. The auctioneer's only job is to prune and adjust.

## The three jobs of the page, in priority order

1. **Say what this is in their vocabulary, in the first line.** The consumer sentence was "photograph a space, get listings." The professional sentence is about lots, estimates, and cataloguing hours. Write the headline in the register of someone who says "lot", "reserve", "hammer price", and "consignor".
2. **Show a real catalogue rather than describing one.** The centre of the page should be an actual worked example: photographs going in, numbered lots coming out with estimate ranges and cited comparables. Proof, not adjectives. This is the single most important element on the page, so give it the most space and the most design attention.
3. **Offer something to do that is not booking a call.** The product works with no signup, so a first-time visitor can upload photographs of their next lot immediately. That is the call to action.

## Facts you may use, and only these

Everything here is true and verifiable. Do not add to it.

- Photographs go in; the app finds individual objects, works out which photographs show the same object, and writes each one up.
- Estimates are a **low/high range**, researched, with the sources stored against them. When research turns up nothing, the item is marked **unsourced in those words** rather than showing a guess in the same typeface as a fact. This is a genuine differentiator. An invented price dressed as a researched one is the thing the product refuses to do.
- An item with no estimate is **left out of the catalogue with a stated reason**, never exported with a zero.
- The export is **one ZIP**: `lots.csv` plus the photographs it references, named `12_1.jpg` so the filename identifies the lot. Built for HiBid / Auction Flex import.
- Works on a phone, in a house or a unit, with no signup.
- **Pricing: $0.50 per catalogued lot, sold in packs, first 25 lots free.** Show this on the page; do not hide it behind "contact us". Anchor it against what it replaces: a cataloguer at $20/hour spending 10-20 minutes a lot costs $3-7 per lot, so a 300-lot auction is $150 against roughly $1,500 of staff time.

## Absolute prohibitions

These are not stylistic preferences. Violating them would put a false claim in front of a real business.

- **No testimonials, customer quotes, or named clients.** There are no customers yet. Do not invent one, do not write a placeholder that reads as real, do not include a "what our users say" section at all.
- **No customer logo wall**, no "trusted by", no "as seen in".
- **No invented metrics.** No "10,000 lots catalogued", no "used by 500 auctioneers", no fabricated accuracy percentage. If a number is not in the Facts section above, it does not go on the page.
- **No stock photography of smiling people.** If you need imagery, use the product's own output: a contact sheet, a lot card, a catalogue row.
- **No countdown timers, no fake scarcity, no "limited beta" urgency.**

If a section of a conventional landing page cannot be filled truthfully, delete the section rather than filling it.

## Design system

Reuse these tokens so the site and the app read as one product. They are the app's real values.

```css
--color-paper: oklch(98.5% 0.004 250);   /* cool near-white, never #fff */
--color-paper-2: oklch(96.6% 0.005 250);
--color-paper-3: oklch(93.8% 0.006 252);
--color-ink: oklch(24% 0.02 258);
--color-ink-2: oklch(38% 0.018 257);
--color-ink-3: oklch(54% 0.015 257);
--color-rule: oklch(89.5% 0.008 254);
--color-rule-2: oklch(80% 0.012 254);
--color-accent: oklch(58% 0.20 256);      /* electric cobalt, the one signal */
--color-accent-press: oklch(51% 0.19 256);
--color-accent-soft: oklch(94.5% 0.045 256);
--color-graphite: oklch(22% 0.016 260);

--font-display: 'Space Grotesk';
--font-body: 'Inter';
--font-mono: 'JetBrains Mono';           /* catalogue metadata: lot numbers, estimates, filenames */

--radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
--page-max: 62rem;
--tracking-display: -0.032em;
```

House rules carried over from the app:

- **Depth comes from hairlines, not shadow.** 1px rules, not drop shadows. The app has exactly one shadow in the entire system; the site should have none.
- **The accent is a signal, not decoration.** Under 5% of any viewport: the primary action and little else. A page washed in cobalt breaks the system.
- **Mono for catalogue metadata.** Lot numbers, estimate figures, filenames, CSV column names. It is how the app distinguishes catalogue data from prose, and it will make the worked example read as real.

Differences from the app, which you should honour:

- The app is designed for one hand, in a concrete unit, under a single bulb: 44px targets, maximum ink contrast. **The website is read on a desktop in an office.** Do not carry over the oversized touch targets or the app's density. Use the tokens for colour and type; set your own spacing and scale for a reading surface.

## Deliverable

A single self-contained HTML page: inline CSS, no external requests, no framework. Responsive; nothing should scroll horizontally. Support light and dark.

Prioritise the worked catalogue example over everything else. If you run short, a page with a headline and one convincing catalogue is better than a complete page of generic sections.
