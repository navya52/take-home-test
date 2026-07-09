import {
	FormRow,
	FormStatus,
	deliverNextReadyForm,
	getFormBySessionId,
	ProcessingTimeoutError,
	insertReceived,
	resetEmailAttempts,
	updateProcessingResult,
	waitUntilProcessed,
} from "../db/db";
import { attemptEmail } from "./attemptEmail";
import { processForm } from "./processForm";

export class HttpError extends Error {
	constructor(
		public statusCode: number,
		message: string
	) {
		super(message);
	}
}

export type FormResponse = {
	id: number;
	session_id: string;
	application_reference: string | null;
	status: FormStatus;
	error: string | null;
	email_sent_at: string | null;
	email_attempts: number;
	transformed: unknown | null;
	raw_payload: unknown;
	created_at: string;
	updated_at: string;
};

export type BotNextResponse = {
	form: { session_id: string; transformed: unknown } | null;
};

export function toFormResponse(row: FormRow): FormResponse {
	return {
		id: row.id,
		session_id: row.session_id,
		application_reference: row.application_reference,
		status: row.status,
		error: row.error,
		email_sent_at: row.email_sent_at,
		email_attempts: row.email_attempts,
		transformed: row.transformed ? JSON.parse(row.transformed) : null,
		raw_payload: JSON.parse(row.raw_payload),
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function ingestForm(rawPayload: unknown): Promise<FormResponse> {
	if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
		throw new HttpError(400, "Payload must be a JSON object");
	}

	const body = rawPayload as Record<string, unknown>;
	if (typeof body.session_id !== "string" || !body.session_id) {
		throw new HttpError(400, "session_id is required");
	}

	const applicationReference = typeof body.application_reference === "string" ? body.application_reference : null;

	const inserted = insertReceived(body.session_id, applicationReference, rawPayload);
	if (inserted === "conflict") {
		try {
			const existing = await waitUntilProcessed(body.session_id);
			return toFormResponse(existing);
		} catch (err) {
			if (err instanceof ProcessingTimeoutError) {
				throw new HttpError(504, err.message);
			}
			throw err;
		}
	}

	const result = await processForm(rawPayload);
	let row =
		result.status === "ready"
			? updateProcessingResult(inserted.id, { status: "ready", transformed: result.transformed })
			: updateProcessingResult(inserted.id, { status: "failed", error: result.error });

	if (row.status === "ready") {
		row = await attemptEmail(row);
	}

	return toFormResponse(row);
}

export async function retryForm(sessionId: string): Promise<FormResponse> {
	const existing = getFormBySessionId(sessionId);
	if (!existing) {
		throw new HttpError(404, `No form found for session_id ${sessionId}`);
	}

	if (existing.status === "delivered") {
		return toFormResponse(existing);
	}

	if (existing.status === "ready" && existing.email_sent_at) {
		return toFormResponse(existing);
	}

	if (existing.status === "ready" && !existing.email_sent_at) {
		const reset = resetEmailAttempts(existing.id);
		const row = await attemptEmail(reset);
		return toFormResponse(row);
	}

	const raw = JSON.parse(existing.raw_payload);
	const result = await processForm(raw);
	let row =
		result.status === "ready"
			? updateProcessingResult(existing.id, { status: "ready", transformed: result.transformed })
			: updateProcessingResult(existing.id, { status: "failed", error: result.error });

	if (row.status === "ready") {
		row = await attemptEmail(row);
	}

	return toFormResponse(row);
}

export function deliverNextForm(): BotNextResponse {
	const row = deliverNextReadyForm();
	if (!row || !row.transformed) {
		return { form: null };
	}

	return {
		form: {
			session_id: row.session_id,
			transformed: JSON.parse(row.transformed),
		},
	};
}
