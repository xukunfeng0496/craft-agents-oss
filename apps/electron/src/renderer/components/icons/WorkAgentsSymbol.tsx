interface WorkAgentsSymbolProps {
  className?: string
}

/**
 * Work Agents "W" symbol - the small pixel art icon
 * Uses accent color from theme (currentColor from className)
 */
export function WorkAgentsSymbol({ className }: WorkAgentsSymbolProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2.5" y="3"  width="4" height="18" rx="1" fill="currentColor"/>
      <rect x="7.5" y="8"  width="4" height="13" rx="1" fill="currentColor"/>
      <rect x="12.5" y="8" width="4" height="13" rx="1" fill="currentColor"/>
      <rect x="17.5" y="3" width="4" height="18" rx="1" fill="currentColor"/>
      <rect x="2.5" y="17" width="19" height="4"  rx="1" fill="currentColor"/>
    </svg>
  )
}
