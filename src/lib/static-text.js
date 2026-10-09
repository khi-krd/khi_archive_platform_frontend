import { useEffect, useState } from 'react'

import { getPublicTextBlocks } from '@/services/static-text'

// Admin-edited UI strings, fetched once per locale and shared app-wide.
// Any component renders its bundled fallback until (and unless) a row exists
// in the static_texts table — the API being down is invisible to visitors.
const cache = new Map() // locale -> Promise<Record<string, string>>

function load(locale) {
  if (!cache.has(locale)) {
    cache.set(locale, getPublicTextBlocks(locale).catch(() => ({})))
  }
  return cache.get(locale)
}

/** Drop the cached map — the admin editor calls this after a save so the
 * next visit (or remount) reflects the new text immediately. */
export function invalidateStaticTextCache() {
  cache.clear()
}

/**
 * React hook: uiText('auth.loginTitle', 'Welcome back') returns the DB value
 * when it exists, otherwise the bundled fallback — never undefined.
 */
export function useUiText(key, fallback, locale = 'ckb') {
  const [text, setText] = useState(fallback)
  useEffect(() => {
    let alive = true
    load(locale).then((map) => {
      if (alive && typeof map?.[key] === 'string' && map[key].trim()) {
        setText(map[key])
      }
    })
    return () => {
      alive = false
    }
  }, [key, fallback, locale])
  return text
}
