import type { InventorySlotStatus, VenueInventory, InventorySlot } from "../domain/inventory";

export interface CreateInventorySlotBody {
  readonly pitchId: string;
  readonly localDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly priceCents: number;
}
export interface UpdateInventorySlotBody {
  readonly expectedCheckoutVersion: number;
  readonly priceCents: number;
  readonly status: Extract<InventorySlotStatus, "AVAILABLE" | "CLOSED">;
}
export interface CreateInventorySlotAttempt {
  readonly kind?: "create";
  readonly venueId: string;
  readonly body: CreateInventorySlotBody;
  readonly idempotencyKey: string;
}
export interface UpdateInventorySlotAttempt {
  readonly kind?: "update";
  readonly venueId: string;
  readonly slotId: string;
  readonly body: UpdateInventorySlotBody;
  readonly idempotencyKey: string;
}
export type InventoryMutationAttempt =
  | (CreateInventorySlotAttempt & { readonly kind: "create" })
  | (UpdateInventorySlotAttempt & { readonly kind: "update" });

export interface InventoryDataSource {
  login(): Promise<void>;
  getDay(venueId: string, pitchId: string | undefined, localDate: string): Promise<VenueInventory>;
  createSlot(attempt: CreateInventorySlotAttempt): Promise<InventorySlot>;
  updateSlot(attempt: UpdateInventorySlotAttempt): Promise<InventorySlot>;
}

let configured: InventoryDataSource | undefined;
export function registerInventoryDataSource(source: InventoryDataSource): void { configured = source; }
export function getInventoryDataSource(): InventoryDataSource {
  if (!configured) throw new Error("INVENTORY_DATA_SOURCE_NOT_CONFIGURED");
  return configured;
}
export function resetInventoryDataSourceForTesting(): void { configured = undefined; }
