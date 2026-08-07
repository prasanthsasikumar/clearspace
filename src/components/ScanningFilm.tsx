'use client'

import { useEffect, useState } from 'react'
import { blobUrl, type BatchPhoto } from '@/lib/client/api'

/**
 * The user's own photographs, being looked through.
 *
 * A waiting screen has to spend a minute or two of someone's attention, and
 * the honest thing to put in it is the work itself. So the photos they just
 * took cycle one at a time under a sweeping line, and boxes appear on each one
 * as the detector actually finds them: what is on screen is what has happened,
 * not a loading animation standing in for it.
 *
 * `flash` holds every box on at once for a beat at the end, which is the only
 * moment the whole batch is visible as one thing before it becomes a list.
 */
export function ScanningFilm({
  photos,
  flash = false,
}: {
  photos: readonly BatchPhoto[]
  flash?: boolean
}) {
  const [index, setIndex] = useState(0)

  // Slow enough to register as a photograph rather than a flicker, and it
  // holds on whichever photo is last while the batch finishes.
  useEffect(() => {
    if (photos.length < 2 || flash) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % photos.length), 1800)
    return () => clearInterval(timer)
  }, [photos.length, flash])

  if (photos.length === 0) return null

  const current = photos[Math.min(index, photos.length - 1)]!

  return (
    <div className="film" data-flash={flash}>
      {photos.map((photo, i) => (
        <figure
          className="film__frame"
          key={photo.id}
          data-current={flash ? true : i === index}
          aria-hidden={i === index ? undefined : true}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={blobUrl(photo.blobKey)} alt="" />
          {photo.boxes.map((box, b) => (
            <span
              className="film__box"
              key={`${photo.id}-${b}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                // Staggered, so a photo with nine things in it reads as nine
                // findings rather than one flash of clutter.
                animationDelay: `${Math.min(b, 8) * 70}ms`,
              }}
            />
          ))}
        </figure>
      ))}

      {/* The sweep. Off during the flash, when the point is the boxes. */}
      {flash ? null : <span className="film__sweep" aria-hidden="true" />}

      <span className="film__count label">
        {flash
          ? `${photos.reduce((n, p) => n + p.boxes.length, 0)} found`
          : `${Math.min(index + 1, photos.length)} of ${photos.length}`}
      </span>
      <span className="visually-hidden" role="status">
        {current.boxes.length > 0
          ? `${current.boxes.length} things found in this photo`
          : 'Looking at this photo'}
      </span>
    </div>
  )
}
