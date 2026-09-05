/**
 * The MCP seat: everything an agent needs to find a table, sit down and play.
 *
 * The whole protocol is nine tools. An agent's identity at a table is the
 * `token` it gets back from `join_table`; that token is the only thing that can
 * see its hole cards, and it is scoped to one seat at one table. There is no
 * way through this interface to read another seat's cards, which is what lets
 * agents and humans share a table honestly.
 *
 * A typical agent loop is: `join_table` once, then `wait_for_turn` → `act`,
 * over and over.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BOT_IDS, BOT_POLICIES } from "../bots/policies.js";
import type { RoomClient } from "../shared/client.js";
import { renderAdvice, renderReview, renderState, renderTables } from "./render.js";

/**
 * The longest `wait_for_turn` may block.
 *
 * This must stay comfortably under the MCP SDK's default *client* request
 * timeout of 60s: the client gives up on its own deadline, so a wait at or past
 * that mark fails with "Request timed out" no matter how healthy the server is.
 * The agent's loop is what covers a long wait — one call returning `yourTurn:
 * false` costs nothing, whereas a timed-out request looks like a broken table.
 */
export const MAX_WAIT_MS = 45_000;
export const DEFAULT_WAIT_MS = 20_000;

const TOKEN = z
  .string()
  .describe("The seat token returned by join_table. It identifies your seat and only your seat.");

/** Wraps a handler so a thrown error becomes a tool error the agent can read. */
function reply(text: string, structured?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structured === undefined ? {} : { structuredContent: structured as Record<string, unknown> }),
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function buildMcpServer(client: RoomClient): McpServer {
  const server = new McpServer(
    { name: "fidgetfall-holdem", version: "0.1.0" },
    {
      instructions: [
        "A no-limit Texas Hold'em table you can sit at and play, alongside humans and other agents.",
        "",
        "Start with list_tables. Join one with join_table (or create_table first) and keep the",
        "token it returns — it is your seat, and the only way to see your own cards.",
        "Then loop: wait_for_turn, read the state it returns, act.",
        "",
        "Bet and raise amounts are RAISE-TO totals: the total you will have in for the current",
        "betting round, not the chips you are adding. get_state always shows the legal range.",
      ].join("\n"),
    },
  );

  server.registerTool(
    "list_tables",
    {
      title: "List tables",
      description:
        "Every table currently running, with blinds, buy-in limits, and how many humans and agents are seated. Start here.",
      inputSchema: {},
    },
    async () => {
      try {
        const tables = await client.listTables();
        return reply(renderTables(tables), { tables });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_table",
    {
      title: "Create a table",
      description:
        "Start a new table. Everything is optional — with no arguments you get a six-seat 10/20 table. Add bots to have opponents immediately.",
      inputSchema: {
        name: z.string().max(60).optional().describe("Display name for the table."),
        smallBlind: z.number().int().positive().optional().describe("Defaults to half the big blind."),
        bigBlind: z.number().int().positive().optional().describe("Defaults to 20."),
        maxSeats: z.number().int().min(2).max(9).optional().describe("Defaults to 6."),
        minBuyIn: z.number().int().positive().optional().describe("Defaults to 20 big blinds."),
        maxBuyIn: z.number().int().positive().optional().describe("Defaults to 200 big blinds."),
        actionTimeoutMs: z
          .number()
          .int()
          .min(1000)
          .optional()
          .describe("How long a seat has to act before it is checked or folded for them."),
        bots: z
          .array(z.enum(BOT_IDS as [string, ...string[]]))
          .optional()
          .describe(`Bot opponents to seat right away. One or more of: ${BOT_IDS.join(", ")}.`),
      },
    },
    async (args) => {
      try {
        const table = await client.createTable(args);
        return reply(
          `Created table ${table.id} — ${table.name}, blinds ${table.smallBlind}/${table.bigBlind}, ` +
            `${table.seated}/${table.maxSeats} seated. Join it with join_table.`,
          { table },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "join_table",
    {
      title: "Sit down at a table",
      description:
        "Take a seat. Returns a token that IS your seat — keep it for every later call, and do not share it. Joining mid-hand waits for the next deal.",
      inputSchema: {
        tableId: z.string().describe("Table id from list_tables or create_table."),
        name: z.string().min(1).max(24).describe("The name shown to the other players."),
        buyIn: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Chips to sit down with. Defaults to the table maximum."),
        seat: z.number().int().min(0).max(8).optional().describe("A specific seat, if it is free."),
      },
    },
    async ({ tableId, name, buyIn, seat }) => {
      try {
        const seating = await client.join(tableId, { name, kind: "agent", buyIn, seat });
        const state = await client.state(seating.token);
        return reply(
          `Seated at ${tableId} in seat ${seating.seat + 1}.\n` +
            `Your token: ${seating.token}\n\n${renderState(state)}`,
          { ...seating, state },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_state",
    {
      title: "Look at the table",
      description:
        "The table as your seat sees it: board, pot, stacks, your own hole cards, and your legal actions with their amounts.",
      inputSchema: { token: TOKEN },
    },
    async ({ token }) => {
      try {
        const state = await client.state(token);
        return reply(renderState(state), { state });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "wait_for_turn",
    {
      title: "Wait until it is your turn",
      description:
        `Blocks until it is your turn to act, then returns the table state. Use this instead of polling get_state in a loop. It always returns within ${MAX_WAIT_MS / 1000} seconds: if your turn has not come round it returns yourTurn=false, and you simply call it again. That is normal and costs nothing — a table with slow opponents may need several calls.`,
      inputSchema: {
        token: TOKEN,
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(MAX_WAIT_MS)
          .optional()
          .describe(
            `How long to block, in ms, up to ${MAX_WAIT_MS}. Defaults to ${DEFAULT_WAIT_MS}. Longer is not better — the cap keeps the call inside your MCP client's own request deadline.`,
          ),
      },
    },
    async ({ token, timeoutMs }) => {
      try {
        const wait = await client.waitForTurn(
          token,
          Math.min(timeoutMs ?? DEFAULT_WAIT_MS, MAX_WAIT_MS),
        );
        const header = wait.yourTurn
          ? "It is your turn."
          : "Still not your turn — call wait_for_turn again.";
        return reply(`${header}\n\n${renderState(wait.state)}`, wait);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "act",
    {
      title: "Act on your hand",
      description:
        "Fold, check, call, bet or raise. For bet and raise, `amount` is the RAISE-TO total for this betting round — the total you will have in, not the chips you are adding. get_state shows the legal range; an amount outside it is rejected rather than adjusted.",
      inputSchema: {
        token: TOKEN,
        action: z.enum(["fold", "check", "call", "bet", "raise"]),
        amount: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Required for bet and raise: the total for this round after acting."),
      },
    },
    async ({ token, action, amount }) => {
      try {
        if ((action === "bet" || action === "raise") && amount === undefined) {
          return failure(new Error(`${action} needs an amount (the raise-to total for this round)`));
        }
        const state = await client.act(token, { type: action, amount });
        return reply(`You ${action}${amount !== undefined ? ` to ${amount}` : ""}.\n\n${renderState(state)}`, {
          state,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_coaching",
    {
      title: "Ask the coach",
      description:
        "The coach's read on your current spot: hand strength, equity against random hands, outs, pot odds, and a suggested action with its reasoning. A teaching heuristic, not a solver.",
      inputSchema: { token: TOKEN },
    },
    async ({ token }) => {
      try {
        const advice = await client.advise(token);
        if (!advice) return reply("Nothing to advise on — you are not in a live hand right now.");
        return reply(renderAdvice(advice), { advice });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "review_hand",
    {
      title: "Review a finished hand",
      description:
        "Replays a finished hand and recomputes your equity at each of your decisions, against the price you were being offered.",
      inputSchema: {
        token: TOKEN,
        handNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Which hand to review. Defaults to the most recent one."),
      },
    },
    async ({ token, handNumber }) => {
      try {
        const review = await client.review(token, handNumber);
        if (!review) return reply("No finished hand to review yet.");
        return reply(renderReview(review), { review });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "leave_table",
    {
      title: "Leave the table",
      description:
        "Stand up and cash out. Mid-hand this folds you and the seat clears once the hand finishes. Your token stops working.",
      inputSchema: { token: TOKEN },
    },
    async ({ token }) => {
      try {
        await client.leave(token);
        return reply("You have left the table.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "add_bot",
    {
      title: "Seat a bot opponent",
      description: `Add a built-in opponent to a table. Archetypes: ${Object.values(BOT_POLICIES)
        .map((p) => `${p.id} (${p.blurb})`)
        .join("; ")}`,
      inputSchema: {
        tableId: z.string(),
        bot: z.enum(BOT_IDS as [string, ...string[]]),
        seat: z.number().int().min(0).max(8).optional(),
      },
    },
    async ({ tableId, bot, seat }) => {
      try {
        const seating = await client.addBot(tableId, bot, seat);
        return reply(`Seated a ${bot} bot in seat ${seating.seat + 1}.`, { seat: seating.seat });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
