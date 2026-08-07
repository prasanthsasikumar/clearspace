import Link from 'next/link'

interface AppBarProps {
  /** Omit on the index, where the wordmark stands alone. */
  title?: string
  back?: { href: string; label: string }
  action?: React.ReactNode
  /** Who is signed in, shown on every screen so the state is never a mystery. */
  account?: React.ReactNode
}

/**
 * N9 · Edge-aligned minimal, adapted for an app shell.
 *
 * One thing on the left (where you came from, or the wordmark) and at most
 * one on the right. No link row: on a phone held one-handed in a storage unit,
 * a row of five destinations is five chances to leave by accident.
 */
export function AppBar({ title, back, action, account }: AppBarProps) {
  return (
    <header className="appbar">
      <div className="appbar__lead">
        {back ? (
          <Link className="backlink" href={back.href}>
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        ) : (
          <Link className="wordmark" href="/">
            Clearspace
          </Link>
        )}
        {title ? <span className="appbar__title">{title}</span> : null}
      </div>
      <div className="row">
        {account}
        {action}
      </div>
    </header>
  )
}
