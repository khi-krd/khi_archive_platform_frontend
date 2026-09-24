import { useEffect, useState } from 'react'

import {
  ensureActiveAuthImage,
  getActiveAuthImage,
  resolveAuthImageSrc,
  subscribeAuthImage,
} from '@/lib/auth-image'

// Subscribes to the uploaded auth-panel image. Any component that renders
// it triggers the (deduped) fetch, so no layout has to remember to prime it.
export function useAuthImage() {
  const [record, setRecord] = useState(() => getActiveAuthImage())

  useEffect(() => {
    const unsubscribe = subscribeAuthImage(setRecord)
    ensureActiveAuthImage().catch(() => {})
    return unsubscribe
  }, [])

  return record
}

// The `src` to draw right now, or null when no image has been uploaded —
// callers keep the built-in scene as the fallback.
export function useAuthImageSrc() {
  const record = useAuthImage()
  return record ? resolveAuthImageSrc(record) : null
}
