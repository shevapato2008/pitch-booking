import type {
  PublicGameDirectory,
  PublicGameDirectoryFilters,
} from "../domain/public-game-directory";

export interface PublicGameDirectorySource {
  getDirectory(filters?: PublicGameDirectoryFilters): Promise<PublicGameDirectory>;
}

let configured: PublicGameDirectorySource | undefined;

export function registerPublicGameDirectorySource(source: PublicGameDirectorySource): void {
  configured = source;
}

export function getPublicGameDirectorySource(): PublicGameDirectorySource {
  if (!configured) throw new Error("PUBLIC_GAME_DIRECTORY_SOURCE_NOT_CONFIGURED");
  return configured;
}

export function resetPublicGameDirectorySourceForTesting(): void {
  configured = undefined;
}
