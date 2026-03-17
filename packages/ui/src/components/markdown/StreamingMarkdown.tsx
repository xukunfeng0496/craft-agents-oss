import * as React from 'react'

import { Markdown, type RenderMode } from './Markdown'
import {
  appendStreamingContent,
  createStreamingBlocksState,
  getStreamingBlocks,
  splitIntoBlocks,
  type StreamingBlocksState,
} from './streaming-blocks'

interface StreamingMarkdownProps {
  content: string
  isStreaming: boolean
  mode?: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}

function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

const MemoizedBlock = React.memo(function Block({
  content,
  mode,
  onUrlClick,
  onFileClick,
}: {
  content: string
  mode: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}) {
  return (
    <Markdown mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
      {content}
    </Markdown>
  )
}, (prev, next) => prev.content === next.content && prev.mode === next.mode)

MemoizedBlock.displayName = 'MemoizedBlock'

export function StreamingMarkdown({
  content,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
}: StreamingMarkdownProps) {
  const streamingStateRef = React.useRef<{
    content: string
    state: StreamingBlocksState
  } | null>(null)

  const blocks = React.useMemo(() => {
    if (!isStreaming) {
      streamingStateRef.current = null
      return []
    }

    const cached = streamingStateRef.current
    if (!cached || !content.startsWith(cached.content)) {
      const state = createStreamingBlocksState()
      appendStreamingContent(state, content)
      streamingStateRef.current = { content, state }
      return getStreamingBlocks(state)
    }

    if (content.length === cached.content.length) {
      return getStreamingBlocks(cached.state)
    }

    appendStreamingContent(cached.state, content.slice(cached.content.length))
    cached.content = content
    return getStreamingBlocks(cached.state)
  }, [content, isStreaming])

  if (!isStreaming) {
    return (
      <Markdown mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
        {content}
      </Markdown>
    )
  }

  return (
    <>
      {blocks.map((block, i) => {
        const isLastBlock = i === blocks.length - 1
        const key = isLastBlock ? `active-${i}` : `block-${simpleHash(block.content)}`

        return (
          <MemoizedBlock
            key={key}
            content={block.content}
            mode={mode}
            onUrlClick={onUrlClick}
            onFileClick={onFileClick}
          />
        )
      })}
    </>
  )
}
