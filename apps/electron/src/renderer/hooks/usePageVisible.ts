import { useState, useEffect } from 'react'

/**
 * Returns whether the page is currently visible using the Page Visibility API.
 * When the window is minimized, fully obscured, or in a hidden tab, returns false.
 * No IPC needed — pure browser API.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}
