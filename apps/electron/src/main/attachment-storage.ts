import { nativeImage } from 'electron'
import { copyFile, readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { isAbsolute } from 'path'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Worker } from 'worker_threads'

import type { FileAttachment, StoredAttachment } from '../shared/types'
import { validateImageForClaudeAPI, IMAGE_LIMITS } from '@work-agent/shared/utils'
import { getSessionAttachmentsPath, validateSessionId } from '@work-agent/shared/sessions'

interface AttachmentLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export interface StoreAttachmentOptions {
  workspaceRootPath: string
  sessionId: string
  attachment: FileAttachment
  logger: AttachmentLogger
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200)
    || 'unnamed'
}

// XLSX.readFile inside markitdown-js is synchronous; run in a worker to avoid blocking.
async function convertOfficeInWorker(filePath: string, timeoutMs = 30000): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      async function run() {
        try {
          const { MarkItDown } = require('markitdown-js');
          const result = await new MarkItDown().convert(workerData.filePath);
          parentPort.postMessage({ textContent: result?.textContent ?? null });
        } catch (err) {
          parentPort.postMessage({ error: err.message });
        }
      }
      run();
    `

    const worker = new Worker(workerCode, { eval: true, workerData: { filePath } })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`Office conversion timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    worker.on('message', (msg: { textContent?: string | null; error?: string }) => {
      clearTimeout(timer)
      if (msg.error) reject(new Error(msg.error))
      else resolve(msg.textContent ?? null)
    })
    worker.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`))
    })
  })
}

export async function storeAttachmentOnDisk({
  workspaceRootPath,
  sessionId,
  attachment,
  logger,
}: StoreAttachmentOptions): Promise<StoredAttachment> {
  const filesToCleanup: string[] = []

  try {
    if (attachment.size === 0) {
      throw new Error('Cannot attach empty file')
    }

    validateSessionId(sessionId)

    const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
    await mkdir(attachmentsDir, { recursive: true })

    const id = randomUUID()
    const safeName = sanitizeFilename(attachment.name)
    const storedFileName = `${id}_${safeName}`
    const storedPath = join(attachmentsDir, storedFileName)

    let wasResized = false
    let finalSize = attachment.size
    let resizedBase64: string | undefined
    let inlineBase64: string | undefined

    const writeBinaryAttachment = async (decoded: Buffer) => {
      if (Math.abs(decoded.length - attachment.size) > 100) {
        throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
      }

      if (attachment.type === 'image') {
        const image = nativeImage.createFromBuffer(decoded)
        const imageSize = image.getSize()
        const validation = validateImageForClaudeAPI(decoded.length, imageSize.width, imageSize.height)

        let shouldResize = validation.needsResize
        let targetSize = validation.suggestedSize

        if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
          const maxDim = IMAGE_LIMITS.MAX_DIMENSION
          const scale = Math.min(maxDim / imageSize.width, maxDim / imageSize.height)
          targetSize = {
            width: Math.floor(imageSize.width * scale),
            height: Math.floor(imageSize.height * scale),
          }
          shouldResize = true
          logger.info(`Image exceeds ${maxDim}px limit (${imageSize.width}x${imageSize.height}), will resize to ${targetSize.width}x${targetSize.height}`)
        } else if (!validation.valid) {
          throw new Error(validation.error)
        }

        if (shouldResize && targetSize) {
          logger.info(`Resizing image from ${imageSize.width}x${imageSize.height} to ${targetSize.width}x${targetSize.height}`)

          const resized = image.resize({
            width: targetSize.width,
            height: targetSize.height,
            quality: 'best',
          })

          const isPhoto = attachment.mimeType === 'image/jpeg'
          decoded = isPhoto ? resized.toJPEG(90) : resized.toPNG()
          wasResized = true
          finalSize = decoded.length

          if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
            decoded = resized.toJPEG(75)
            finalSize = decoded.length
            if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
              throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
            }
          }

          logger.info(`Image resized: ${attachment.size} -> ${finalSize} bytes (${Math.round((1 - finalSize / attachment.size) * 100)}% reduction)`)
          resizedBase64 = decoded.toString('base64')
        } else {
          inlineBase64 = decoded.toString('base64')
        }
      } else if (attachment.type === 'pdf') {
        inlineBase64 = decoded.toString('base64')
      }

      await writeFile(storedPath, decoded)
      filesToCleanup.push(storedPath)
    }

    if (attachment.base64) {
      await writeBinaryAttachment(Buffer.from(attachment.base64, 'base64'))
    } else if (attachment.text) {
      await writeFile(storedPath, attachment.text, 'utf-8')
      filesToCleanup.push(storedPath)
    } else if (attachment.path && isAbsolute(attachment.path) && existsSync(attachment.path)) {
      if (attachment.type === 'image' || attachment.type === 'pdf') {
        await writeBinaryAttachment(await readFile(attachment.path))
      } else {
        await copyFile(attachment.path, storedPath)
        filesToCleanup.push(storedPath)
      }
    } else {
      throw new Error('Attachment has no content (neither base64, text, nor readable source path)')
    }

    let thumbnailPath: string | undefined
    let thumbnailBase64: string | undefined
    if (attachment.type !== 'office') {
      const thumbFileName = `${id}_thumb.png`
      const thumbPath = join(attachmentsDir, thumbFileName)
      try {
        const thumbPromise = nativeImage.createThumbnailFromPath(storedPath, { width: 200, height: 200 })
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
        const thumbnail = await Promise.race([thumbPromise, timeoutPromise])
        if (thumbnail && !thumbnail.isEmpty()) {
          const pngBuffer = thumbnail.toPNG()
          await writeFile(thumbPath, pngBuffer)
          thumbnailPath = thumbPath
          thumbnailBase64 = pngBuffer.toString('base64')
          filesToCleanup.push(thumbPath)
        }
      } catch (thumbError) {
        logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }
    }

    let markdownPath: string | undefined
    if (attachment.type === 'office') {
      const mdFileName = `${id}_${safeName}.md`
      const mdPath = join(attachmentsDir, mdFileName)
      try {
        const textContent = await convertOfficeInWorker(storedPath)
        if (!textContent) {
          throw new Error('Conversion returned empty result')
        }
        await writeFile(mdPath, textContent, 'utf-8')
        markdownPath = mdPath
        filesToCleanup.push(mdPath)
        logger.info(`Converted Office file to markdown: ${mdPath}`)
      } catch (convertError) {
        const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
        logger.warn(`Office to markdown conversion failed for "${attachment.name}", storing as-is: ${errorMsg}`)
      }
    }

    return {
      id,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: finalSize,
      originalSize: wasResized ? attachment.size : undefined,
      storedPath,
      thumbnailPath,
      thumbnailBase64,
      markdownPath,
      wasResized,
      resizedBase64,
      inlineBase64,
    }
  } catch (error) {
    if (filesToCleanup.length > 0) {
      logger.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
      await Promise.all(filesToCleanup.map(filePath => unlink(filePath).catch(() => {})))
    }

    throw error
  }
}
