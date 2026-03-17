import type { FileAttachment, StoredAttachment } from '../shared/types'
import type { RemoteAttachmentInput, RemoteAttachmentResult } from './remote-attachments'

interface RemoteMessageLogger {
  warn: (...args: unknown[]) => void
}

interface HandleRemoteSendMessageOptions {
  sessionId: string
  workspaceRootPath: string
  content: string
  rawAttachments?: RemoteAttachmentInput[]
  logger: RemoteMessageLogger
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[]
  ) => Promise<void>
  processAttachments?: (
    workspaceRootPath: string,
    sessionId: string,
    rawAttachments: RemoteAttachmentInput[] | undefined,
    logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }
  ) => Promise<RemoteAttachmentResult>
}

export async function handleRemoteSendMessage({
  sessionId,
  workspaceRootPath,
  content,
  rawAttachments,
  logger,
  sendMessage,
  processAttachments,
}: HandleRemoteSendMessageOptions): Promise<void> {
  if (!content) {
    return
  }

  let attachments: FileAttachment[] | undefined
  let storedAttachments: StoredAttachment[] | undefined

  if (rawAttachments?.length) {
    const runProcessAttachments =
      processAttachments ??
      (await import('./remote-attachments')).processRemoteAttachments

    const processed = await runProcessAttachments(
      workspaceRootPath,
      sessionId,
      rawAttachments,
      {
        info: () => {},
        warn: (...args) => logger.warn(...args),
      },
    )

    if (processed.droppedCount > 0) {
      logger.warn(`[RemoteControl] Dropped ${processed.droppedCount} invalid/oversized attachments for session ${sessionId}`)
    }

    attachments = processed.attachments
    storedAttachments = processed.storedAttachments
  }

  await sendMessage(sessionId, content, attachments, storedAttachments)
}
