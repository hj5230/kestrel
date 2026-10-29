// Async work belongs to one selected host. Switching invalidates it before another host can publish state.
export class ConnectionGeneration {
  private value = 0
  capture() { return this.value }
  current(value: number) { return value === this.value }
  invalidate() { this.value++ }
}

export const connectionGeneration = new ConnectionGeneration()
