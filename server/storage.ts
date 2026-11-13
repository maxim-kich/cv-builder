import type { CvTemplate } from "../src/templates";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import type { CvDocument } from "../src/cvStore";
import type { ResumeData } from "../src/types";

export interface CreateCvInput {
  title: string;
  resume: ResumeData;
  hideLanguageDots: boolean;
  template?: CvTemplate;
}

export interface UpdateCvInput {
  title?: string;
  resume?: ResumeData;
  hideLanguageDots?: boolean;
  template?: CvTemplate | null;
  expectedRevision?: number;
}

export type UpdateCvResult =
  | { status: "updated"; cv: CvDocument }
  | { status: "not_found" }
  | { status: "conflict"; cv: CvDocument };

export interface CvStorage {
  kind: "sqlite" | "postgres";
  init(): Promise<void>;
  list(): Promise<CvDocument[]>;
  get(id: string): Promise<CvDocument | null>;
  create(input: CreateCvInput): Promise<CvDocument>;
  update(id: string, input: UpdateCvInput): Promise<UpdateCvResult>;
  delete(id: string): Promise<boolean>;
  listTemplates(owner: string): Promise<CvTemplate[]>;
  getTemplate(owner: string, id: string): Promise<CvTemplate | null>;
  createTemplate(owner: string, input: Pick<CvTemplate, "title" | "source" | "fonts">): Promise<CvTemplate>;
  deleteTemplate(owner: string, id: string, expectedRevision: number): Promise<boolean>;
  close(): Promise<void>;
}

interface CvRow {
  id: string;
  title: string;
  resume: string | ResumeData;
  hide_language_dots: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
  revision: number;
  template?: string | CvTemplate | null;
}

function createId(): string {
  return crypto.randomUUID();
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToCv(row: CvRow): CvDocument {
  return {
    id: row.id,
    title: row.title,
    resume: typeof row.resume === "string" ? JSON.parse(row.resume) as ResumeData : row.resume,
    hideLanguageDots: Boolean(row.hide_language_dots),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    revision: Number(row.revision),
    ...(row.template ? { template: typeof row.template === "string" ? JSON.parse(row.template) : row.template } : {}),
  };
}

class SqliteStorage implements CvStorage {
  readonly kind = "sqlite" as const;
  private database?: DatabaseSync;

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS cvs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        resume TEXT NOT NULL,
        hide_language_dots INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS cvs_updated_at_idx ON cvs(updated_at DESC);
    `);
    if (!(this.database.prepare("PRAGMA table_info(cvs)").all() as { name: string }[]).some(c => c.name === "template")) this.database.exec("ALTER TABLE cvs ADD COLUMN template TEXT");
    this.database.exec("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL)");
  }

  private db(): DatabaseSync {
    if (!this.database) throw new Error("Storage has not been initialized");
    return this.database;
  }

  async list(): Promise<CvDocument[]> {
    return (this.db().prepare("SELECT * FROM cvs ORDER BY updated_at DESC").all() as unknown as CvRow[]).map(rowToCv);
  }

  async get(id: string): Promise<CvDocument | null> {
    const row = this.db().prepare("SELECT * FROM cvs WHERE id = ?").get(id) as unknown as CvRow | undefined;
    return row ? rowToCv(row) : null;
  }

  async create(input: CreateCvInput): Promise<CvDocument> {
    const now = new Date().toISOString();
    const cv: CvDocument = { id: createId(), ...input, createdAt: now, updatedAt: now, revision: 1 };
    this.db().prepare(`
      INSERT INTO cvs (id, title, resume, hide_language_dots, created_at, updated_at, revision, template)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cv.id, cv.title, JSON.stringify(cv.resume), cv.hideLanguageDots ? 1 : 0, now, now, cv.revision, cv.template ? JSON.stringify(cv.template) : null);
    return cv;
  }

  async update(id: string, input: UpdateCvInput): Promise<UpdateCvResult> {
    const current = await this.get(id);
    if (!current) return { status: "not_found" };
    if (input.expectedRevision && input.expectedRevision !== current.revision) return { status: "conflict", cv: current };
    const next: CvDocument = {
      ...current,
      template: input.template === null ? undefined : input.template ?? current.template,
      title: input.title ?? current.title,
      resume: input.resume ?? current.resume,
      hideLanguageDots: input.hideLanguageDots ?? current.hideLanguageDots,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
    };
    const result = this.db().prepare(`
      UPDATE cvs SET title = ?, resume = ?, hide_language_dots = ?, updated_at = ?, revision = ?, template = ?
      WHERE id = ? AND revision = ?
    `).run(next.title, JSON.stringify(next.resume), next.hideLanguageDots ? 1 : 0, next.updatedAt, next.revision, next.template ? JSON.stringify(next.template) : null, id, current.revision);
    if (Number(result.changes) === 0) {
      const latest = await this.get(id);
      return latest ? { status: "conflict", cv: latest } : { status: "not_found" };
    }
    return { status: "updated", cv: next };
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db().prepare("DELETE FROM cvs WHERE id = ?").run(id).changes) > 0;
  }

  async listTemplates(owner: string): Promise<CvTemplate[]> {
    const rows = this.db().prepare("SELECT document FROM templates WHERE owner = ? ORDER BY id").all(owner) as { document: string }[];
    return rows.map(row => JSON.parse(row.document) as CvTemplate);
  }
  async getTemplate(owner: string, id: string): Promise<CvTemplate | null> {
    const row = this.db().prepare("SELECT document FROM templates WHERE owner = ? AND id = ?").get(owner, id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as CvTemplate : null;
  }
  async createTemplate(owner: string, input: Pick<CvTemplate, "title" | "source" | "fonts">): Promise<CvTemplate> {
    const now = new Date().toISOString();
    const template = { ...input, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now };
    this.db().prepare("INSERT INTO templates VALUES (?, ?, ?, ?)").run(template.id, owner, JSON.stringify(template), 1);
    return template;
  }
  async deleteTemplate(owner: string, id: string, expectedRevision: number): Promise<boolean> {
    return Number(this.db().prepare("DELETE FROM templates WHERE owner = ? AND id = ? AND revision = ?").run(owner, id, expectedRevision).changes) > 0;
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }
}

class PostgresStorage implements CvStorage {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cvs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        resume JSONB NOT NULL,
        hide_language_dots BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS cvs_updated_at_idx ON cvs(updated_at DESC);
    `);
    await this.pool.query("ALTER TABLE cvs ADD COLUMN IF NOT EXISTS template JSONB");
    await this.pool.query("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL)");
  }

  async list(): Promise<CvDocument[]> {
    const result = await this.pool.query<CvRow>("SELECT * FROM cvs ORDER BY updated_at DESC");
    return result.rows.map(rowToCv);
  }

  async get(id: string): Promise<CvDocument | null> {
    const result = await this.pool.query<CvRow>("SELECT * FROM cvs WHERE id = $1", [id]);
    return result.rows[0] ? rowToCv(result.rows[0]) : null;
  }

  async create(input: CreateCvInput): Promise<CvDocument> {
    const now = new Date().toISOString();
    const cv: CvDocument = { id: createId(), ...input, createdAt: now, updatedAt: now, revision: 1 };
    await this.pool.query(`
      INSERT INTO cvs (id, title, resume, hide_language_dots, created_at, updated_at, revision, template)
      VALUES ($1, $2, $3::jsonb, $4, $5, $5, 1, $6::jsonb)
    `, [cv.id, cv.title, JSON.stringify(cv.resume), cv.hideLanguageDots, now, cv.template ? JSON.stringify(cv.template) : null]);
    return cv;
  }

  async update(id: string, input: UpdateCvInput): Promise<UpdateCvResult> {
    const current = await this.get(id);
    if (!current) return { status: "not_found" };
    if (input.expectedRevision && input.expectedRevision !== current.revision) return { status: "conflict", cv: current };
    const now = new Date().toISOString();
    const result = await this.pool.query<CvRow>(`
      UPDATE cvs SET title = $1, resume = $2::jsonb, hide_language_dots = $3,
        updated_at = $4, revision = revision + 1, template = $7::jsonb
      WHERE id = $5 AND revision = $6 RETURNING *
    `, [
      input.title ?? current.title,
      JSON.stringify(input.resume ?? current.resume),
      input.hideLanguageDots ?? current.hideLanguageDots,
      now,
      id,
      current.revision,
      JSON.stringify(input.template === null ? null : input.template ?? current.template ?? null),
    ]);
    if (!result.rows[0]) {
      const latest = await this.get(id);
      return latest ? { status: "conflict", cv: latest } : { status: "not_found" };
    }
    return { status: "updated", cv: rowToCv(result.rows[0]) };
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM cvs WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listTemplates(owner: string): Promise<CvTemplate[]> {
    const rows = (await this.pool.query<{ document: string }>("SELECT document FROM templates WHERE owner = $1 ORDER BY id", [owner])).rows;
    return rows.map(row => JSON.parse(row.document) as CvTemplate);
  }
  async getTemplate(owner: string, id: string): Promise<CvTemplate | null> {
    const result = await this.pool.query<{ document: string }>("SELECT document FROM templates WHERE owner = $1 AND id = $2", [owner, id]);
    return result.rows[0] ? JSON.parse(result.rows[0].document) as CvTemplate : null;
  }
  async createTemplate(owner: string, input: Pick<CvTemplate, "title" | "source" | "fonts">): Promise<CvTemplate> {
    const now = new Date().toISOString();
    const template = { ...input, id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now };
    await this.pool.query("INSERT INTO templates VALUES ($1, $2, $3, $4)", [template.id, owner, JSON.stringify(template), 1]);
    return template;
  }
  async deleteTemplate(owner: string, id: string, expectedRevision: number): Promise<boolean> {
    return (await this.pool.query("DELETE FROM templates WHERE owner = $1 AND id = $2 AND revision = $3", [owner, id, expectedRevision])).rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createStorage(databaseUrl: string): CvStorage {
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return new PostgresStorage(databaseUrl);
  }
  const rawPath = databaseUrl.startsWith("sqlite:") ? databaseUrl.slice("sqlite:".length) : databaseUrl;
  return new SqliteStorage(resolve(rawPath));
}
