import type { FileAttachment, StoredAttachment } from '../shared/types'
import { storeAttachmentOnDisk } from './attachment-storage'

interface AttachmentLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export interface RemoteAttachmentInput {
  type: string
  name: string
  mimeType: string
  base64?: string
  text?: string
  size: number
}

export interface RemoteAttachmentResult {
  attachments?: FileAttachment[]
  storedAttachments?: StoredAttachment[]
  droppedCount: number
}

const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES: ReadonlySet<string> = new Set(['image', 'pdf', 'text', 'office', 'unknown'])

export async function processRemoteAttachments(
  workspaceRootPath: string,
  sessionId: string,
  rawAttachments: RemoteAttachmentInput[] | undefined,
  logger: AttachmentLogger
): Promise<RemoteAttachmentResult> {
  if (!rawAttachments?.length) {
    return { droppedCount: 0 }
  }

  const validAttachments = rawAttachments
    .slice(0, MAX_ATTACHMENTS)
    .filter(a => ALLOWED_TYPES.has(a.type) && (a.size == null || a.size <= MAX_ATTACHMENT_SIZE))

  const droppedCount = rawAttachments.length - validAttachments.length

  const pairs = await Promise.all(validAttachments.map(async (a) => {
    const inputAttachment: FileAttachment = {
      type: a.type as FileAttachment['type'],
      path: '',
      name: a.name,
      mimeType: a.mimeType,
      base64: a.base64,
      text: a.text,
      size: a.size,
    }

    const stored = await storeAttachmentOnDisk({
      workspaceRootPath,
      sessionId,
      attachment: inputAttachment,
      logger,
    })

    const attachment: FileAttachment = {
      ...inputAttachment,
      path: stored.storedPath,
      storedPath: stored.storedPath,
      markdownPath: stored.markdownPath,
      base64: stored.resizedBase64 ?? inputAttachment.base64,
    }

    return { attachment, stored }
  }))

  return {
    attachments: pairs.map(pair => pair.attachment),
    storedAttachments: pairs.map(pair => pair.stored),
    droppedCount,
  }
}
