export interface InlineMenuSurfaceOptions<T> {
  className?: string
  onSelect: (item: T) => void
  render: (container: HTMLElement, items: T[], selectedIndex: number) => void
}

export class InlineMenuSurface<T> {
  private readonly element: HTMLDivElement
  private readonly options: InlineMenuSurfaceOptions<T>
  private items: T[] = []
  private selectedIndex = 0

  constructor(options: InlineMenuSurfaceOptions<T>) {
    this.options = options
    this.element = document.createElement('div')
    if (options.className) {
      this.element.className = options.className
    }
    this.element.style.position = 'fixed'
    this.element.style.zIndex = '9999'
    this.element.addEventListener('mousedown', this.handleMouseDown)
  }

  mount() {
    document.body.appendChild(this.element)
  }

  update(items: T[], selectedIndex: number = this.selectedIndex) {
    this.items = items
    this.selectedIndex = this.normalizeSelectedIndex(selectedIndex)
    this.options.render(this.element, this.items, this.selectedIndex)
  }

  moveSelection(delta: number) {
    this.update(this.items, this.selectedIndex + delta)
  }

  getSelectedItem(): T | undefined {
    return this.items[this.selectedIndex]
  }

  setPosition(top: number, left: number) {
    this.element.style.top = `${Math.round(top)}px`
    this.element.style.left = `${Math.round(left)}px`
  }

  destroy() {
    this.element.removeEventListener('mousedown', this.handleMouseDown)
    this.element.remove()
  }

  private normalizeSelectedIndex(index: number): number {
    if (this.items.length === 0) return 0
    if (index < 0) return this.items.length - 1
    if (index >= this.items.length) return 0
    return index
  }

  private handleMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const row = target?.closest<HTMLElement>('[data-index]')
    if (!row) return

    const index = Number.parseInt(row.dataset.index ?? '', 10)
    if (!Number.isFinite(index)) return

    const item = this.items[index]
    if (!item) return

    event.preventDefault()
    this.options.onSelect(item)
  }
}
