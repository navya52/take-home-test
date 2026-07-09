import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type FormStatus = "received" | "ready" | "delivered" | "failed";

export type FormRow = {
	id: number;
	session_id: string;
	application_reference: string | null;
	raw_payload: string;
	transformed: string | null;
	status: FormStatus;
	error: string | null;
	email_sent_at: string | null;
	email_attempts: number;
	created_at: string;
	updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS forms (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL UNIQUE,
	application_reference TEXT,
	raw_payload TEXT NOT NULL,
	transformed TEXT,
	status TEXT NOT NULL CHECK (status IN ('received', 'ready', 'delivered', 'failed')),
	error TEXT,
	email_sent_at TEXT,
	email_attempts INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`;

const WAIT_POLL_MS = 50;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

let db: Database.Database | null = null;

function migrateSchemaIfNeeded(database: Database.Database): void {
	const table = database
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'forms'`)
		.get() as { name: string } | undefined;

	if (!table) {
		return;
	}

	const columns = database.pragma("table_info(forms)") as { name: string }[];
	const hasEmailAttempts = columns.some((col) => col.name === "email_attempts");

	if (!hasEmailAttempts) {
		database.exec("DROP TABLE forms");
	}
}

export function initDb(dbPath: string = path.join(process.cwd(), "data", "forms.db")): Database.Database {
	if (dbPath !== ":memory:") {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	}

	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	if (dbPath !== ":memory:") {
		migrateSchemaIfNeeded(db);
	}
	db.exec(SCHEMA);

	return db;
}

export function getDb(): Database.Database {
	if (!db) {
		throw new Error("Database not initialised. Call initDb() first.");
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

export function insertReceived(sessionId: string, applicationReference: string | null, rawPayload: unknown): FormRow | "conflict" {
	const now = new Date().toISOString();
	try {
		const result = getDb()
			.prepare(
				`INSERT INTO forms (session_id, application_reference, raw_payload, status, email_attempts, created_at, updated_at)
				 VALUES (?, ?, ?, 'received', 0, ?, ?)`
			)
			.run(sessionId, applicationReference, JSON.stringify(rawPayload), now, now);

		return getFormById(Number(result.lastInsertRowid))!;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("UNIQUE constraint failed")) {
			return "conflict";
		}
		throw err;
	}
}

export function getFormById(id: number): FormRow | undefined {
	return getDb().prepare(`SELECT * FROM forms WHERE id = ?`).get(id) as FormRow | undefined;
}

export function getFormBySessionId(sessionId: string): FormRow | undefined {
	return getDb().prepare(`SELECT * FROM forms WHERE session_id = ?`).get(sessionId) as FormRow | undefined;
}

export function updateProcessingResult(
	id: number,
	result: { status: "ready"; transformed: unknown } | { status: "failed"; error: string }
): FormRow {
	const now = new Date().toISOString();
	if (result.status === "ready") {
		getDb()
			.prepare(
				`UPDATE forms
				 SET status = 'ready', transformed = ?, error = NULL, updated_at = ?
				 WHERE id = ?`
			)
			.run(JSON.stringify(result.transformed), now, id);
	} else {
		getDb()
			.prepare(
				`UPDATE forms
				 SET status = 'failed', transformed = NULL, error = ?, updated_at = ?
				 WHERE id = ?`
			)
			.run(result.error, now, id);
	}
	return getFormById(id)!;
}

export function markEmailSent(id: number): FormRow {
	const now = new Date().toISOString();
	getDb()
		.prepare(`UPDATE forms SET email_sent_at = ?, updated_at = ? WHERE id = ?`)
		.run(now, now, id);
	return getFormById(id)!;
}

export function incrementEmailAttempt(id: number): FormRow {
	const now = new Date().toISOString();
	getDb()
		.prepare(`UPDATE forms SET email_attempts = email_attempts + 1, updated_at = ? WHERE id = ?`)
		.run(now, id);
	return getFormById(id)!;
}

export function resetEmailAttempts(id: number): FormRow {
	const now = new Date().toISOString();
	getDb()
		.prepare(`UPDATE forms SET email_attempts = 0, updated_at = ? WHERE id = ?`)
		.run(now, id);
	return getFormById(id)!;
}

export function listFormsPendingEmail(): FormRow[] {
	return getDb()
		.prepare(
			`SELECT * FROM forms
			 WHERE status = 'ready' AND email_sent_at IS NULL AND email_attempts < 5
			 ORDER BY id ASC`
		)
		.all() as FormRow[];
}

export function deliverNextReadyForm(): FormRow | undefined {
	const now = new Date().toISOString();
	const next = getDb()
		.prepare(`SELECT * FROM forms WHERE status = 'ready' ORDER BY id ASC LIMIT 1`)
		.get() as FormRow | undefined;

	if (!next) {
		return undefined;
	}

	const result = getDb()
		.prepare(
			`UPDATE forms SET status = 'delivered', updated_at = ? WHERE id = ? AND status = 'ready'`
		)
		.run(now, next.id);

	if (result.changes === 0) {
		return deliverNextReadyForm();
	}

	return getFormById(next.id);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilProcessed(
	sessionId: string,
	timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS
): Promise<FormRow> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const row = getFormBySessionId(sessionId);
		if (!row) {
			throw new Error(`No form found for session_id ${sessionId}`);
		}
		if (row.status !== "received") {
			return row;
		}
		await sleep(WAIT_POLL_MS);
	}

	const row = getFormBySessionId(sessionId);
	if (!row) {
		throw new Error(`No form found for session_id ${sessionId}`);
	}
	return row;
}
