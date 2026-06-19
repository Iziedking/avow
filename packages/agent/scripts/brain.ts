// The agent's brain: Claude turns a plain-English instruction into a structured plan plus the
// reasoning behind it. The plan is what the agent executes on DeepBook; the reasoning is what
// Avow seals and proves. The rules come from the user's words, not from hardcoded caps: if you
// say "swap 1 SUI" the plan is capped at 1 SUI, if you say "don't spend above 5 USDC" that
// becomes a constraint the executor enforces and the proof records.
//
// Model: the cheapest Claude (Haiku). Needs ANTHROPIC_API_KEY in the environment (.env, gitignored).

import Anthropic from "@anthropic-ai/sdk";

export const TOKENS = ["SUI", "DEEP", "WAL", "DBUSDC", "DBUSDT", "DBTC"] as const;
export type Token = (typeof TOKENS)[number];

// What the agent can do on DeepBook. Kept small and explicit so the plan is auditable.
export type ActionKind = "swap" | "limit_order" | "deposit" | "withdraw" | "cancel_all" | "hold";

export interface PlanStep {
  action: ActionKind;
  fromToken?: Token | null; // swap: pay this
  toToken?: Token | null; // swap: receive this
  amount?: number | null; // human units (e.g. 1.5 SUI), never base units
  pool?: string | null; // limit_order/cancel_all: e.g. "SUI_DBUSDC"
  side?: "buy" | "sell" | null; // limit_order
  price?: number | null; // limit_order: quote per base
  coin?: Token | null; // deposit/withdraw
  why: string; // one line, in plain words
}

export interface ReasoningStep {
  kind: "observe" | "think" | "tool" | "decide";
  title: string;
  detail?: string | null;
}

export interface Plan {
  reply: string; // one or two friendly sentences spoken to the user (the agent talking back)
  understanding: string; // what the user wants, in plain words
  constraints: {
    summary: string; // the rule taken from the instruction
    maxSpend?: number | null; // the most the user authorized to spend
    spendToken?: Token | null; // ...denominated in this token
  };
  steps: PlanStep[];
  reasoning: { goal: string; steps: ReasoningStep[]; outcome: string };
  remember?: string | null; // a fact worth saving to memory (e.g. "opened a WAL position at 0.71")
}

// Market + wallet context handed to the model so it reasons over real numbers.
export interface MarketState {
  balances: Record<string, number>; // token -> human amount the agent holds
  prices: Record<string, number>; // poolKey -> mid price (quote per base)
  pools: string[]; // tradeable pools
  memory: string[]; // what the agent remembers doing for this user (Walrus via MemWal)
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "understanding", "constraints", "steps", "reasoning"],
  properties: {
    reply: { type: "string", description: "One or two friendly sentences spoken to the user. Explain what you are doing and why, reference what you remember when relevant, and if you cannot act, say why and suggest an alternative or ask a question. Never a dead end." },
    remember: { type: "string", description: "A short fact worth saving to memory for next time, e.g. 'Opened a 0.3 WAL position at 0.71 SUI.' Omit if nothing is worth remembering." },
    understanding: { type: "string", description: "What the user wants, in plain words." },
    constraints: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "The rule taken from the instruction, e.g. 'exactly 1 SUI, no more'." },
        maxSpend: { type: "number", description: "The most the user authorized to spend, in token units. Omit if unbounded." },
        spendToken: { type: "string", enum: TOKENS as unknown as string[], description: "Token the maxSpend is denominated in." },
      },
    },
    steps: {
      type: "array",
      description: "The concrete actions to take, in order. Empty or a single 'hold' if nothing should be done.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "why"],
        properties: {
          action: { type: "string", enum: ["swap", "limit_order", "deposit", "withdraw", "cancel_all", "hold"] },
          fromToken: { type: "string", enum: TOKENS as unknown as string[] },
          toToken: { type: "string", enum: TOKENS as unknown as string[] },
          amount: { type: "number", description: "Human units (1.5 = 1.5 SUI), never base units." },
          pool: { type: "string", description: "For limit_order/cancel_all, e.g. SUI_DBUSDC." },
          side: { type: "string", enum: ["buy", "sell"] },
          price: { type: "number", description: "For limit_order: quote per base." },
          coin: { type: "string", enum: TOKENS as unknown as string[] },
          why: { type: "string", description: "One line, plain words." },
        },
      },
    },
    reasoning: {
      type: "object",
      additionalProperties: false,
      required: ["goal", "steps", "outcome"],
      properties: {
        goal: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "title"],
            properties: {
              kind: { type: "string", enum: ["observe", "think", "tool", "decide"] },
              title: { type: "string" },
              detail: { type: "string" },
            },
          },
        },
        outcome: { type: "string" },
      },
    },
  },
} as const;

const SYSTEM = `You are a DeepBook trading agent on Sui testnet. You execute a user's instruction
precisely and never exceed what they asked for.

Rules:
- The user's words are the rules. "swap 1 SUI to USDC" means swap exactly 1 SUI, no more. "buy SUI,
  don't spend above 5 USDC" means cap total spend at 5 USDC. Put the limit in constraints.maxSpend.
- Only act on what was asked. If the instruction is unclear or unsafe, return a single "hold" step
  explaining why, and do not invent trades.
- Amounts are in human units (1.5 = 1.5 SUI), never base units.
- A "swap" is a market swap (immediate). A "limit_order" rests on the book at a price you set
  (this is how you provide liquidity). "deposit"/"withdraw" move funds in or out of the trading
  vault that limit orders use. "cancel_all" cancels your resting orders on a pool.
- Token symbols: SUI, DEEP, WAL, DBUSDC (USD stablecoin), DBUSDT, DBTC. "USDC"/"stablecoin"/"USD"
  means DBUSDC. "BTC" means DBTC.
- Reason over the real balances and prices you are given. Record your reasoning as ordered steps:
  observe (what you read), think (what you weighed), tool (a quote or check), decide (the action).
- Keep every "why" and reasoning line to one plain sentence. No jargon a non-developer can't read.

You have MEMORY of what you did before for this user (listed below). Use it to build over time:
- For "sell for profit", "take profit", or "close my position", recall what you bought and at what
  price, compare to the current price, and only sell if it is genuinely up; if it is not yet in
  profit, do not sell, explain that in the reply, and hold.
- When you open a position, set "remember" to a short note (token, amount, price) so you can act on
  it later. When you close one, remember that too.
- Reference what you remember in your reasoning and your reply ("you're holding 0.3 WAL from 0.71").

Always set "reply": talk to the user like a person. Say what you are doing and why, mention the
remembered position when relevant, and if you cannot do something (an untradeable token, a limit
already used up, nothing in profit yet), say so plainly and suggest an alternative or ask a
question. Never leave them with a dead end.

Call submit_plan exactly once with your plan.`;

function buildUserMessage(instruction: string, state: MarketState): string {
  const bal = Object.entries(state.balances)
    .map(([t, a]) => `${t}: ${a}`)
    .join(", ");
  const px = Object.entries(state.prices)
    .map(([p, v]) => `${p} mid ${v}`)
    .join(", ");
  const mem = state.memory.length ? state.memory.map((m) => `- ${m}`).join("\n") : "(nothing yet)";
  return [
    `Instruction: "${instruction}"`,
    ``,
    `Your wallet balances: ${bal || "(none)"}`,
    `DeepBook prices: ${px || "(none read)"}`,
    `Tradeable pools: ${state.pools.join(", ")}`,
    ``,
    `What you remember doing for this user:`,
    mem,
    ``,
    `Produce the plan. Honor the instruction exactly, stay within any limit it states, and use your`,
    `memory: for "sell for profit" recall what you bought and only sell if it is actually up.`,
  ].join("\n");
}

/** Turn a plain-English instruction + live market state into a structured, provable plan. */
export async function makePlan(instruction: string, state: MarketState): Promise<Plan> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const res = await client.messages.create({
    model: process.env.AVOW_LLM_MODEL ?? "claude-haiku-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    tools: [{ name: "submit_plan", description: "Submit the trading plan and its reasoning.", input_schema: PLAN_SCHEMA as never }],
    tool_choice: { type: "tool", name: "submit_plan" },
    messages: [{ role: "user", content: buildUserMessage(instruction, state) }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("the model did not return a plan");
  return block.input as Plan;
}

export function hasLLMKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
