import * as React from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'

const CURRENCY_PLACEHOLDER = '¤'
const MERMAID_FILE_RE = /\.(mmd|mermaid)$/i
const MERMAID_FENCE_RE = /^\s*```mermaid\s*\n([\s\S]*?)\n```\s*$/i
const MERMAID_DIRECTIVE_RE = /^\s*%%\{[\s\S]*?\}%%/
const MERMAID_KEYWORD_RE = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|block-beta|packet-beta|architecture)\b/m

function getMarkdown(editor: Editor | null | undefined): string {
  return editor?.getMarkdown?.() ?? ''
}

export type MarkdownEngine = 'official'

export function preprocessMarkdownForOfficial(markdown: string): string {
  return markdown
    .replace(/\$\$([^\n]+?)\$\$/g, (_match, inner: string) => `$${inner.trim()}$`)
    .replace(/\$(?=\d)/g, CURRENCY_PLACEHOLDER)
}

export function postprocessMarkdownFromOfficial(markdown: string): string {
  return markdown.replaceAll(CURRENCY_PLACEHOLDER, '$')
}

export function isMermaidFilename(filename: string): boolean {
  return MERMAID_FILE_RE.test(filename)
}

export function extractMermaidSource(input: string): string | null {
  const fenced = input.match(MERMAID_FENCE_RE)?.[1]
  if (fenced) return fenced.trim()

  const normalized = input.trim()
  if (!normalized) return null
  if (MERMAID_DIRECTIVE_RE.test(normalized) || MERMAID_KEYWORD_RE.test(normalized)) {
    return normalized
  }

  return null
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes (debounced on blur or cmd+s) */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: preprocessMarkdownForOfficial(content),
    contentType: 'markdown',
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const md = postprocessMarkdownFromOfficial(getMarkdown(editor))
      onUpdateRef.current?.(md)
    },
  }, [])

  // Sync editable prop
  React.useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // Sync content when the selected task changes (key prop handles this,
  // but as a safety net for direct content prop changes)
  const prevContentRef = React.useRef(content)
  React.useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content
      const normalizedContent = preprocessMarkdownForOfficial(content)
      const currentMd = getMarkdown(editor)
      if (currentMd !== normalizedContent) {
        editor.commands.setContent(normalizedContent, { contentType: 'markdown' })
      }
    }
  }, [editor, content])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
    </div>
  )
}
