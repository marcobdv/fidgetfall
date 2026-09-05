/**
 * Rendering table state as text for an agent to read.
 *
 * MCP tools return structured JSON too, but a model reasons better about a hand
 * it can see laid out than about a nested object, and the text is what shows up
 * in a transcript when someone is debugging why their agent folded the nuts.
 */

import type { CoachAdvice } from "../coach/advice.js";
import type { HandReview } from "../coach/review.js";
import type { StateView } from "../shared/client.js";
import type { TableSummary } from "../server/room.js";

export function renderState(state: StateView): string {
  const lines: string[] = [];
  const street = state.street === "idle" ? "waiting to start" : state.street;

  lines.push(
    `${state.name} (${state.id}) · blinds ${state.smallBlind}/${state.bigBlind}` +
      (state.handNumber > 0 ? ` · hand #${state.handNumber}` : "") +
      ` · ${street}`,
  );
  lines.push(`Board: ${state.board.length > 0 ? state.board.join(" ") : "—"}   Pot: ${state.pot}`);

  if (state.pots.length > 1) {
    lines.push(
      `Pots: ${state.pots
        .map((pot, i) => `${i === 0 ? "main" : `side ${i}`} ${pot.amount} (seats ${pot.eligible.map((s) => s + 1).join(",")})`)
        .join(" · ")}`,
    );
  }

  lines.push("");
  for (const seat of state.seats) {
    if (!seat.playerId) {
      lines.push(`  seat ${seat.seat + 1}  —`);
      continue;
    }
    const marks = [
      seat.isButton ? "button" : "",
      seat.seat === state.youSeat ? "you" : "",
      seat.kind === "agent" ? "agent" : "",
      seat.sittingOut ? "sitting out" : "",
      seat.status === "folded" ? "folded" : "",
      seat.status === "all-in" ? "ALL IN" : "",
    ].filter(Boolean);

    const cards = seat.holeCards
      ? seat.holeCards.join(" ")
      : seat.hiddenCards > 0
        ? "?? ".repeat(seat.hiddenCards).trim()
        : "";

    lines.push(
      `${seat.isActing ? ">" : " "} seat ${seat.seat + 1}  ${pad(seat.name ?? "", 14)}` +
        `${pad(String(seat.stack), 8)}${pad(cards, 8)}` +
        `${seat.committed > 0 ? `bet ${seat.committed}` : ""}` +
        `${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}` +
        `${seat.handDescription ? `  — ${seat.handDescription}` : ""}`,
    );
  }

  lines.push("");
  const legal = state.legalActions;
  if (legal) {
    const choices: string[] = ["fold"];
    if (legal.canCheck) choices.push("check");
    if (legal.canCall) choices.push(`call ${legal.toCall}`);
    if (legal.canBet) choices.push(`bet ${legal.minBet}..${legal.maxBet}`);
    if (legal.canRaise) choices.push(`raise to ${legal.minRaiseTo}..${legal.maxRaiseTo}`);
    lines.push(`It is your turn. To call: ${legal.toCall}. You may: ${choices.join(" · ")}`);
    lines.push("Bet and raise amounts are totals for this round, not chips added.");
  } else {
    lines.push(state.waitingFor ? `Waiting: ${state.waitingFor}` : "Not your turn.");
  }

  if (state.log.length > 0) {
    lines.push("", "Recent action:");
    for (const line of state.log.slice(-8)) lines.push(`  ${line}`);
    }

  return lines.join("\n");
}

export function renderTables(tables: TableSummary[]): string {
  if (tables.length === 0) return "No tables are running. Use create_table to start one.";
  const lines = ["Running tables:"];
  for (const table of tables) {
    lines.push(
      `  ${table.id}  ${pad(table.name, 22)} blinds ${table.smallBlind}/${table.bigBlind}` +
        `  ${table.seated}/${table.maxSeats} seated (${table.humans} human, ${table.agents} agent)` +
        `  buy-in ${table.minBuyIn}-${table.maxBuyIn}  ${table.street}`,
    );
  }
  return lines.join("\n");
}

export function renderAdvice(advice: CoachAdvice): string {
  // Whole percentages throughout: the tips below and the post-hand review both
  // round, and a header reading 43.3% beside an explanation reading 43% invites
  // a reader to hunt for a discrepancy that is not there.
  const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

  const lines = [
    `${advice.handDescription}`,
    `Equity ${pct(advice.equity.equity)}${advice.equity.exact ? " (exact)" : ""}`,
  ];
  if (advice.potOdds) {
    lines.push(
      `Break-even ${pct(advice.potOdds.breakEven)} to call ${advice.potOdds.toCall}` +
        (advice.pressure.margin > 0
          ? ` — but treat the bar as ${pct(advice.potOdds.breakEven + advice.pressure.margin)} ` +
            `against a bet this size (${advice.pressure.level})`
          : ""),
    );
  }
  lines.push(`Suggestion: ${advice.suggestion} (confidence: ${advice.confidence})`, "");
  for (const tip of advice.tips) lines.push(`${tip.label}: ${tip.text}`);
  lines.push(
    "",
    "This is a teaching heuristic against random hands, not a solver. Treat it as a floor, not an instruction.",
  );
  return lines.join("\n");
}

export function renderReview(review: HandReview): string {
  const lines = [
    `Hand #${review.handNumber} — you held ${review.holeCards.join(" ")} on ${review.board.join(" ") || "no board"}`,
    review.summary,
    "",
  ];
  for (const moment of review.moments) {
    lines.push(
      `  ${pad(moment.street, 9)}${pad(moment.action, 7)}` +
        `${pad(moment.toCall > 0 ? `to call ${moment.toCall}` : "", 15)}` +
        `equity ${moment.equityPct.toFixed(0)}%` +
        `${moment.breakEvenPct !== null ? ` vs price ${moment.breakEvenPct.toFixed(0)}%` : ""}` +
        `  [${moment.verdict}]`,
    );
    lines.push(`      ${moment.note}`);
  }
  return lines.join("\n");
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + " ".repeat(width - text.length);
}
