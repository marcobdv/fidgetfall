/**
 * The one interface both the browser and the MCP tools talk to.
 *
 * There are two implementations: `LocalRoomClient` calls a `PokerRoom` directly
 * (used by the server's own MCP endpoint, and by the tests), and
 * `HttpRoomClient` calls the same operations over the REST API (used by the
 * stdio MCP entrypoint, so an agent on someone's laptop can sit at a table
 * running somewhere else). Writing the MCP tools against this interface is what
 * keeps those two paths from drifting apart.
 */

import type { CoachAdvice } from "../coach/advice.js";
import type { HandReview } from "../coach/review.js";
import type { PlayerKind, TableView } from "../engine/table.js";
import type { Action } from "../engine/types.js";
import type { CreateTableOptions, PokerRoom, Seating, TableSummary } from "../server/room.js";

export type StateView = TableView & { revision: number };

export interface JoinRequest {
  name: string;
  kind: PlayerKind;
  buyIn?: number;
  seat?: number;
}

export interface TurnWait {
  yourTurn: boolean;
  timedOut: boolean;
  state: StateView;
}

export interface RoomClient {
  listTables(): Promise<TableSummary[]>;
  createTable(options: CreateTableOptions): Promise<TableSummary>;
  join(tableId: string, request: JoinRequest): Promise<Seating>;
  leave(token: string): Promise<void>;
  state(token: string): Promise<StateView>;
  publicState(tableId: string): Promise<StateView>;
  act(token: string, action: Action): Promise<StateView>;
  advise(token: string): Promise<CoachAdvice | null>;
  review(token: string, handNumber?: number): Promise<HandReview | null>;
  waitForTurn(token: string, timeoutMs: number): Promise<TurnWait>;
  addBot(tableId: string, bot: string, seat?: number): Promise<Seating>;
  sitOut(token: string, sittingOut: boolean): Promise<void>;
  topUp(token: string, amount: number): Promise<void>;
}

/** Talks to a `PokerRoom` in the same process. */
export class LocalRoomClient implements RoomClient {
  constructor(private readonly room: PokerRoom) {}

  async listTables(): Promise<TableSummary[]> {
    return this.room.listTables();
  }

  async createTable(options: CreateTableOptions): Promise<TableSummary> {
    const table = this.room.createTable(options);
    const summary = this.room.listTables().find((t) => t.id === table.config.id);
    if (!summary) throw new Error("table vanished immediately after creation");
    return summary;
  }

  async join(tableId: string, request: JoinRequest): Promise<Seating> {
    return this.room.join(tableId, request);
  }

  async leave(token: string): Promise<void> {
    this.room.leave(token);
  }

  async state(token: string): Promise<StateView> {
    return this.room.view(this.room.tableIdForToken(token), token);
  }

  async publicState(tableId: string): Promise<StateView> {
    return this.room.view(tableId);
  }

  async act(token: string, action: Action): Promise<StateView> {
    this.room.act(token, action);
    return this.state(token);
  }

  async advise(token: string): Promise<CoachAdvice | null> {
    return this.room.advise(token);
  }

  async review(token: string, handNumber?: number): Promise<HandReview | null> {
    return this.room.review(token, handNumber);
  }

  async waitForTurn(token: string, timeoutMs: number): Promise<TurnWait> {
    const outcome = await this.room.waitForTurn(token, timeoutMs);
    return { ...outcome, state: await this.state(token) };
  }

  async addBot(tableId: string, bot: string, seat?: number): Promise<Seating> {
    return this.room.addBot(tableId, bot, seat);
  }

  async sitOut(token: string, sittingOut: boolean): Promise<void> {
    this.room.setSittingOut(token, sittingOut);
  }

  async topUp(token: string, amount: number): Promise<void> {
    this.room.topUp(token, amount);
  }
}
