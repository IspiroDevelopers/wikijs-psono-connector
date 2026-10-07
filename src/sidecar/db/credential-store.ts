// SPDX-License-Identifier: AGPL-3.0-only
//
// Per-browser Psono API key storage (ADR-0008). One row per enrolled browser
// ("device"); the row is only decryptable with that browser's device secret,
// which the database never sees. Rows expire at a fixed time after enrollment
// (not sliding): after that the user enters the key again. Tables are owned by
// the connector and never touch Wiki.js tables.

import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { CredentialCipher, CredentialDecryptError, type DeviceContext } from '../crypto/credential-cipher'
import type { PsonoCredentials } from '../psono/client'

/** What the browser's HttpOnly cookie carries. */
export interface DeviceToken {
  deviceId: string
  deviceSecret: Buffer
}

export interface Enrollment extends DeviceToken {
  expiresAt: Date
}

export interface StoredCredentials {
  credentials: PsonoCredentials
  expiresAt: Date
}

export interface CredentialStore {
  /** Stores the key for a new browser and returns the token to put in its cookie. */
  enroll(userId: number, credentials: PsonoCredentials, ttlMs: number): Promise<Enrollment>
  /** Null if unknown, expired, owned by another user, or the device secret does not match. */
  get(userId: number, token: DeviceToken): Promise<StoredCredentials | null>
  deleteDevice(userId: number, deviceId: string): Promise<boolean>
  deleteAllForUser(userId: number): Promise<number>
  purgeExpired(): Promise<number>
  close(): Promise<void>
}

/** Cap per user, so a script cannot fill the table; the oldest browsers are dropped. */
export const MAX_DEVICES_PER_USER = 20

export interface Row {
  device_id: string
  wiki_user_id: number
  api_key_id_enc: string
  secret_key_enc: string
  key_version: number
  expires_at: Date
}

abstract class EncryptedStore implements CredentialStore {
  constructor(protected readonly cipher: CredentialCipher, protected readonly now: () => Date = () => new Date()) {}

  protected abstract insertRow(row: Row): Promise<void>
  protected abstract readRow(deviceId: string): Promise<Row | null>
  protected abstract updateCiphertexts(deviceId: string, apiKeyIdEnc: string, secretKeyEnc: string, keyVersion: number): Promise<void>
  protected abstract trimDevices(userId: number, keep: number): Promise<void>
  abstract deleteDevice(userId: number, deviceId: string): Promise<boolean>
  abstract deleteAllForUser(userId: number): Promise<number>
  abstract purgeExpired(): Promise<number>
  abstract close(): Promise<void>

  private encryptPair(ctx: DeviceContext, credentials: PsonoCredentials) {
    return {
      apiKeyIdEnc: this.cipher.encrypt(ctx, 'api_key_id', credentials.apiKeyId),
      secretKeyEnc: this.cipher.encrypt(ctx, 'api_key_secret_key', credentials.apiKeySecretKey),
    }
  }

  async enroll(userId: number, credentials: PsonoCredentials, ttlMs: number): Promise<Enrollment> {
    const deviceId = randomUUID()
    const deviceSecret = CredentialCipher.newDeviceSecret()
    const expiresAt = new Date(this.now().getTime() + ttlMs)
    const { apiKeyIdEnc, secretKeyEnc } = this.encryptPair({ userId, deviceId, deviceSecret }, credentials)
    await this.trimDevices(userId, MAX_DEVICES_PER_USER - 1)
    await this.insertRow({
      device_id: deviceId,
      wiki_user_id: userId,
      api_key_id_enc: apiKeyIdEnc,
      secret_key_enc: secretKeyEnc,
      key_version: this.cipher.currentVersion,
      expires_at: expiresAt,
    })
    return { deviceId, deviceSecret, expiresAt }
  }

  async get(userId: number, token: DeviceToken): Promise<StoredCredentials | null> {
    const row = await this.readRow(token.deviceId)
    if (!row || row.wiki_user_id !== userId || row.expires_at.getTime() <= this.now().getTime()) return null
    const ctx: DeviceContext = { userId, deviceId: token.deviceId, deviceSecret: token.deviceSecret }
    let id, secret
    try {
      id = this.cipher.decrypt(ctx, 'api_key_id', row.api_key_id_enc)
      secret = this.cipher.decrypt(ctx, 'api_key_secret_key', row.secret_key_enc)
    } catch (err) {
      // Wrong device secret (forged/foreign cookie) looks exactly like "no key".
      if (err instanceof CredentialDecryptError) return null
      throw err
    }
    const credentials = { apiKeyId: id.plaintext, apiKeySecretKey: secret.plaintext }
    if (id.stale || secret.stale) {
      // Lazy master-key rotation; the expiry does not move.
      const { apiKeyIdEnc, secretKeyEnc } = this.encryptPair(ctx, credentials)
      await this.updateCiphertexts(token.deviceId, apiKeyIdEnc, secretKeyEnc, this.cipher.currentVersion)
    }
    return { credentials, expiresAt: row.expires_at }
  }
}

export class MemoryCredentialStore extends EncryptedStore {
  readonly rows = new Map<string, Row>()

  protected async insertRow(row: Row) {
    this.rows.set(row.device_id, { ...row })
  }
  protected async readRow(deviceId: string) {
    const row = this.rows.get(deviceId)
    return row ? { ...row } : null
  }
  protected async updateCiphertexts(deviceId: string, apiKeyIdEnc: string, secretKeyEnc: string, keyVersion: number) {
    const row = this.rows.get(deviceId)
    if (row) Object.assign(row, { api_key_id_enc: apiKeyIdEnc, secret_key_enc: secretKeyEnc, key_version: keyVersion })
  }
  protected async trimDevices(userId: number, keep: number) {
    const mine = [...this.rows.values()].filter((r) => r.wiki_user_id === userId).sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime())
    for (const row of mine.slice(keep)) this.rows.delete(row.device_id)
  }
  async deleteDevice(userId: number, deviceId: string) {
    const row = this.rows.get(deviceId)
    if (!row || row.wiki_user_id !== userId) return false
    return this.rows.delete(deviceId)
  }
  async deleteAllForUser(userId: number) {
    let n = 0
    for (const [id, row] of this.rows) if (row.wiki_user_id === userId && this.rows.delete(id)) n++
    return n
  }
  async purgeExpired() {
    let n = 0
    const now = this.now().getTime()
    for (const [id, row] of this.rows) if (row.expires_at.getTime() <= now && this.rows.delete(id)) n++
    return n
  }
  async close() {}
}

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE psono_connector_user_credentials (
        wiki_user_id    integer     PRIMARY KEY,
        api_key_id_enc  text        NOT NULL,
        secret_key_enc  text        NOT NULL,
        key_version     integer     NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );`,
  },
  {
    // ADR-0008: keys become per-browser. v1 rows cannot be converted (they have
    // no device secret), so users re-enter their key once.
    version: 2,
    sql: `
      CREATE TABLE psono_connector_device_credentials (
        device_id       uuid        PRIMARY KEY,
        wiki_user_id    integer     NOT NULL,
        api_key_id_enc  text        NOT NULL,
        secret_key_enc  text        NOT NULL,
        key_version     integer     NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        expires_at      timestamptz NOT NULL
      );
      CREATE INDEX psono_connector_device_credentials_user ON psono_connector_device_credentials (wiki_user_id);
      CREATE INDEX psono_connector_device_credentials_expiry ON psono_connector_device_credentials (expires_at);
      DROP TABLE IF EXISTS psono_connector_user_credentials;`,
  },
]

/** Arbitrary constant for pg_advisory_xact_lock, so concurrent starts migrate once. */
const MIGRATION_LOCK_ID = 0x5053_4e43 // "PSNC"

export class PgCredentialStore extends EncryptedStore {
  private constructor(cipher: CredentialCipher, private readonly pool: pg.Pool) {
    super(cipher)
  }

  /**
   * Connects and migrates. Retries while the database is still starting
   * (compose `depends_on` does not wait for PostgreSQL to accept connections).
   */
  static async connect(
    databaseUrl: string,
    cipher: CredentialCipher,
    { attempts = 30, delayMs = 2_000, onRetry }: { attempts?: number; delayMs?: number; onRetry?: (attempt: number, reason: string) => void } = {},
  ): Promise<PgCredentialStore> {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
    const store = new PgCredentialStore(cipher, pool)
    for (let attempt = 1; ; attempt++) {
      try {
        await store.migrate()
        return store
      } catch (err) {
        const code = (err as { code?: string }).code ?? ''
        // Connection refused / DNS not ready / "the database system is starting up".
        const transient = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', '57P03'].includes(code)
        if (!transient || attempt >= attempts) {
          await pool.end().catch(() => {})
          throw err
        }
        onRetry?.(attempt, code)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID])
      await client.query(`CREATE TABLE IF NOT EXISTS psono_connector_schema_migrations (
        version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
      const { rows } = await client.query<{ version: number }>('SELECT version FROM psono_connector_schema_migrations')
      const applied = new Set(rows.map((r) => r.version))
      const latestKnown = Math.max(...MIGRATIONS.map((m) => m.version))
      if ([...applied].some((v) => v > latestKnown)) {
        // Refuse to run an older connector against a newer schema (no silent downgrade).
        throw new Error('Database schema is newer than this connector version')
      }
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue
        await client.query(migration.sql)
        await client.query('INSERT INTO psono_connector_schema_migrations (version) VALUES ($1)', [migration.version])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  protected async insertRow(row: Row): Promise<void> {
    await this.pool.query(
      `INSERT INTO psono_connector_device_credentials
         (device_id, wiki_user_id, api_key_id_enc, secret_key_enc, key_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.device_id, row.wiki_user_id, row.api_key_id_enc, row.secret_key_enc, row.key_version, row.expires_at],
    )
  }

  protected async readRow(deviceId: string): Promise<Row | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT device_id, wiki_user_id, api_key_id_enc, secret_key_enc, key_version, expires_at
         FROM psono_connector_device_credentials WHERE device_id = $1`,
      [deviceId],
    )
    return rows[0] ?? null
  }

  protected async updateCiphertexts(deviceId: string, apiKeyIdEnc: string, secretKeyEnc: string, keyVersion: number): Promise<void> {
    await this.pool.query(
      'UPDATE psono_connector_device_credentials SET api_key_id_enc = $2, secret_key_enc = $3, key_version = $4 WHERE device_id = $1',
      [deviceId, apiKeyIdEnc, secretKeyEnc, keyVersion],
    )
  }

  protected async trimDevices(userId: number, keep: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM psono_connector_device_credentials
        WHERE wiki_user_id = $1
          AND device_id NOT IN (
            SELECT device_id FROM psono_connector_device_credentials
             WHERE wiki_user_id = $1 ORDER BY expires_at DESC LIMIT $2)`,
      [userId, keep],
    )
  }

  async deleteDevice(userId: number, deviceId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM psono_connector_device_credentials WHERE device_id = $1 AND wiki_user_id = $2',
      [deviceId, userId],
    )
    return (rowCount ?? 0) > 0
  }

  async deleteAllForUser(userId: number): Promise<number> {
    const { rowCount } = await this.pool.query('DELETE FROM psono_connector_device_credentials WHERE wiki_user_id = $1', [userId])
    return rowCount ?? 0
  }

  async purgeExpired(): Promise<number> {
    const { rowCount } = await this.pool.query('DELETE FROM psono_connector_device_credentials WHERE expires_at <= now()')
    return rowCount ?? 0
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
