import { describe, expect, it } from 'bun:test'

import { splitIntoBlocks } from '../streaming-blocks'

describe('splitIntoBlocks', () => {
  it('splits paragraphs and fenced code blocks consistently for append-only content', () => {
    const base = 'Hello\nworld'
    expect(splitIntoBlocks(base)).toEqual([
      { content: 'Hello\nworld', isCodeBlock: false },
    ])

    const withParagraphBreak = `${base}\n\nSecond paragraph`
    expect(splitIntoBlocks(withParagraphBreak)).toEqual([
      { content: 'Hello\nworld', isCodeBlock: false },
      { content: 'Second paragraph', isCodeBlock: false },
    ])

    const withOpenFence = `${withParagraphBreak}\n\n\`\`\`ts\nconst answer = 42`
    expect(splitIntoBlocks(withOpenFence)).toEqual([
      { content: 'Hello\nworld', isCodeBlock: false },
      { content: 'Second paragraph', isCodeBlock: false },
      { content: '```ts\nconst answer = 42', isCodeBlock: true },
    ])

    const withClosedFence = `${withOpenFence}\n\`\`\``
    expect(splitIntoBlocks(withClosedFence)).toEqual([
      { content: 'Hello\nworld', isCodeBlock: false },
      { content: 'Second paragraph', isCodeBlock: false },
      { content: '```ts\nconst answer = 42\n```', isCodeBlock: true },
    ])
  })

  it('keeps trailing partial lines in the active block', () => {
    expect(splitIntoBlocks('alpha\nbet')).toEqual([
      { content: 'alpha\nbet', isCodeBlock: false },
    ])

    expect(splitIntoBlocks('```js\nconst value = 1')).toEqual([
      { content: '```js\nconst value = 1', isCodeBlock: true },
    ])
  })
})
