// The money layer the agent acts through.
//
// Avow is a trust layer, not a money mover, so the agent talks to whatever moves funds
// behind this interface. A local testnet layer implements it here; a mainnet layer over
// t2000 (gasless USDC, Cetus swaps) implements the same interface without touching the agent
// loop or the proof layer. Swapping the money layer is how a different product plugs in.

export interface RateQuote {
  /** The target the rate belongs to, for example "navi". */
  target: string;
  /** Annual percentage yield in basis points. */
  apyBps: number;
  /** A risk score in basis points, subtracted from the yield and capped by the policy. */
  riskBps: number;
}

export interface Position {
  target: string;
  amount: string;
}

export interface Observation {
  asOfMs: number;
  rates: RateQuote[];
  current: Position;
}

export interface Decision {
  move: boolean;
  actionType: string;
  fromTarget: string;
  toTarget: string;
  amount: string;
  rationale: string;
  /** What the agent saw when it decided, recorded verbatim in the evidence. */
  observed: unknown;
}

export interface ExecutionResult {
  /** On-chain transaction digests of the actual move, for the evidence bundle. */
  txDigests: string[];
  before: Position;
  after: Position;
}

export interface MoneyLayer {
  /** A label for the evidence, for example "local-testnet" or "t2000-mainnet". */
  readonly name: string;
  observe(): Promise<Observation>;
  execute(decision: Decision): Promise<ExecutionResult>;
}
