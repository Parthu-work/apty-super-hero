/**
 * IndexedDB databases the Agent created under its upstream AIPex names, and
 * the names that replaced them. Each moves once: every object store, index
 * and record (with its key) is copied, every key is read back, and only then
 * is the old database deleted. A record already in the new database wins.
 * The new database keeps the old one's version, which is the version the
 * Agent opens it at.
 */
const LEGACY_DATABASE_RENAMES: Readonly<Record<string, string>> = {
  "aipex-conversations-db": "apty-conversations-db",
  "aipex-screenshots-db": "apty-screenshots-db",
  "aipex-skills-fs": "apty-skills-fs",
};

export const CONVERSATIONS_DB = "apty-conversations-db";
export const SCREENSHOTS_DB = "apty-screenshots-db";
export const SKILLS_FS_DB = "apty-skills-fs";

/** ZenFS names its one object store after the database, so the store is renamed too. */
const STORE_RENAMES: Readonly<Record<string, string>> = {
  "aipex-skills-fs": SKILLS_FS_DB,
};

interface StoreShape {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: Array<{
    name: string;
    keyPath: string | string[];
    unique: boolean;
    multiEntry: boolean;
  }>;
  records: Array<{ key: IDBValidKey; value: unknown }>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("legacy_database_blocked"));
  });
}

async function readShape(db: IDBDatabase): Promise<StoreShape[]> {
  const shapes: StoreShape[] = [];
  for (const name of Array.from(db.objectStoreNames)) {
    const store = db.transaction(name).objectStore(name);
    const records: StoreShape["records"] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return resolve();
        records.push({ key: current.primaryKey, value: current.value });
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    shapes.push({
      name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: Array.from(store.indexNames).map((indexName) => {
        const index = store.index(indexName);
        return {
          name: indexName,
          keyPath: index.keyPath,
          unique: index.unique,
          multiEntry: index.multiEntry,
        };
      }),
      records,
    });
  }
  return shapes;
}

function createMissingStores(db: IDBDatabase, shapes: StoreShape[]): void {
  for (const shape of shapes) {
    if (db.objectStoreNames.contains(shape.name)) continue;
    const store = db.createObjectStore(shape.name, {
      keyPath: shape.keyPath ?? undefined,
      autoIncrement: shape.autoIncrement,
    });
    for (const index of shape.indexes) {
      store.createIndex(index.name, index.keyPath, {
        unique: index.unique,
        multiEntry: index.multiEntry,
      });
    }
  }
}

/**
 * A new target is created at the source's version with every store. An
 * existing one is used only if it already has every store: raising its
 * version would leave it at one the Agent can't open.
 */
async function openTarget(
  name: string,
  shapes: StoreShape[],
  version: number,
): Promise<IDBDatabase> {
  if (!(await databaseExists(name))) {
    return open(name, version, (created) =>
      createMissingStores(created, shapes),
    );
  }
  const db = await open(name);
  if (shapes.every((s) => db.objectStoreNames.contains(s.name))) return db;
  db.close();
  throw new Error("legacy_database_target_mismatch");
}

async function copyRecords(
  db: IDBDatabase,
  shapes: StoreShape[],
): Promise<void> {
  for (const shape of shapes) {
    const store = db
      .transaction(shape.name, "readwrite")
      .objectStore(shape.name);
    for (const record of shape.records) {
      const existing = await request(store.getKey(record.key));
      if (existing !== undefined) continue;
      await request(
        shape.keyPath === null
          ? store.put(record.value, record.key)
          : store.put(record.value),
      );
    }
  }
}

async function verify(db: IDBDatabase, shapes: StoreShape[]): Promise<void> {
  for (const shape of shapes) {
    const store = db.transaction(shape.name).objectStore(shape.name);
    for (const record of shape.records) {
      if ((await request(store.getKey(record.key))) === undefined) {
        throw new Error("legacy_database_verify_failed");
      }
    }
  }
}

async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !indexedDB.databases) return false;
  return (await indexedDB.databases()).some((db) => db.name === name);
}

/** Moves one database; returns how many records the old one held. */
async function moveDatabase(from: string, to: string): Promise<number> {
  if (!(await databaseExists(from))) return 0;
  const source = await open(from);
  const version = source.version;
  const shapes = (await readShape(source)).map((shape) => ({
    ...shape,
    name: STORE_RENAMES[shape.name] ?? shape.name,
  }));
  source.close();
  const target = await openTarget(to, shapes, version);
  try {
    await copyRecords(target, shapes);
    await verify(target, shapes);
  } finally {
    target.close();
  }
  await request(indexedDB.deleteDatabase(from));
  return shapes.reduce((sum, shape) => sum + shape.records.length, 0);
}

let moving: Promise<void> | null = null;

/** Moves every legacy database, once per context; a failed run is retried on the next call. */
export function moveLegacyDatabases(): Promise<void> {
  moving ??= (async () => {
    const failures: unknown[] = [];
    for (const [from, to] of Object.entries(LEGACY_DATABASE_RENAMES)) {
      await moveDatabase(from, to).catch((error) => failures.push(error));
    }
    if (failures.length > 0) throw failures[0];
  })().catch((error) => {
    moving = null;
    throw error;
  });
  return moving;
}
