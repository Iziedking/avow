// A scripted testnet money layer for the live experiment.
//
// Same contract as LocalMoneyLayer, but the rate feed changes from one cycle to the next so
// the agent faces a realistic sequence of choices: chase a better yield, or hold because the
// gain does not clear the threshold. Each move still performs a real marker transaction so the
// evidence references a genuine on-chain digest.

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type {
  MoneyLayer,
  Observation,
  Decision,
  ExecutionResult,
  Position,
  RateQuote,
} from "./money";

export class ScenarioMoneyLayer implements MoneyLayer {
  readonly name = "local-testnet";
  private current: Position;
  private step = 0;

  constructor(
    private readonly sui: SuiJsonRpcClient,
    private readonly signer: Signer,
    private readonly address: string,
    start: Position,
    private readonly schedule: RateQuote[][],
  ) {
    this.current = start;
  }

  async observe(): Promise<Observation> {
    const rates = this.schedule[Math.min(this.step, this.schedule.length - 1)];
    return { asOfMs: Date.now(), rates, current: this.current };
  }

  async execute(decision: Decision): Promise<ExecutionResult> {
    // A real but tiny marker transaction, so the evidence carries a genuine digest.
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [1]);
    tx.transferObjects([coin], this.address);
    const r = await this.sui.signAndExecuteTransaction({ transaction: tx, signer: this.signer });

    const before = this.current;
    const after: Position = { target: decision.toTarget, amount: decision.amount };
    this.current = after;
    return { txDigests: [r.digest], before, after };
  }

  /** Move the rate feed to the next cycle. */
  advance(): void {
    this.step += 1;
  }
}
