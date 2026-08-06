'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Item, ItemPhoto, PhotoView } from '@/db/schema'
import type { CoverageResult } from '@/domain/coverage'
import { adviceFor } from '@/domain/image-quality'
import { categoryLabels, itemCategories, type ItemCategory } from '@/domain/types'
import { statusLabels } from '@/domain/item-status'
import {
  ApiError,
  blobUrl,
  deleteItem,
  deletePhoto,
  updateItem,
  uploadItemPhoto,
} from '@/lib/client/api'
import { prepareImage } from '@/lib/client/image'
import { StatusChip } from './StatusChip'

const CONDITIONS = [
  { value: '', label: 'Not assessed' },
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'for_parts', label: 'For parts' },
] as const

const VIEW_LABELS: Record<PhotoView, string> = {
  front: 'Front',
  side: 'Side',
  back: 'Back',
  top: 'Top',
  label: 'Label',
  damage: 'Damage',
  serial: 'Serial',
  accessories: 'Extras',
  other: 'Other',
}

interface Draft {
  title: string
  category: string
  brand: string
  model: string
  condition: string
  conditionNotes: string
  serialNumber: string
  userNotes: string
}

/**
 * Item detail — fields, photos, and the checklist that says what is missing.
 *
 * The checklist is the point of the screen. An item with a front photo and no
 * label shot is an item that will sit unsold, and the seller has no way to
 * know that from looking at it. Sorta says which photo is missing and why it
 * changes the price.
 */
export function ItemEditor({
  item: initialItem,
  photos: initialPhotos,
  coverage: initialCoverage,
  lotId,
  lotName,
}: {
  item: Item
  photos: ItemPhoto[]
  coverage: CoverageResult
  lotId: string
  lotName: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingView = useRef<PhotoView>('other')

  const [item, setItem] = useState(initialItem)
  const [photos, setPhotos] = useState(initialPhotos)
  const [coverage, setCoverage] = useState(initialCoverage)
  const [draft, setDraft] = useState<Draft>(toDraft(initialItem))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(item))

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true)
    setError(null)
    try {
      const result = await updateItem(item.id, {
        title: draft.title,
        category: draft.category === '' ? null : draft.category,
        brand: draft.brand || null,
        model: draft.model || null,
        condition: draft.condition === '' ? null : draft.condition,
        conditionNotes: draft.conditionNotes || null,
        serialNumber: draft.serialNumber || null,
        userNotes: draft.userNotes || null,
        ...extra,
      })
      setItem(result.item)
      setPhotos(result.photos)
      setCoverage(result.coverage)
      setDraft(toDraft(result.item))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save those changes.')
    } finally {
      setSaving(false)
    }
  }

  function requestPhoto(view: PhotoView) {
    pendingView.current = view
    fileRef.current?.click()
  }

  async function onPhotoPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const prepared = await prepareImage(file)
      const result = await uploadItemPhoto(item.id, {
        file: prepared.file,
        view: pendingView.current,
        quality: prepared.quality,
      })
      setPhotos((prev) => [...prev, result.photo])
      if (result.coverage) setCoverage(result.coverage)

      const advice = adviceFor(prepared.quality)
      if (advice) setError(advice)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not add that photo.')
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto(photoId: string) {
    const snapshot = photos
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    try {
      await deletePhoto(photoId)
      router.refresh()
    } catch {
      setPhotos(snapshot)
      setError('Could not remove that photo.')
    }
  }

  async function discard() {
    if (!window.confirm(`Remove “${item.title}” from ${lotName}? This cannot be undone.`)) {
      return
    }
    try {
      await deleteItem(item.id)
      router.push(`/lots/${lotId}`)
    } catch {
      setError('Could not remove that item.')
    }
  }

  const percent = Math.round(coverage.completeness * 100)

  return (
    <>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <div className="row">
            <StatusChip status={item.status} />
            <span className="label">{percent}% photographed</span>
          </div>
          <h1>{item.title}</h1>
          <p className="meta">
            {item.estimatedValueCents === null
              ? 'Not yet priced — pricing research arrives with listing generation.'
              : formatMoney(item.estimatedValueCents, item.currency)}
          </p>
        </div>

        {error ? (
          <p className="notice notice--danger" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : null}

        {/* --- Photos ----------------------------------------------------- */}

        <section className="stack">
          <div className="row row--between">
            <span className="label">Photos</span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => requestPhoto('other')}
              disabled={uploading}
              data-state={uploading ? 'loading' : undefined}
            >
              {uploading ? 'Adding…' : 'Add photo'}
            </button>
          </div>

          {photos.length === 0 ? (
            <div className="empty">
              <p className="meta">No photos yet.</p>
            </div>
          ) : (
            <div className="photos">
              {photos.map((photo) => (
                <figure className="photo" key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={blobUrl(photo.blobKey)} alt={`${VIEW_LABELS[photo.view]} view`} />
                  <figcaption className="photo__view">{VIEW_LABELS[photo.view]}</figcaption>
                  <button
                    type="button"
                    className="photo__remove"
                    aria-label={`Remove the ${VIEW_LABELS[photo.view].toLowerCase()} photo`}
                    onClick={() => void removePhoto(photo.id)}
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          )}
        </section>

        {/* --- Coverage --------------------------------------------------- */}

        <section className="panel">
          <div className="panel__head">
            <span className="label">Shot list</span>
            <span className="label">
              {coverage.isListable ? 'Complete' : `${coverage.missingRequired.length} missing`}
            </span>
          </div>
          <div className="panel__body">
            <ul className="coverage">
              {coverage.requirements.map((requirement) => {
                const done = coverage.captured.includes(requirement.view)
                return (
                  <li className="coverage__item" key={requirement.view} data-done={done}>
                    <span className="coverage__mark" aria-hidden="true">
                      {done ? '✓' : requirement.importance === 'required' ? '●' : '○'}
                    </span>
                    <span className="stack stack--tight">
                      <span className="coverage__name">{requirement.prompt}</span>
                      <span className="coverage__why">{requirement.rationale}</span>
                    </span>
                    {done ? (
                      <span className="visually-hidden">Captured</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => requestPhoto(requirement.view)}
                        disabled={uploading}
                      >
                        Take
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        {/* --- Details ---------------------------------------------------- */}

        <section className="panel">
          <div className="panel__head">
            <span className="label">Details</span>
          </div>
          <div className="panel__body stack">
            <div className="field">
              <label className="label" htmlFor="item-title">
                Title
              </label>
              <input
                id="item-title"
                className="field__control"
                value={draft.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="item-category">
                Category
              </label>
              <select
                id="item-category"
                className="field__control"
                value={draft.category}
                onChange={(e) => set('category', e.target.value)}
              >
                <option value="">Uncategorised</option>
                {itemCategories.map((category: ItemCategory) => (
                  <option key={category} value={category}>
                    {categoryLabels[category]}
                  </option>
                ))}
              </select>
              <span className="meta">Category decides which photos the shot list asks for.</span>
            </div>

            <div className="field">
              <label className="label" htmlFor="item-brand">
                Brand
              </label>
              <input
                id="item-brand"
                className="field__control"
                value={draft.brand}
                onChange={(e) => set('brand', e.target.value)}
                placeholder="Only if it is printed on the item"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="item-model">
                Model
              </label>
              <input
                id="item-model"
                className="field__control"
                value={draft.model}
                onChange={(e) => set('model', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="item-condition">
                Condition
              </label>
              <select
                id="item-condition"
                className="field__control"
                value={draft.condition}
                onChange={(e) => set('condition', e.target.value)}
              >
                {CONDITIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="item-condition-notes">
                What is wrong with it
              </label>
              <textarea
                id="item-condition-notes"
                className="field__control"
                value={draft.conditionNotes}
                onChange={(e) => set('conditionNotes', e.target.value)}
                placeholder="Scratch on the left arm, one caster sticks."
              />
              <span className="meta">
                Disclosed damage prevents returns. Buyers assume the worst about what you leave
                out.
              </span>
            </div>

            <div className="field">
              <label className="label" htmlFor="item-serial">
                Serial or model number
              </label>
              <input
                id="item-serial"
                className="field__control"
                value={draft.serialNumber}
                onChange={(e) => set('serialNumber', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="item-notes">
                Anything you know about it
              </label>
              <textarea
                id="item-notes"
                className="field__control"
                value={draft.userNotes}
                onChange={(e) => set('userNotes', e.target.value)}
                placeholder="Bought new in 2018, used in a home office, non-smoking house."
              />
            </div>
          </div>
        </section>

        <div className="row row--between">
          <span className="meta">Status: {statusLabels[item.status]}</span>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => void discard()}>
            Remove item
          </button>
        </div>

        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhotoPicked}
        />
      </div>

      <aside className="actionbar">
        <span className="actionbar__note">
          {dirty
            ? 'Unsaved changes.'
            : coverage.next
              ? coverage.next.prompt
              : 'Everything this item needs is captured.'}
        </span>
        {dirty ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
            data-state={saving ? 'loading' : undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : item.status === 'needs_confirmation' ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save({ status: 'confirmed' })}
            disabled={saving}
          >
            Confirm details
          </button>
        ) : coverage.next ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => requestPhoto(coverage.next!.view)}
            disabled={uploading}
          >
            Take it
          </button>
        ) : null}
      </aside>
    </>
  )
}

function toDraft(item: Item): Draft {
  return {
    title: item.title,
    category: item.category ?? '',
    brand: item.brand ?? '',
    model: item.model ?? '',
    condition: item.condition ?? '',
    conditionNotes: item.conditionNotes ?? '',
    serialNumber: item.serialNumber ?? '',
    userNotes: item.userNotes ?? '',
  }
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
