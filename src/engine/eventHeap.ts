/**
 * Min-heap of future events ordered by simulated time. Events scheduled for
 * the same time come out in the order they were pushed, which keeps Runs
 * deterministic.
 */
interface Entry<T> {
  time: number
  order: number
  event: T
}

export class EventHeap<T> {
  private entries: Entry<T>[] = []
  private pushed = 0

  get size(): number {
    return this.entries.length
  }

  push(time: number, event: T): void {
    this.entries.push({ time, order: this.pushed++, event })
    this.siftUp(this.entries.length - 1)
  }

  peekTime(): number | undefined {
    return this.entries[0]?.time
  }

  pop(): { time: number; event: T } | undefined {
    const top = this.entries[0]
    if (!top) return undefined
    const last = this.entries.pop()!
    if (this.entries.length > 0) {
      this.entries[0] = last
      this.siftDown(0)
    }
    return { time: top.time, event: top.event }
  }

  private before(a: Entry<T>, b: Entry<T>): boolean {
    return a.time < b.time || (a.time === b.time && a.order < b.order)
  }

  private siftUp(index: number): void {
    const entries = this.entries
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!this.before(entries[index]!, entries[parent]!)) return
      ;[entries[index], entries[parent]] = [entries[parent]!, entries[index]!]
      index = parent
    }
  }

  private siftDown(index: number): void {
    const entries = this.entries
    const length = entries.length
    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < length && this.before(entries[left]!, entries[smallest]!)) smallest = left
      if (right < length && this.before(entries[right]!, entries[smallest]!)) smallest = right
      if (smallest === index) return
      ;[entries[index], entries[smallest]] = [entries[smallest]!, entries[index]!]
      index = smallest
    }
  }
}
