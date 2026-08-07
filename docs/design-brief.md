# Sorta — product brief for a visual designer

## What it is

An iPhone web app for people clearing out a storage unit, garage, or house who
want to sell what's in it.

Normally, selling second-hand means doing this for every single object:
photograph it, work out what it is, look up what it's worth, write a
description, post it. That's 10–20 minutes each. A storage unit with 60 things
in it is a lost weekend, so most people give up and sell the whole lot to a
dealer for almost nothing.

Sorta removes all of that except one decision. You walk around taking photos —
badly, quickly, whatever you can manage. The app finds the individual objects in
your photos, works out which photos show the same object, and turns each one
into a finished listing with a title, a description, and a price. Your only job
is to look at the results and bin the things you don't actually want to sell.

## The one-sentence version

**Take photos of a room, get a list of ready-to-post sale listings.**

## Who is using it, and where

This matters more than anything else for the design.

They are standing in a concrete storage unit lit by one bulb, or in a dusty
garage, or in a driveway in bright sun. They're holding the phone in one hand.
They may have five minutes. They are not a professional seller — this is a
chore they want finished. They are probably a bit overwhelmed by how much stuff
there is.

So: big tap targets, high contrast, very few choices on screen at once, and
never make them type if you can avoid it. It should feel like a fast, capable
tool — not a delicate one.

## The screens

### 1. Home

A list of "lots". A lot is one space they're clearing — "Storage Unit #23",
"Mum's garage", "Spare room".

Each row shows: the name, what kind of space it is, where it is, how many items
have been catalogued, and a count of how many still need attention. Each row has
an **Add photos** button.

There's a **New lot** button to create one (name, type of space, optional
location).

If they have no lots yet, the screen explains what a lot is and invites them to
make one.

### 2. Capture

Where they hand over photos. This is the front door of the whole product.

- A big **Choose photos** button — they pick many at once from their camera roll
  (usually 10–30 photos they just took walking around).
- A **Video** button — they record a walkthrough instead, and the app pulls the
  sharp still frames out of it automatically.
- Before they pick anything, short practical advice: open the door for light,
  photograph anything you might sell, get closer to small things, twenty photos
  is plenty.
- After they pick, a grid of thumbnails of what they chose, with a count. Any
  photo that's blurry or dark is marked "Soft" — but it still uploads; it's a
  note, not a blocker.
- Then one button: **Sort 24** (or however many).

### 3. Working / progress

They just handed over 24 photos. This takes a minute or two, and a plain
spinner would make them think it's broken. So this screen shows the work
happening as three steps with live numbers:

- Looking at each photo — *14 of 24*
- Finding objects — *31*
- Matching the same thing across photos — *18 items*

When it's done: "18 things to sell", and a note if several of them were
photographed more than once so they already have multiple angles.

They can leave this screen; it keeps going.

### 4. The board — the main screen

A grid of cards, two across on a phone. One card per object found.

Each card has: a photo of just that object (cut out of the original photo), its
name, its price if it has one yet, a small status label, and a **Bin** button.
If the object appeared in several photos, the card says "3 views".

**Everything starts selected**, with a tick on each card. The user taps a card
to *deselect* it — because after photographing a room, most of what came back is
worth keeping, so the work should be taking things away, not adding them up.

At the top: "12 of 15 selected" and a **Select all / none** toggle.

At the bottom, always visible: **Next · 12**.

Tapping a card's title opens that item. Tapping **Bin** removes it, with an
**Undo** that sits there for a while.

### 5. Listings

After they tap Next, the app researches and writes each selected item. Same
kind of progress display — "Writing your listings… 7 of 12".

Then the same grid, but now each card shows a real title and a real price. Each
one needs a quick look:

- **Approve** on each card, or **Approve all** at the top.
- A summary at the bottom of what the export will contain, including a warning
  like *"5 prices are still Sorta's estimate — nobody has checked them."*

Two buttons at the bottom: **Export CSV**, and **eBay** which is greyed out and
not built yet.

### 6. One item

Opened by tapping a card. Shows, in this order:

- **The listing** — the generated title, the description, and an editable price
  box. Under the price: what the price was based on, and a list of tappable
  links to the actual web pages the app found (usually eBay or similar). If it
  couldn't find real prices, it says so plainly instead of pretending.
- **Share** — the most important button in the app. One tap puts the item's
  photos and its text into the iPhone share sheet, so they can save the photos
  to their camera roll or send everything straight into the Facebook app and
  paste. This is how a normal person actually posts to Marketplace.
- **Photos** — all the pictures of this object, with an **Add photo** button.
- **Shot list** — optional suggestions like "Photograph the brand label" with a
  one-line reason why it helps sell. Never required.
- **Details** — editable fields: title, category, brand, model, condition,
  what's wrong with it, serial number, notes.

### 7. Original photos (secondary)

From a lot, they can open one of their original photos and see boxes drawn over
everything the app found in it. If it missed something, they can drag a box
around it and name it. This is a rescue hatch, not a main path — it should feel
tucked away.

## The important feelings

**It should feel like it did the work.** The user's contribution is photos and a
few taps. The app should look competent and quick, not like a form to fill in.

**Honesty about prices.** Prices come from an AI searching the web. Sometimes it
finds real sold listings; sometimes it's guessing. The design must make that
difference visible — an estimate should never look identical to a checked price.
There's a badge for "Estimate" vs "You checked this", and the sources are always
shown. Please keep this distinction loud rather than tidy.

**Nothing is ever lost silently.** Binning is undoable. Errors say what to do
next. If the app is unsure, it shows two things rather than merging them into
one.

## Things to avoid

- Anything that nags the user for more photos. One photo of something is enough.
- Long forms. Every field should already be filled in.
- Confirmation dialogs. Bin-with-undo instead.
- Making the price look more certain than it is.

## Current look (what you're replacing)

Cool near-white background, one blue accent, thin hairline borders instead of
shadows, Space Grotesk for headings, Inter for body, JetBrains Mono for small
uppercase labels. Functional and plain. You are free to ignore all of this —
the only real constraints are the context of use above: bright sun, dim
storage units, one hand, big targets.
