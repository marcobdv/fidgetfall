/**
 * A `RoomClient` that talks to a table server over its REST API.
 *
 * This is what the stdio MCP entrypoint uses: the agent runs the MCP server
 * locally as a subprocess, and that subprocess plays at a table hosted
 * somewhere else. The tools do not know the difference.
 */

import type { CoachAdvice } from "../coach/advice.js";
import type { HandReview } from "../coach/review.js";
import type { CreateTableOptions, Seating, TableSummary } from "../server/room.js";
import type { Action } from "../engine/types.js";
import type { JoinRequest, RoomClient, StateView, TurnWait } from "../shared/client.js";

export class HttpRoomClient implements RoomClient {
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch (error) {
      throw new Error(
        `cannot reach the table server at ${this.base} — is it running? (${
          error instanceof Error ? error.message : error
        })`,
      );
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`table server returned a non-JSON response (${response.status})`);
      }
    }

    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `request failed with ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  }

  /** The table id is the part of the token before the dot. */
  private tableOf(token: string): string {
    const tableId = token.split(".")[0];
    if (!tableId) throw new Error("that does not look like a seat token");
    return tableId;
  }

  async listTables(): Promise<TableSummary[]> {
    const { tables } = await this.request<{ tables: TableSummary[] }>("/api/tables");
    return tables;
  }

  async createTable(options: CreateTableOptions): Promise<TableSummary> {
    const { table } = await this.request<{ table: TableSummary }>("/api/tables", {
      method: "POST",
      body: JSON.stringify(options),
    });
    return table;
  }

  async join(tableId: string, request: JoinRequest): Promise<Seating> {
    const { seating } = await this.request<{ seating: Seating }>(
      `/api/tables/${encodeURIComponent(tableId)}/join`,
      { method: "POST", body: JSON.stringify(request) },
    );
    return seating;
  }

  async leave(token: string): Promise<void> {
    await this.request(`/api/tables/${this.tableOf(token)}/leave`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  async state(token: string): Promise<StateView> {
    const { state } = await this.request<{ state: StateView }>(
      `/api/tables/${this.tableOf(token)}?token=${encodeURIComponent(token)}`,
    );
    return state;
  }

  async publicState(tableId: string): Promise<StateView> {
    const { state } = await this.request<{ state: StateView }>(
      `/api/tables/${encodeURIComponent(tableId)}`,
    );
    return state;
  }

  async act(token: string, action: Action): Promise<StateView> {
    // The wire format names the verb `action`; the engine's type is `type`.
    const { state } = await this.request<{ state: StateView }>(
      `/api/tables/${this.tableOf(token)}/act`,
      {
        method: "POST",
        body: JSON.stringify({ token, action: action.type, amount: action.amount }),
      },
    );
    return state;
  }

  async advise(token: string): Promise<CoachAdvice | null> {
    const { advice } = await this.request<{ advice: CoachAdvice | null }>(
      `/api/tables/${this.tableOf(token)}/coach?token=${encodeURIComponent(token)}`,
    );
    return advice;
  }

  async review(token: string, handNumber?: number): Promise<HandReview | null> {
    const query = handNumber === undefined ? "" : `&hand=${handNumber}`;
    const { review } = await this.request<{ review: HandReview | null }>(
      `/api/tables/${this.tableOf(token)}/review?token=${encodeURIComponent(token)}${query}`,
    );
    return review;
  }

  /**
   * The REST API has no long-poll, so waiting is done by asking for the state
   * until the seat is up. The interval is short enough to feel immediate and
   * long enough that a waiting agent is not hammering the server.
   */
  async waitForTurn(token: string, timeoutMs: number): Promise<TurnWait> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.state(token);
      if (state.legalActions !== null) return { yourTurn: true, timedOut: false, state };
      if (Date.now() >= deadline) return { yourTurn: false, timedOut: true, state };
      await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
    }
  }

  async addBot(tableId: string, bot: string, seat?: number): Promise<Seating> {
    const { seating } = await this.request<{ seating: { seat: number } }>(
      `/api/tables/${encodeURIComponent(tableId)}/bots`,
      { method: "POST", body: JSON.stringify({ bot, seat }) },
    );
    return { token: "", playerId: "", tableId, seat: seating.seat };
  }

  async sitOut(token: string, sittingOut: boolean): Promise<void> {
    await this.request(`/api/tables/${this.tableOf(token)}/sitout`, {
      method: "POST",
      body: JSON.stringify({ token, sittingOut }),
    });
  }

  async topUp(token: string, amount: number): Promise<void> {
    await this.request(`/api/tables/${this.tableOf(token)}/topup`, {
      method: "POST",
      body: JSON.stringify({ token, amount }),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
