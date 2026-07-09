import { FormRow, incrementEmailAttempt, markEmailSent } from "../db/db";
import { sendEmail } from "../providers/sendgrid";

const TEAM_EMAIL = "happyforms@bots.com";
const FROM_EMAIL = "noreply@healthtech1.uk";
const MAX_EMAIL_ATTEMPTS = 5;

export async function attemptEmail(row: FormRow): Promise<FormRow> {
	if (row.status !== "ready" || row.email_sent_at) {
		return row;
	}

	try {
		const response = await sendEmail({
			to: TEAM_EMAIL,
			from: FROM_EMAIL,
			subject: `Form ingested: ${row.session_id}`,
			body: `Form ${row.session_id} (${row.application_reference ?? "no ref"}) is ready for FORM-BOT.`,
		});

		if (response.statusCode === 200) {
			return markEmailSent(row.id);
		}
	} catch {
		// fall through to increment attempt
	}

	const updated = incrementEmailAttempt(row.id);
	if (updated.email_attempts >= MAX_EMAIL_ATTEMPTS) {
		console.error(
			JSON.stringify({
				event: "email_delivery_exhausted",
				session_id: updated.session_id,
				attempts: updated.email_attempts,
			})
		);
	}

	return updated;
}
