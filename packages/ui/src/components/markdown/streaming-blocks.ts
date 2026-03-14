export interface StreamingMarkdownBlock {
  content: string
  isCodeBlock: boolean
}

export interface StreamingBlocksState {
  blocks: StreamingMarkdownBlock[]
  currentBlock: string
  inCodeBlock: boolean
  trailingFragment: string
}

export function createStreamingBlocksState(): StreamingBlocksState {
  return {
    blocks: [],
    currentBlock: '',
    inCodeBlock: false,
    trailingFragment: '',
  }
}

function processStreamingLine(state: StreamingBlocksState, line: string): void {
  if (line.startsWith('```')) {
    if (!state.inCodeBlock) {
      if (state.currentBlock.trim()) {
        state.blocks.push({ content: state.currentBlock.trim(), isCodeBlock: false })
        state.currentBlock = ''
      }
      state.inCodeBlock = true
      state.currentBlock = `${line}\n`
      return
    }

    state.currentBlock += line
    state.blocks.push({ content: state.currentBlock, isCodeBlock: true })
    state.currentBlock = ''
    state.inCodeBlock = false
    return
  }

  if (state.inCodeBlock) {
    state.currentBlock += `${line}\n`
    return
  }

  if (line === '') {
    if (state.currentBlock.trim()) {
      state.blocks.push({ content: state.currentBlock.trim(), isCodeBlock: false })
      state.currentBlock = ''
    }
    return
  }

  if (state.currentBlock) {
    state.currentBlock += `\n${line}`
  } else {
    state.currentBlock = line
  }
}

export function appendStreamingContent(state: StreamingBlocksState, content: string): void {
  const combined = state.trailingFragment + content
  const lines = combined.split('\n')
  state.trailingFragment = lines.pop() ?? ''

  for (const line of lines) {
    processStreamingLine(state, line)
  }
}

export function getStreamingBlocks(state: StreamingBlocksState): StreamingMarkdownBlock[] {
  const blocks = [...state.blocks]
  let pendingContent = state.currentBlock

  if (state.trailingFragment) {
    if (state.inCodeBlock) {
      pendingContent += state.trailingFragment
    } else if (pendingContent) {
      pendingContent += `\n${state.trailingFragment}`
    } else {
      pendingContent = state.trailingFragment
    }
  }

  if (pendingContent) {
    blocks.push({
      content: state.inCodeBlock ? pendingContent : pendingContent.trim(),
      isCodeBlock: state.inCodeBlock,
    })
  }

  return blocks
}

export function splitIntoBlocks(content: string): StreamingMarkdownBlock[] {
  const state = createStreamingBlocksState()
  appendStreamingContent(state, content)
  return getStreamingBlocks(state)
}
