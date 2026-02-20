import type { PermissionRequest, CredentialRequest, CredentialResponse, UserQuestionRequest, UserQuestionResponse } from '../../../../../shared/types'

/**
 * Input mode determines which component is rendered in InputContainer
 */
export type InputMode = 'freeform' | 'structured'

/**
 * Types of structured input UIs
 */
export type StructuredInputType = 'permission' | 'credential' | 'user_question'

/**
 * Union type for structured input data
 */
export type StructuredInputData =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'credential'; data: CredentialRequest }
  | { type: 'user_question'; data: UserQuestionRequest }

/**
 * State for structured input
 */
export interface StructuredInputState {
  type: StructuredInputType
  data: PermissionRequest | CredentialRequest | UserQuestionRequest
}

/**
 * Response from permission request
 */
export interface PermissionResponse {
  type: 'permission'
  allowed: boolean
  alwaysAllow: boolean
}

/**
 * Response from user question request
 */
export interface UserQuestionStructuredResponse {
  type: 'user_question'
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse = PermissionResponse | CredentialResponse | UserQuestionStructuredResponse

// Re-export CredentialResponse for convenience
export type { CredentialResponse, UserQuestionResponse }
