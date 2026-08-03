export class UnknownGameTypeError extends Error {
  constructor(gameType: string) {
    super(`No Game Engine registered for game_type "${gameType}"`)
    this.name = 'UnknownGameTypeError'
  }
}

// Not thrown by the framework itself — available for a mode's own
// implementation to throw for a lifecycle method it hasn't built yet (e.g.
// Milestone 4 landing validateEntry()/lockEntries() before calculateScore()
// is ready), so a half-built mode fails loudly and specifically rather than
// silently no-op-ing.
export class GameEngineNotImplementedError extends Error {
  constructor(gameType: string, method: string) {
    super(`${gameType} does not implement ${method}() yet`)
    this.name = 'GameEngineNotImplementedError'
  }
}
