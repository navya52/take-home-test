import { closeDb, getFormBySessionId, initDb, insertReceived, updateProcessingResult } from "../src/db/db";
import { attemptEmail } from "../src/forms/attemptEmail";
import * as sendgrid from "../src/providers/sendgrid";
import personOne from "../src/forms/examples/person_one.json";

jest.mock("../src/providers/sendgrid");

const sendEmail = sendgrid.sendEmail as jest.MockedFunction<typeof sendgrid.sendEmail>;

describe("attemptEmail", () => {
	let consoleErrorSpy: jest.SpyInstance;

	beforeEach(() => {
		closeDb();
		initDb(":memory:");
		jest.clearAllMocks();
		consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		closeDb();
		consoleErrorSpy.mockRestore();
	});

	function readyRow() {
		const inserted = insertReceived(personOne.session_id, personOne.application_reference, personOne);
		if (inserted === "conflict") {
			throw new Error("unexpected conflict");
		}
		return updateProcessingResult(inserted.id, {
			status: "ready",
			transformed: { sessionId: personOne.session_id, firstName: "John" },
		});
	}

	it("sets email_sent_at on success", async () => {
		sendEmail.mockResolvedValue({ statusCode: 200, body: undefined });
		const row = readyRow();

		const result = await attemptEmail(row);

		expect(result.email_sent_at).toBeTruthy();
		expect(result.email_attempts).toBe(0);
	});

	it("increments email_attempts on failure", async () => {
		sendEmail.mockResolvedValue({ statusCode: 500, body: undefined });
		const row = readyRow();

		const result = await attemptEmail(row);

		expect(result.email_sent_at).toBeNull();
		expect(result.email_attempts).toBe(1);
	});

	it("logs email_delivery_exhausted on 5th failure", async () => {
		sendEmail.mockResolvedValue({ statusCode: 500, body: undefined });
		let row = readyRow();

		for (let i = 0; i < 5; i++) {
			row = await attemptEmail(row);
		}

		expect(row.email_attempts).toBe(5);
		expect(row.status).toBe("ready");
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: "email_delivery_exhausted",
				session_id: personOne.session_id,
				attempts: 5,
			})
		);
	});
});
