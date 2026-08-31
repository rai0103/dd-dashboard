import { openDB } from "idb";

const DB_NAME = "dd-dashboard";
const STORE = "kv";

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

export const storage = {
  async get(key: string): Promise<{ value: string } | null> {
    try {
      const db = await getDB();
      const val = await db.get(STORE, key);
      return val != null ? { value: val } : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      const db = await getDB();
      await db.put(STORE, value, key);
    } catch {
      // storage unavailable — silently ignore
    }
  },
  async delete(key: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORE, key);
    } catch {
      // ignore
    }
  },
};
