// Phones paired with this Mac, by the hash of their token.
import { db } from "./connection";

export interface DeviceRow {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

export const rowToDevice = (r: any): DeviceRow => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at });

export function listDevices(): DeviceRow[] {
  return db.query("SELECT * FROM devices ORDER BY created_at").all().map(rowToDevice);
}

export function addDevice(id: string, name: string, tokenHash: string) {
  const now = Date.now();
  db.run("INSERT INTO devices (id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)", [id, name, tokenHash, now, now]);
}

export function deviceByTokenHash(tokenHash: string): DeviceRow | null {
  const r = db.query("SELECT * FROM devices WHERE token_hash = ?").get(tokenHash);
  return r ? rowToDevice(r) : null;
}

export function touchDevice(id: string) {
  db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [Date.now(), id]);
}

export function deleteDevice(id: string) {
  db.run("DELETE FROM devices WHERE id = ?", [id]);
}

export function deleteAllDevices() {
  db.run("DELETE FROM devices");
}
