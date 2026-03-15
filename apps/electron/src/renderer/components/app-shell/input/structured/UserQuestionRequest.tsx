import { useCallback } from 'react'
import { UserQuestionCard } from '@work-agent/ui'
import type { UserQuestionRequest as UserQuestionRequestType } from '../../../../../shared/types'
import type { UserQuestionStructuredResponse } from './types'
import type { StructuredResponse } from './types'

interface UserQuestionRequestProps {
  request: UserQuestionRequestType
  onResponse: (response: StructuredResponse) => void
  unstyled?: boolean
  onHeightChange?: (height: number) => void
}

/**
 * UserQuestionRequest - Structured input for agent questions
 *
 * Thin wrapper around the shared UserQuestionCard component that adapts
 * the Electron onResponse callback signature.
 */
export function UserQuestionRequest({
  request,
  onResponse,
  unstyled = false,
  onHeightChange,
}: UserQuestionRequestProps) {
  const handleSubmit = useCallback((requestId: string, answers: Record<string, string[]>) => {
    onResponse({
      type: 'user_question',
      sessionId: request.sessionId,
      requestId,
      answers,
    } as UserQuestionStructuredResponse)
  }, [request.sessionId, onResponse])

  return (
    <UserQuestionCard
      request={request}
      onSubmit={handleSubmit}
      unstyled={unstyled}
      onHeightChange={onHeightChange}
    />
  )
}
