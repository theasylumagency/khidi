import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  key: string; sha256: string; bytes: number; contentType: string; versionId?: string;
}
export interface MediaStorage {
  putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  readPrivate(key: string, expectedSha256: string, versionId?: string): Promise<Uint8Array>;
  putPublic(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  removePublic(key: string): Promise<void>;
}
export class StorageExistsError extends Error { constructor() { super("Immutable media object already exists."); } }
export class StorageMissingError extends Error { constructor() { super("Media object not found."); } }
export class StorageIntegrityError extends Error { constructor() { super("Media SHA-256 verification failed."); } }
export function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function assertObjectKey(key: string, area: "private" | "public") {
  if (!key || key.length > 512 || !/^[a-zA-Z0-9_./-]+$/.test(key) || key.startsWith("/")
    || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid media object key.");
  if (area === "private" && !/^(raw|master|evidence|reports)\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\//i.test(key)) {
    throw new Error("Private keys require an image/evidence UUIDv7, never a product identifier.");
  }
}
export function checkDigest(bytes: Uint8Array, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || digest(bytes) !== expected) throw new StorageIntegrityError();
}
export function privateImageKey(id: string, name: string, area: "raw" | "master" = "raw") {
  const key = `${area}/${id}/${name}`; assertObjectKey(key, "private"); return key;
}

/** Byte-for-byte local originals; wx is the atomic, cross-process no-overwrite guard. */
export class FilesystemMediaStorage implements MediaStorage {
  constructor(readonly root: string) { if (!path.isAbsolute(root)) throw new Error("Media root must be absolute."); }
  private location(key: string, area: "private" | "public") {
    assertObjectKey(key, area);
    const directory = path.resolve(this.root, area), file = path.resolve(directory, ...key.split("/"));
    if (!file.startsWith(directory + path.sep)) throw new Error("Media path escapes its storage area.");
    return file;
  }
  async putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    const file = this.location(key, "private");
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new StorageExistsError(); throw error; }
    return { key, sha256: digest(bytes), bytes: bytes.byteLength, contentType };
  }
  async readPrivate(key: string, expectedSha256: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try { bytes = await readFile(this.location(key, "private")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageMissingError(); throw error; }
    checkDigest(bytes, expectedSha256); return bytes;
  }
  async putPublic(key: string, bytes: Uint8Array, _contentType: string) {
    const file = this.location(key, "public");
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
  }
  async removePublic(key: string) {
    try { await unlink(this.location(key, "public")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
