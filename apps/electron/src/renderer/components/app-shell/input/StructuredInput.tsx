import type { PermissionRequest as PermissionRequestType, CredentialRequest as CredentialRequestType, UserQuestionRequest as UserQuestionRequestType } from '../../../../shared/types'
import { PermissionRequest } from './structured/PermissionRequest'
import { CredentialRequest } from './structured/CredentialRequest'
import { UserQuestionRequest } from './structured/UserQuestionRequest'
import type { StructuredInputState, StructuredResponse } from './structured/types'

interface StructuredInputProps {
  state: StructuredInputState
  onResponse: (response: StructuredResponse) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * StructuredInput - Router component for structured input UIs
 *
 * Routes to the appropriate component based on the input type:
 * - permission: PermissionRequest (bash command approval)
 * - credential: CredentialRequest (secure auth input)
 * - user_question: UserQuestionRequest (agent asking user questions)
 */
export function StructuredInput({ state, onResponse, unstyled = false }: StructuredInputProps) {
  switch (state.type) {
    case 'permission':
      return (
        <PermissionRequest
          request={state.data as PermissionRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'credential':
      return (
        <CredentialRequest
          request={state.data as CredentialRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'user_question':
      return (
        <UserQuestionRequest
          request={state.data as UserQuestionRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    default:
      return null
  }
}
