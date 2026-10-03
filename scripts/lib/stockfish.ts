// Stockfish (lite WASM) in Node for offline analysis scripts. Same engine build as the viewer.
import { createRequire } from "node:module";
import type { Analysis, Evaluation, Line } from "../../web/src/eval";

const require = createRequire(import.meta.url);

export class NodeStockfish {
  private engine!: { sendCommand(c: string): void; listener?: (l: string) => void };
  private chain: Promise<unknown> = Promise.resolve();

  static async create() {
    const sf = new NodeStockfish();
    sf.engine = await require("stockfish")("lite-single");
    await sf.command(["uci"], /^uciok/);
    return sf;
  }

  private command(cmds: string[], until: RegExp, onLine?: (l: string) => void) {
    return new Promise<void>((resolve) => {
      this.engine.listener = (l: string) => {
        onLine?.(l);
        if (until.test(l)) resolve();
      };
      for (const c of cmds) this.engine.sendCommand(c);
    });
  }

  // Runs one search at a time, in call order.
  analyse(fen: string, depth: number, multipv = 1): Promise<Analysis> {
    const run = async () => {
      const lines = new Map<number, Line>();
      const whiteToMove = fen.split(" ")[1] === "w";
      await this.command([`setoption name MultiPV value ${multipv}`, `position fen ${fen}`, `go depth ${depth}`], /^bestmove/, (l) => {
        const score = / score (cp|mate) (-?\d+)/.exec(l);
        if (!l.startsWith("info") || !score) return;
        const d = Number(/ depth (\d+)/.exec(l)?.[1] ?? 0);
        const sign = whiteToMove ? 1 : -1;
        const v = Number(score[2]) * sign;
        const e: Evaluation = score[1] === "cp" ? { cp: v, depth: d, whiteToMove } : { mate: v, depth: d, whiteToMove };
        lines.set(Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1), { uci: / pv (\S+)/.exec(l)?.[1] ?? "", eval: e });
      });
      return { fen, depth, lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l) };
    };
    const p = this.chain.then(run);
    this.chain = p.catch(() => {});
    return p;
  }
}
