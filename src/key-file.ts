import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

const MAX_PRIVATE_KEY_BYTES = 16 * 1024;

async function openPrivateKey(path: string) {
  if (!isAbsolute(path)) throw new Error("ASC_PRIVATE_KEY_PATH must be an absolute path");
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("ASC_PRIVATE_KEY_PATH must point directly to a regular file, not a symbolic link");
  }
}

export async function readPrivateKeyFile(path: string): Promise<Buffer> {
  const handle = await openPrivateKey(path);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("ASC_PRIVATE_KEY_PATH must point directly to a regular file, not a symbolic link");
    if ((stat.mode & 0o777) !== 0o600) throw new Error("Private key permissions must be exactly mode 600");
    if (typeof process.geteuid === "function" && stat.uid !== process.geteuid()) {
      throw new Error("Private key must be owned by the current user");
    }
    if (stat.size < 1 || stat.size > MAX_PRIVATE_KEY_BYTES) {
      throw new Error(`Private key size must be between 1 and ${MAX_PRIVATE_KEY_BYTES} bytes`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function validatePrivateKeyFile(path: string): Promise<void> {
  const bytes = await readPrivateKeyFile(path);
  bytes.fill(0);
}
