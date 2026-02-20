import * as React from 'react'
import { MessageCircleQuestion, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { UserQuestionRequest as UserQuestionRequestType } from '../../../../../shared/types'
import type { UserQuestionStructuredResponse } from './types'
import type { StructuredResponse } from './types'

interface UserQuestionRequestProps {
  request: UserQuestionRequestType
  onResponse: (response: StructuredResponse) => void
  unstyled?: boolean
}

/**
 * UserQuestionRequest - Structured input for agent questions
 *
 * Collapsible panel with scrollable content. Supports single-select (radio)
 * and multi-select (checkbox) modes.
 */
export function UserQuestionRequest({ request, onResponse, unstyled = false }: UserQuestionRequestProps) {
  const { t } = useTranslation(['common'])
  const [collapsed, setCollapsed] = React.useState(false)

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

    onResponse({
      type: 'user_question',
      sessionId: request.sessionId,
      requestId: request.requestId,
      answers,
    } as UserQuestionStructuredResponse)
  }

  // Check if at least one question has a selection
  const hasAnySelection = Object.values(selections).some(s => s.size > 0)

  return (
    <div
      className={cn(
        'flex flex-col bg-accent/5',
        unstyled
          ? 'border-0'
          : 'border border-accent/30 rounded-[8px] shadow-middle'
      )}
    >
      {/* Header - always visible, click to collapse/expand */}
      <button
        type="button"
        className="flex items-center gap-2 px-4 py-2.5 w-full text-left hover:bg-accent/5 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <MessageCircleQuestion className="h-4 w-4 text-accent shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1">
          {t('common:userQuestion.title', 'Agent has a question')}
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
          <div className="px-4 pb-3 space-y-4 max-h-[260px] overflow-y-auto border-t border-border/30">
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
                          <div className="text-sm font-medium text-foreground">
                            {t('common:userQuestion.other', 'Other')}
                          </div>
                          {selected.has('__other__') && (
                            <input
                              type="text"
                              className="mt-1 w-full text-sm bg-transparent border-b border-foreground/20 focus:border-accent outline-none py-0.5 text-foreground placeholder:text-muted-foreground"
                              placeholder={t('common:userQuestion.otherPlaceholder', 'Type your answer...')}
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
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={handleSubmit}
              disabled={!hasAnySelection}
            >
              <Check className="h-3.5 w-3.5" />
              {t('common:userQuestion.submit', 'Submit')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
