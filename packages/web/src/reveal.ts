// Format the data an agent recorded that it saw, decrypted from the evidence, as readable lines.
export function describeObserved(observed: unknown): string[] {
  if (Array.isArray(observed)) {
    return observed.map((o) => {
      if (o && typeof o === "object" && "target" in o && "apyBps" in o) {
        const r = o as { target: string; apyBps: number };
        return `${r.target}: ${(r.apyBps / 100).toFixed(2)}%`;
      }
      return JSON.stringify(o);
    });
  }
  if (observed && typeof observed === "object") {
    const rates = (observed as { rates?: unknown }).rates;
    if (Array.isArray(rates)) return describeObserved(rates);
    return Object.entries(observed as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    );
  }
  return [];
}
