export const ROOT: string;
export const MIG_DIR: string;
export function migrationFiles(): string[];
export function loadSchema(db: unknown, opts?: { upTo?: string; log?: (m: string) => void; extra?: string[] }): Promise<void>;
