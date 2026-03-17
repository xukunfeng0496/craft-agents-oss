import type { Message } from '../shared/types'

import { formatMessageForRecoveryContext } from './session-recovery-format'

type RecoveryContextMessage = Pick<Message, 'role' | 'content' | 'attachments' | 'isIntermediate'>

export function buildRecoveryMessages(
  messages: RecoveryContextMessage[],
): Array<{ type: 'user' | 'assistant'; content: string }> {
  const relevantMessages = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && !message.isIntermediate)

  // The current in-flight user turn is added to managed.messages before chat() starts.
  // Exclude that trailing user message so recovery context contains prior history only.
  const historyMessages = relevantMessages.at(-1)?.role === 'user'
    ? relevantMessages.slice(0, -1)
    : relevantMessages

  return historyMessages
    .slice(-6)
    .map((message) => ({
      type: message.role as 'user' | 'assistant',
      content: formatMessageForRecoveryContext(message),
    }))
    .filter((message) => message.content.length > 0)
}
