import type { Message, StoredAttachment } from '../shared/types'

function formatAttachmentForRecovery(attachment: StoredAttachment): string {
  let pathInfo = `[Attached file: ${attachment.name}]`
  pathInfo += `\n[Stored at: ${attachment.storedPath}]`
  if (attachment.markdownPath) {
    pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`
  }
  return pathInfo
}

export function formatMessageForRecoveryContext(
  message: Pick<Message, 'role' | 'content' | 'attachments'>
): string {
  const parts: string[] = []
  const trimmedContent = message.content.trim()

  if (trimmedContent) {
    parts.push(trimmedContent)
  }

  if (message.role === 'user' && message.attachments?.length) {
    parts.push(...message.attachments.map(formatAttachmentForRecovery))
  }

  return parts.join('\n\n')
}
