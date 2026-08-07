'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, createLot } from '@/lib/client/api'

const KINDS = [
  { value: 'storage_unit', label: 'Storage unit' },
  { value: 'garage', label: 'Garage' },
  { value: 'home', label: 'Home' },
  { value: 'estate', label: 'Estate sale' },
  { value: 'office', label: 'Office' },
  { value: 'other', label: 'Something else' },
] as const

/**
 * Creating a lot is three fields and a button.
 *
 * The native `<dialog>` handles the focus trap, the backdrop, and Escape for
 * free; reimplementing those is where hand-rolled modals go wrong.
 */
export function NewLotButton({ size }: { size?: 'lg' }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>('storage_unit')
  const [location, setLocation] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length === 0) {
      setError('Give this lot a name.')
      setState('error')
      return
    }

    setState('saving')
    setError(null)
    try {
      const { lot } = await createLot({
        name,
        kind,
        locationText: location.trim() || null,
      })
      dialogRef.current?.close()
      router.push(`/lots/${lot.id}`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create that lot.')
      setState('error')
    }
  }

  return (
    <>
      <button
        type="button"
        className={size === 'lg' ? 'btn btn--primary btn--lg' : 'btn btn--primary'}
        onClick={() => {
          setState('idle')
          setError(null)
          dialogRef.current?.showModal()
        }}
      >
        New lot
      </button>

      <dialog className="sheet" ref={dialogRef} aria-labelledby="new-lot-title">
        <form className="sheet__body" onSubmit={submit}>
          <h2 id="new-lot-title">New lot</h2>

          <div className="field">
            <label className="label" htmlFor="lot-name">
              Name
            </label>
            <input
              id="lot-name"
              className="field__control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Storage Unit #23"
              autoComplete="off"
              aria-invalid={state === 'error' && name.trim().length === 0}
              // The sheet exists to collect this one field; focus it.
              autoFocus
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="lot-kind">
              What is it
            </label>
            <select
              id="lot-kind"
              className="field__control"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="lot-location">
              Where <span className="meta">(optional)</span>
            </label>
            <input
              id="lot-location"
              className="field__control"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Bay 12, Fremont"
              autoComplete="off"
            />
          </div>

          {error ? (
            <p className="field__error">
              <span aria-hidden="true">⚠</span>
              {error}
            </p>
          ) : null}

          <div className="row row--between">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              data-state={state === 'saving' ? 'loading' : undefined}
              disabled={state === 'saving'}
            >
              {state === 'saving' ? 'Creating…' : 'Create lot'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
