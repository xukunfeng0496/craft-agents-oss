import * as React from 'react'
import { MessageCircleQuestion, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { UserQuestion } from '@work-agent/core/types'
import { cn } from '../../lib/utils'

export interface UserQuestionCardProps {
  request: {
    requestId: string
    sessionId: string
    questions: UserQuestion[]
  }
  onSubmit: (requestId: string, answers: Record<string, string[]>) => void
  unstyled?: boolean
  onHeightChange?: (height: number) => void
}

const QUESTIONS_MAX_HEIGHT = 260

/**
 * UserQuestionCard - Shared UI for agent questions
 *
 * Collapsible panel with scrollable content. Supports single-select (radio)
 * and multi-select (checkbox) modes.
 *
 * Platform-agnostic: no i18n, no Electron-specific imports.
 * Used in both the Electron app and the remote viewer.
 */
export function UserQuestionCard({
  request,
  onSubmit,
  unstyled = false,
  onHeightChange,
}: UserQuestionCardProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const headerRef = React.useRef<HTMLButtonElement>(null)
  const questionsRef = React.useRef<HTMLDivElement>(null)
  const submitRef = React.useRef<HTMLDivElement>(null)

  // Track selections per question: questionIndex -> selected labels
  const [selections, setSelections] = React.useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {}
    for (let i = 0; i < request.questions.length; i++) {
      initial[String(i)] = new Set()
    }
    return initial
  })

  // Track "Other" text per question
  const [otherTexts, setOtherTexts] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (let i = 0; i < request.questions.length; i++) {
      initial[String(i)] = ''
    }
    return initial
  })

  const handleOptionToggle = (questionIdx: number, label: string, multiSelect: boolean) => {
    const key = String(questionIdx)
    setSelections(prev => {
      const next = { ...prev }
      const current = new Set(prev[key])

      if (multiSelect) {
        if (current.has(label)) {
          current.delete(label)
        } else {
          current.add(label)
        }
      } else {
        current.clear()
        current.add(label)
      }

      next[key] = current
      return next
    })
  }

  const handleSubmit = () => {
    const answers: Record<string, string[]> = {}
    for (let i = 0; i < request.questions.length; i++) {
      const key = String(i)
      const selected = selections[key] || new Set()
      const labels: string[] = []

      for (const label of selected) {
        if (label === '__other__') {
          const text = otherTexts[key]?.trim()
          if (text) labels.push(text)
        } else {
          labels.push(label)
        }
      }

      answers[key] = labels
    }

    onSubmit(request.requestId, answers)
  }

  // Check if at least one question has a selection
  const hasAnySelection = Object.values(selections).some(s => s.size > 0)

  const reportPreferredHeight = React.useCallback(() => {
    if (!onHeightChange || !rootRef.current || !headerRef.current) return

    const rootStyle = window.getComputedStyle(rootRef.current)
    const rootBorderHeight =
      (parseFloat(rootStyle.borderTopWidth) || 0) +
      (parseFloat(rootStyle.borderBottomWidth) || 0)

    let nextHeight = headerRef.current.offsetHeight + rootBorderHeight

    if (!collapsed) {
      if (questionsRef.current) {
        const questionsStyle = window.getComputedStyle(questionsRef.current)
        const questionsBorderHeight =
          (parseFloat(questionsStyle.borderTopWidth) || 0) +
          (parseFloat(questionsStyle.borderBottomWidth) || 0)

        nextHeight += Math.min(questionsRef.current.scrollHeight, QUESTIONS_MAX_HEIGHT) + questionsBorderHeight
      }

      if (submitRef.current) {
        nextHeight += submitRef.current.offsetHeight
      }
    }

    onHeightChange(Math.ceil(nextHeight))
  }, [collapsed, onHeightChange])

  React.useEffect(() => {
    reportPreferredHeight()
  }, [reportPreferredHeight, request.questions, selections, otherTexts])

  React.useEffect(() => {
    if (!onHeightChange) return

    const observer = new ResizeObserver(() => {
      reportPreferredHeight()
    })

    const elements = [rootRef.current, headerRef.current, questionsRef.current, submitRef.current]

    for (const element of elements) {
      if (element) {
        observer.observe(element)
      }
    }

    return () => observer.disconnect()
  }, [collapsed, onHeightChange, reportPreferredHeight])

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex h-full min-h-0 flex-col bg-accent/5',
        unstyled
          ? 'border-0'
          : 'border border-accent/30 rounded-[8px] shadow-middle'
      )}
    >
      {/* Header - always visible, click to collapse/expand */}
      <button
        ref={headerRef}
        type="button"
        className="flex shrink-0 items-center gap-2 px-4 py-2.5 w-full text-left hover:bg-accent/5 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <MessageCircleQuestion className="h-4 w-4 text-accent shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1">
          Agent has a question
        </span>
        {collapsed
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Collapsible content */}
      {!collapsed && (
        <>
          {/* Scrollable questions area */}
          <div
            ref={questionsRef}
            className="flex-1 min-h-0 px-4 pb-3 space-y-4 max-h-[260px] overflow-y-auto border-t border-border/30"
          >
            {request.questions.map((q, qIdx) => {
              const key = String(qIdx)
              const selected = selections[key] || new Set()

              return (
                <div key={qIdx} className="space-y-2 pt-3">
                  {/* Question header chip + text */}
                  <div className="space-y-1">
                    {q.header && (
                      <span className="inline-block text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                        {q.header}
                      </span>
                    )}
                    <p className="text-sm text-foreground">{q.question}</p>
                  </div>

                  {/* Options */}
                  <div className="space-y-1">
                    {q.options.map((opt) => {
                      const isSelected = selected.has(opt.label)
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-md border transition-colors',
                            isSelected
                              ? 'border-accent/50 bg-accent/10'
                              : 'border-border/50 hover:border-accent/30 hover:bg-accent/5'
                          )}
                          onClick={() => handleOptionToggle(qIdx, opt.label, q.multiSelect)}
                        >
                          <div className="flex items-start gap-2">
                            <div className={cn(
                              'mt-0.5 shrink-0 w-4 h-4 border flex items-center justify-center',
                              q.multiSelect ? 'rounded-sm' : 'rounded-full',
                              isSelected ? 'border-accent bg-accent text-white' : 'border-foreground/30'
                            )}>
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{opt.label}</div>
                              {opt.description && (
                                <div className="text-xs text-muted-foreground">{opt.description}</div>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}

                    {/* "Other" option */}
                    <button
                      type="button"
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-md border transition-colors',
                        selected.has('__other__')
                          ? 'border-accent/50 bg-accent/10'
                          : 'border-border/50 hover:border-accent/30 hover:bg-accent/5'
                      )}
                      onClick={() => handleOptionToggle(qIdx, '__other__', q.multiSelect)}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn(
                          'mt-0.5 shrink-0 w-4 h-4 border flex items-center justify-center',
                          q.multiSelect ? 'rounded-sm' : 'rounded-full',
                          selected.has('__other__') ? 'border-accent bg-accent text-white' : 'border-foreground/30'
                        )}>
                          {selected.has('__other__') && <Check className="h-3 w-3" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">Other</div>
                          {selected.has('__other__') && (
                            <input
                              type="text"
                              className="mt-1 w-full text-sm bg-transparent border-b border-foreground/20 focus:border-accent outline-none py-0.5 text-foreground placeholder:text-muted-foreground"
                              placeholder="Type your answer..."
                              value={otherTexts[key] || ''}
                              onChange={(e) => {
                                setOtherTexts(prev => ({ ...prev, [key]: e.target.value }))
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                            />
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Submit button */}
          <div ref={submitRef} className="flex shrink-0 items-center gap-2 px-3 py-2 border-t border-border/50">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:pointer-events-none disabled:opacity-50'
              )}
              onClick={handleSubmit}
              disabled={!hasAnySelection}
            >
              <Check className="h-3.5 w-3.5" />
              Submit
            </button>
          </div>
        </>
      )}
    </div>
  )
}
