import { processForm } from "../src/forms/processForm";
import * as idealpostcodes from "../src/providers/idealpostcodes";
import personOne from "../src/forms/examples/person_one.json";

jest.mock("../src/providers/idealpostcodes");

const lookupPostcode = idealpostcodes.lookupPostcode as jest.MockedFunction<typeof idealpostcodes.lookupPostcode>;

describe("processForm", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it("returns ready with transformed data on success", async () => {
		lookupPostcode.mockResolvedValue({
			statusCode: 200,
			body: { longitude: 50.05, latitude: -5.05 },
		});

		const result = await processForm(personOne);
		expect(result.status).toBe("ready");
		if (result.status === "ready") {
			expect(result.transformed.firstName).toBe("John");
			expect(result.transformed.longitude).toBe(50.05);
		}
	});

	it("short-circuits on validation failure without geocoding", async () => {
		const { mobile_number: _, ...bad } = personOne;
		const result = await processForm(bad);
		expect(result.status).toBe("failed");
		if (result.status === "failed") {
			expect(result.error).toContain("mobile_number");
		}
		expect(lookupPostcode).not.toHaveBeenCalled();
	});

	it("short-circuits on geocode failure", async () => {
		lookupPostcode.mockResolvedValue({ statusCode: 500, body: undefined });

		const result = await processForm(personOne);
		expect(result.status).toBe("failed");
		if (result.status === "failed") {
			expect(result.error).toContain("Geocode failed");
		}
	});
});
