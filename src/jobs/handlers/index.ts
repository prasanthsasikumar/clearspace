import { registerHandler } from '../worker'
import { assessPhotoHandler } from './assess-photo'
import { detectObjectsHandler } from './detect-objects'
import { enrichItemHandler } from './enrich-item'
import { enrichLotHandler } from './enrich-lot'
import { groupObjectsHandler } from './group-objects'

let registered = false

/**
 * Registers every job handler. Idempotent, because both the request path and
 * the worker start-up path need to guarantee handlers exist and neither can
 * assume it ran first.
 */
export function registerJobHandlers(): void {
  if (registered) return
  registerHandler('detect_objects', detectObjectsHandler)
  registerHandler('assess_photo', assessPhotoHandler)
  registerHandler('group_objects', groupObjectsHandler)
  registerHandler('enrich_item', enrichItemHandler)
  registerHandler('enrich_lot', enrichLotHandler)
  registered = true
}

export { detectObjectsHandler } from './detect-objects'
export { assessPhotoHandler } from './assess-photo'
export { groupObjectsHandler } from './group-objects'
