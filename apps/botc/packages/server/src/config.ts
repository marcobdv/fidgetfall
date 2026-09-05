import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this module until a directory containing `marker` turns up. */
function findUp(marker: string): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, marker);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export interface Config {
  host: string;
  port: number;
  /** Where scripts/ and characters/ live. */
  dataDir: string;
  /** Static web client root. */
  clientDir: string;
  /** Optional character database with ability text and night order. */
  rolesFile?: string;
  /** Shared secret required to create a game, if set. */
  adminToken?: string;
  /** Where per-game event logs are appended. Undefined disables journalling. */
  journalDir?: string;
  publicUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env['BOTC_DATA_DIR']
    ? resolve(env['BOTC_DATA_DIR'])
    : (findUp('data/scripts') ? dirname(findUp('data/scripts') as string) : resolve('data'));
  const journalRaw = env['BOTC_JOURNAL_DIR'] ?? join(dataDir, 'journal');
  const journalDir = journalRaw === 'off' ? undefined : resolve(journalRaw);
  const clientDir = env['BOTC_CLIENT_DIR']
    ? resolve(env['BOTC_CLIENT_DIR'])
    : (findUp('packages/client/public') ?? resolve('packages/client/public'));

  const port = Number(env['PORT'] ?? env['BOTC_PORT'] ?? 8080);
  const host = env['BOTC_HOST'] ?? '0.0.0.0';
  const config: Config = {
    host,
    port,
    dataDir,
    clientDir,
    publicUrl: env['BOTC_PUBLIC_URL'] ?? `http://localhost:${port}`,
  };

  const rolesEnv = env['BOTC_ROLES_FILE'];
  const localRoles = join(dataDir, 'characters', 'roles.local.json');
  if (rolesEnv) config.rolesFile = resolve(rolesEnv);
  else if (existsSync(localRoles)) config.rolesFile = localRoles;

  if (env['BOTC_ADMIN_TOKEN']) config.adminToken = env['BOTC_ADMIN_TOKEN'];
  if (journalDir) config.journalDir = journalDir;
  return config;
}
