const LOT_KIND_HINTS: Record<string, string> = {
  storage_unit:
    'This is a rented storage unit. Expect boxes, stacked furniture, tools, and seasonal goods, often crowded and poorly lit.',
  garage: 'This is a garage. Expect tools, sporting goods, auto parts, and shelving.',
  home: 'This is a room in a home. Expect furniture, electronics, decor, and appliances.',
  estate:
    'This is an estate sale. Expect antiques, collectibles, china, furniture, and framed art.',
  office: 'This is an office. Expect desks, chairs, monitors, and IT equipment.',
}

/**
 * Detection prompt.
 *
 * Three instructions here are load-bearing and were the difference between an
 * unusable review screen and a good one:
 *
 * 1. *Whole objects, not parts.* Without it the model returns a sofa plus each
 *    of its cushions, and the user has to dismiss six boxes to keep one.
 * 2. *Skip structure.* Walls, floors, and ceilings are always in frame and are
 *    never for sale.
 * 3. *Group bulk goods.* Forty paperbacks on a shelf is one lot listing, not
 *    forty items. This mirrors how these things actually sell.
 */
export function buildDetectionPrompt(options: {
  lotKind?: string
  hint?: string
  maxObjects: number
}): string {
  const contextLine = options.lotKind ? LOT_KIND_HINTS[options.lotKind] : undefined

  return [
    'You are cataloguing physical goods for resale from a photo of a space.',
    contextLine,
    options.hint ? `The seller says: "${options.hint}"` : undefined,
    '',
    'Identify every discrete object that a person could realistically sell second-hand.',
    '',
    'Rules:',
    '- Return whole objects, not their parts. One box per sofa, not one per cushion; one per toolbox, not one per tool inside it.',
    '- Do not return building structure: walls, floors, ceilings, doors, windows, or light fixtures.',
    '- Group bulk goods that would sell as a single lot into one object, and say so in the label (e.g. "box of paperback books", "bin of assorted cables").',
    '- If an object is mostly hidden behind another, still return it, with lower confidence.',
    `- Return at most ${options.maxObjects} objects, favouring the most valuable and most clearly visible.`,
    '- Set sellable=false for anything you return that is not actually saleable, rather than omitting it.',
    '- Bounding boxes must be tight around the object and use [ymin, xmin, ymax, xmax] scaled 0-1000.',
    '',
    'Do not guess brands or model numbers that are not legible in the image.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

export function buildQualityPrompt(options: {
  intendedView?: string
  itemTitle?: string
}): string {
  const viewGoal: Record<string, string> = {
    front: 'a straight-on view of the front of the item',
    side: 'a side profile of the item',
    back: 'the back of the item',
    top: 'the item viewed from above',
    label: 'a legible close-up of the brand label or nameplate',
    damage: 'a close-up showing the damage or wear clearly',
    serial: 'a legible close-up of the serial or model number',
    accessories: 'the accessories and parts included with the item',
  }

  const goal = options.intendedView ? viewGoal[options.intendedView] : undefined

  return [
    'Assess this photo for use in a second-hand marketplace listing.',
    options.itemTitle ? `The item is: ${options.itemTitle}.` : undefined,
    goal ? `The photo is meant to show ${goal}.` : undefined,
    '',
    'Judge sharpness, exposure, framing, and whether the intended subject is actually legible.',
    'If the photo is usable, return an empty suggestion. Otherwise give one short instruction the seller can act on immediately.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}
