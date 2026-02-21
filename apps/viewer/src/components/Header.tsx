/**
 * Header - App header with branding and controls
 */

import { Sun, Moon, X } from 'lucide-react'

/**
 * WorkAgentLogo - The Work Agent "W" logo
 */
function WorkAgentLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
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

interface HeaderProps {
  hasSession: boolean
  sessionTitle?: string
  isDark: boolean
  onToggleTheme: () => void
  onClear: () => void
}

export function Header({ hasSession, sessionTitle, isDark, onToggleTheme, onClear }: HeaderProps) {
  return (
    <header className="shrink-0 grid grid-cols-[auto_1fr_auto] items-center px-4 py-3">
      {/* Logo - links to main site */}
      <a
        href="https://agents.craft.do"
        className="hover:opacity-80 transition-opacity"
        title="Work Agent"
      >
        <WorkAgentLogo className="w-6 h-6 text-[#1E5C35]" />
      </a>

      {/* Session title - centered */}
      <div className="flex justify-center">
        {sessionTitle && (
          <span className="text-sm font-semibold text-foreground truncate max-w-md">
            {sessionTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Clear button (when session is loaded) */}
        {hasSession && (
          <button
            onClick={onClear}
            className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
            title="Clear session"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  )
}
