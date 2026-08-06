import type { PhotoView } from '@/db/schema'
import type { ItemCategory } from './types'

/**
 * Which photos an item needs before it is worth listing.
 *
 * This is a lookup table rather than a model call on purpose. The rules are
 * stable, category-level facts about how second-hand goods sell — a serial
 * number matters on a drill and is meaningless on a coffee table — and a table
 * is instant, free, deterministic, and testable. The model's judgement is
 * better spent on whether a given photo is any *good*, which is a different
 * question and does go to Gemini.
 */
export type ViewImportance = 'required' | 'recommended'

export interface ViewRequirement {
  view: PhotoView
  importance: ViewImportance
  /** Imperative instruction shown to the user during capture. */
  prompt: string
  /** Why this view matters, shown as secondary text. */
  rationale: string
}

interface ViewSpec {
  importance: ViewImportance
  prompt?: string
  rationale?: string
}

const BASE_PROMPTS: Record<PhotoView, { prompt: string; rationale: string }> = {
  front: {
    prompt: 'Take a front photo',
    rationale: 'The main photo buyers see in search results.',
  },
  side: {
    prompt: 'Take a side photo',
    rationale: 'Shows depth and proportions a front shot flattens.',
  },
  back: {
    prompt: 'Take a photo of the back',
    rationale: 'Buyers assume hidden damage when the back is missing.',
  },
  top: {
    prompt: 'Take a photo from above',
    rationale: 'Shows the work surface and any staining or scratches.',
  },
  label: {
    prompt: 'Photograph the brand label',
    rationale: 'Proof of what it is, so buyers stop asking.',
  },
  damage: {
    prompt: 'Photograph any damage or wear',
    rationale: 'Disclosed damage prevents returns and lowballing.',
  },
  serial: {
    prompt: 'Photograph the serial or model number',
    rationale: 'Lets buyers confirm the exact model and parts fit.',
  },
  accessories: {
    prompt: 'Photograph the accessories included',
    rationale: 'Chargers, cases, and bits materially raise the price.',
  },
  other: {
    prompt: 'Add another photo',
    rationale: 'More angles, more confidence.',
  },
}

const CATEGORY_RULES: Record<ItemCategory, Partial<Record<PhotoView, ViewSpec>>> = {
  furniture: {
    front: { importance: 'required' },
    side: { importance: 'required' },
    damage: {
      importance: 'required',
      prompt: 'Photograph scratches, stains, or wear',
      rationale: 'Furniture sells on condition; hide nothing.',
    },
    label: {
      importance: 'recommended',
      prompt: 'Photograph the maker tag',
      rationale: 'Underside or back tags are what separate a designer piece from a lookalike.',
    },
  },
  electronics: {
    front: { importance: 'required' },
    back: {
      importance: 'required',
      prompt: 'Photograph the back and ports',
      rationale: 'Buyers check connectivity before anything else.',
    },
    label: { importance: 'required' },
    serial: {
      importance: 'required',
      prompt: 'Photograph the model and serial sticker',
      rationale: 'The exact model number decides the price band.',
    },
    damage: { importance: 'recommended' },
    accessories: {
      importance: 'recommended',
      prompt: 'Photograph remote, cables, and stand',
      rationale: 'A missing remote knocks a real amount off the price.',
    },
  },
  appliance: {
    front: { importance: 'required' },
    back: { importance: 'recommended' },
    serial: { importance: 'required' },
    label: { importance: 'required' },
    damage: { importance: 'recommended' },
  },
  tools: {
    front: { importance: 'required' },
    label: {
      importance: 'required',
      prompt: 'Photograph the brand and model marking',
      rationale: 'Brand is most of the value in used tools.',
    },
    accessories: {
      importance: 'recommended',
      prompt: 'Photograph batteries, chargers, and bits',
      rationale: 'Battery tools with no battery sell for a fraction.',
    },
    damage: { importance: 'recommended' },
  },
  sporting_goods: {
    front: { importance: 'required' },
    side: { importance: 'recommended' },
    label: { importance: 'required' },
    damage: { importance: 'required' },
  },
  apparel: {
    front: { importance: 'required' },
    back: { importance: 'recommended' },
    label: {
      importance: 'required',
      prompt: 'Photograph the brand and size tag',
      rationale: 'Size is the first thing a clothing buyer filters on.',
    },
    damage: {
      importance: 'required',
      prompt: 'Photograph any stains, holes, or pilling',
      rationale: 'Flaws a buyer finds later come back as a return.',
    },
  },
  jewelry: {
    front: { importance: 'required' },
    label: {
      importance: 'required',
      prompt: 'Photograph the hallmark or stamp',
      rationale: 'The metal stamp is the proof of what it is.',
    },
    damage: { importance: 'recommended' },
    accessories: {
      importance: 'recommended',
      prompt: 'Photograph the box and papers',
      rationale: 'Original packaging adds real resale value.',
    },
  },
  collectibles: {
    front: { importance: 'required' },
    back: { importance: 'required' },
    label: {
      importance: 'recommended',
      prompt: 'Photograph any markings or signatures',
      rationale: 'Marks are how collectors date and value a piece.',
    },
    damage: { importance: 'required' },
  },
  books_media: {
    front: { importance: 'required' },
    back: { importance: 'recommended' },
    damage: {
      importance: 'recommended',
      prompt: 'Photograph spine and corner wear',
      rationale: 'Condition grading for books is all edges and spine.',
    },
  },
  kitchenware: {
    front: { importance: 'required' },
    label: { importance: 'recommended' },
    damage: { importance: 'recommended' },
  },
  toys: {
    front: { importance: 'required' },
    label: { importance: 'recommended' },
    accessories: {
      importance: 'recommended',
      prompt: 'Photograph all the pieces included',
      rationale: 'Completeness is the whole question with used toys.',
    },
    damage: { importance: 'recommended' },
  },
  auto_parts: {
    front: { importance: 'required' },
    label: { importance: 'required' },
    serial: {
      importance: 'required',
      prompt: 'Photograph the part number',
      rationale: 'Fitment is decided by the part number, nothing else.',
    },
    damage: { importance: 'recommended' },
  },
  garden_outdoor: {
    front: { importance: 'required' },
    side: { importance: 'recommended' },
    label: { importance: 'recommended' },
    damage: {
      importance: 'required',
      prompt: 'Photograph rust, fading, or cracks',
      rationale: 'Weather exposure is the first thing buyers ask about.',
    },
  },
  musical_instruments: {
    front: { importance: 'required' },
    back: { importance: 'required' },
    label: {
      importance: 'required',
      prompt: 'Photograph the headstock or maker label',
      rationale: 'Identifies the exact model and year.',
    },
    serial: { importance: 'recommended' },
    damage: {
      importance: 'required',
      prompt: 'Photograph dings, cracks, and finish wear',
      rationale: 'Structural condition drives instrument pricing.',
    },
    accessories: { importance: 'recommended' },
  },
  other: {
    front: { importance: 'required' },
    side: { importance: 'recommended' },
    damage: { importance: 'recommended' },
  },
}

/** Ordering used when deciding what to ask for next. */
const VIEW_ORDER: PhotoView[] = [
  'front',
  'side',
  'back',
  'top',
  'label',
  'serial',
  'damage',
  'accessories',
  'other',
]

export function requirementsFor(category: ItemCategory | null | undefined): ViewRequirement[] {
  const rules = CATEGORY_RULES[category ?? 'other'] ?? CATEGORY_RULES.other

  return VIEW_ORDER.filter((view) => rules[view] !== undefined).map((view) => {
    const spec = rules[view]!
    const base = BASE_PROMPTS[view]
    return {
      view,
      importance: spec.importance,
      prompt: spec.prompt ?? base.prompt,
      rationale: spec.rationale ?? base.rationale,
    }
  })
}

export interface CoveredPhoto {
  view: PhotoView
  /** Photos flagged as unusable do not count toward coverage. */
  usable?: boolean
}

export interface CoverageResult {
  requirements: ViewRequirement[]
  captured: PhotoView[]
  missingRequired: ViewRequirement[]
  missingRecommended: ViewRequirement[]
  /** 0-1, weighting required views at double a recommended one. */
  completeness: number
  /** The single next thing to ask for, or null when nothing is outstanding. */
  next: ViewRequirement | null
  isListable: boolean
}

export function evaluateCoverage(
  category: ItemCategory | null | undefined,
  photos: readonly CoveredPhoto[],
): CoverageResult {
  const requirements = requirementsFor(category)
  const captured = new Set<PhotoView>()
  for (const photo of photos) {
    if (photo.usable === false) continue
    captured.add(photo.view)
  }

  const missingRequired = requirements.filter(
    (r) => r.importance === 'required' && !captured.has(r.view),
  )
  const missingRecommended = requirements.filter(
    (r) => r.importance === 'recommended' && !captured.has(r.view),
  )

  const weight = (r: ViewRequirement) => (r.importance === 'required' ? 2 : 1)
  const total = requirements.reduce((sum, r) => sum + weight(r), 0)
  const earned = requirements
    .filter((r) => captured.has(r.view))
    .reduce((sum, r) => sum + weight(r), 0)

  return {
    requirements,
    captured: [...captured],
    missingRequired,
    missingRecommended,
    completeness: total === 0 ? 1 : earned / total,
    next: missingRequired[0] ?? missingRecommended[0] ?? null,
    isListable: missingRequired.length === 0,
  }
}
