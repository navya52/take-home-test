import request from "supertest";
import app from "../src/app";
import {
	ProcessingTimeoutError,
	closeDb,
	getDb,
	getFormBySessionId,
	initDb,
	insertReceived,
	updateProcessingResult,
	waitUntilProcessed,
} from "../src/db/db";
import { runEmailWorkerOnce } from "../src/forms/emailWorker";
import * as idealpostcodes from "../src/providers/idealpostcodes";
import * as sendgrid from "../src/providers/sendgrid";
import personOne from "../src/forms/examples/person_one.json";
import personTwo from "../src/forms/examples/person_two.json";

jest.mock("../src/providers/idealpostcodes");
jest.mock("../src/providers/sendgrid");

const lookupPostcode = idealpostcodes.lookupPostcode as jest.MockedFunction<typeof idealpostcodes.lookupPostcode>;
const sendEmail = sendgrid.sendEmail as jest.MockedFunction<typeof sendgrid.sendEmail>;

function mockGeocodeSuccess() {
	lookupPostcode.mockResolvedValue({
		statusCode: 200,
		body: { longitude: 50.05, latitude: -5.05 },
	});
}

function mockEmailSuccess() {
	sendEmail.mockResolvedValue({ statusCode: 200, body: undefined });
}

describe("API integration", () => {
	beforeEach(() => {
		closeDb();
		initDb(":memory:");
		jest.clearAllMocks();
		mockGeocodeSuccess();
		mockEmailSuccess();
	});

	afterEach(() => {
		closeDb();
	});

	it("ingests a form to ready and sends email", async () => {
		const response = await request(app).post("/ingest").send(personOne);
		expect(response.status).toBe(200);
		expect(response.body.status).toBe("ready");
		expect(response.body.transformed.firstName).toBe("John");
		expect(response.body.email_sent_at).toBeTruthy();
		expect(response.body.email_attempts).toBe(0);
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("dedupes on session_id without reprocessing", async () => {
		const first = await request(app).post("/ingest").send(personOne);
		expect(first.status).toBe(200);

		lookupPostcode.mockClear();
		sendEmail.mockClear();

		const second = await request(app)
			.post("/ingest")
			.send({ ...personOne, name: "Different Person" });

		expect(second.status).toBe(200);
		expect(second.body.id).toBe(first.body.id);
		expect(second.body.transformed.firstName).toBe("John");
		expect(lookupPostcode).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("marks failed on geocode error and retries to ready", async () => {
		lookupPostcode.mockResolvedValueOnce({ statusCode: 500, body: undefined });

		const failed = await request(app).post("/ingest").send(personOne);
		expect(failed.body.status).toBe("failed");
		expect(failed.body.raw_payload.session_id).toBe(personOne.session_id);

		mockGeocodeSuccess();
		const retried = await request(app).post("/retry").send({ session_id: personOne.session_id });
		expect(retried.status).toBe(200);
		expect(retried.body.status).toBe("ready");
		expect(retried.body.email_sent_at).toBeTruthy();
	});

	it("resets email_attempts and retries email when ready but unsent", async () => {
		sendEmail.mockResolvedValueOnce({ statusCode: 500, body: undefined });

		const ingested = await request(app).post("/ingest").send(personOne);
		expect(ingested.body.status).toBe("ready");
		expect(ingested.body.email_sent_at).toBeNull();
		expect(ingested.body.email_attempts).toBe(1);

		lookupPostcode.mockClear();
		sendEmail.mockClear();
		mockEmailSuccess();

		const retried = await request(app).post("/retry").send({ session_id: personOne.session_id });
		expect(retried.status).toBe(200);
		expect(retried.body.status).toBe("ready");
		expect(retried.body.email_sent_at).toBeTruthy();
		expect(retried.body.email_attempts).toBe(0);
		expect(lookupPostcode).not.toHaveBeenCalled();
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("retries stuck received rows", async () => {
		insertReceived(personOne.session_id, personOne.application_reference, personOne);
		const stuck = getDb().prepare(`SELECT status FROM forms WHERE session_id = ?`).get(personOne.session_id) as {
			status: string;
		};
		expect(stuck.status).toBe("received");

		const retried = await request(app).post("/retry").send({ session_id: personOne.session_id });
		expect(retried.status).toBe(200);
		expect(retried.body.status).toBe("ready");
	});

	it("returns 400 when ingesting without session_id", async () => {
		const { session_id: _, ...rest } = personOne;
		const response = await request(app).post("/ingest").send(rest);
		expect(response.status).toBe(400);
	});

	it("fails validation via ingest and keeps raw for retry after fix", async () => {
		const { mobile_number: _, ...bad } = personOne;
		const failed = await request(app).post("/ingest").send(bad);
		expect(failed.body.status).toBe("failed");
		expect(failed.body.error).toContain("mobile_number");
		expect(failed.body.raw_payload.session_id).toBe(personOne.session_id);

		getDb()
			.prepare(`UPDATE forms SET raw_payload = ? WHERE session_id = ?`)
			.run(JSON.stringify(personOne), personOne.session_id);

		const retried = await request(app).post("/retry").send({ session_id: personOne.session_id });
		expect(retried.body.status).toBe("ready");
		expect(retried.body.transformed.firstName).toBe("John");
	});

	it("concurrent duplicate ingest waits for winner without reprocessing", async () => {
		lookupPostcode.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(
						() => resolve({ statusCode: 200, body: { longitude: 50.05, latitude: -5.05 } }),
						300
					)
				)
		);

		const first = request(app).post("/ingest").send(personOne);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const second = request(app)
			.post("/ingest")
			.send({ ...personOne, name: "Different Person" });

		const [firstRes, secondRes] = await Promise.all([first, second]);

		expect(firstRes.body.id).toBe(secondRes.body.id);
		expect(firstRes.body.status).toBe("ready");
		expect(secondRes.body.status).toBe("ready");
		expect(secondRes.body.transformed.firstName).toBe("John");
		expect(lookupPostcode).toHaveBeenCalledTimes(1);
	});

	it("POST /bot/next returns oldest ready form and marks delivered", async () => {
		await request(app).post("/ingest").send(personOne);
		await request(app).post("/ingest").send(personTwo);

		const first = await request(app).post("/bot/next");
		expect(first.status).toBe(200);
		expect(first.body.form.session_id).toBe(personOne.session_id);
		expect(first.body.form.transformed.firstName).toBe("John");

		const rowOne = getFormBySessionId(personOne.session_id);
		expect(rowOne?.status).toBe("delivered");

		const second = await request(app).post("/bot/next");
		expect(second.body.form.session_id).toBe(personTwo.session_id);

		const third = await request(app).post("/bot/next");
		expect(third.body.form).toBeNull();
	});

	it("does not return delivered form from bot/next again", async () => {
		await request(app).post("/ingest").send(personOne);
		await request(app).post("/bot/next");

		const again = await request(app).post("/bot/next");
		expect(again.body.form).toBeNull();
	});

	it("email worker picks up pending emails", async () => {
		sendEmail.mockResolvedValueOnce({ statusCode: 500, body: undefined });
		await request(app).post("/ingest").send(personOne);

		const before = getFormBySessionId(personOne.session_id);
		expect(before?.email_sent_at).toBeNull();
		expect(before?.email_attempts).toBe(1);

		sendEmail.mockResolvedValue({ statusCode: 200, body: undefined });
		await runEmailWorkerOnce();

		const after = getFormBySessionId(personOne.session_id);
		expect(after?.email_sent_at).toBeTruthy();
	});
});

describe("waitUntilProcessed", () => {
	beforeEach(() => {
		closeDb();
		initDb(":memory:");
	});

	afterEach(() => {
		closeDb();
	});

	it("waits until status is not received", async () => {
		const inserted = insertReceived(personOne.session_id, personOne.application_reference, personOne);
		if (inserted === "conflict") {
			throw new Error("unexpected conflict");
		}

		setTimeout(() => {
			updateProcessingResult(inserted.id, {
				status: "ready",
				transformed: { sessionId: personOne.session_id },
			});
		}, 100);

		const row = await waitUntilProcessed(personOne.session_id, 5000);
		expect(row.status).toBe("ready");
	});

	it("throws if timeout hits before processing finishes", async () => {
		insertReceived(personOne.session_id, personOne.application_reference, personOne);

		await expect(waitUntilProcessed(personOne.session_id, 150)).rejects.toBeInstanceOf(
			ProcessingTimeoutError
		);
	});
});
