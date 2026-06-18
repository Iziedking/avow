// A local testnet money layer.
//
// It observes a small set of rates and, when the policy decides to move, performs a real but
// tiny on-chain marker transaction so the evidence bundle references a genuine digest. A
// production layer (t2000 on mainnet, gasless USDC and Cetus swaps) implements the same
// interface and performs the actual transfer in execute().

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { MoneyLayer, Observation, Decision, ExecutionResult, Position } from "./money";

export class LocalMoneyLayer implements MoneyLayer {
  readonly name = "local-testnet";
  private current: Position;

  constructor(
    private readonly sui: SuiJsonRpcClient,
    private readonly signer: Signer,
    private readonly address: string,
    start: Position,
  ) {
    this.current = start;
  }

  async observe(): Promise<Observation> {
    return {
      asOfMs: Date.now(),
      rates: [
        { target: "navi", apyBps: 530, riskBps: 25 },
        { target: "scallop", apyBps: 415, riskBps: 60 },
        { target: "idle", apyBps: 0, riskBps: 0 },
      ],
      current: this.current,
    };
  }

  async execute(decision: Decision): Promise<ExecutionResult> {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [1]);
    tx.transferObjects([coin], this.address);
    const r = await this.sui.signAndExecuteTransaction({ transaction: tx, signer: this.signer });

    const before = this.current;
    const after: Position = { target: decision.toTarget, amount: decision.amount };
    this.current = after;
    return { txDigests: [r.digest], before, after };
  }
}
