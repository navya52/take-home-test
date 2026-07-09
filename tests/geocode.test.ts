import { geocode } from "../src/forms/geocode";
import * as idealpostcodes from "../src/providers/idealpostcodes";

jest.mock("../src/providers/idealpostcodes");

const lookupPostcode = idealpostcodes.lookupPostcode as jest.MockedFunction<typeof idealpostcodes.lookupPostcode>;

describe("geocode", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	it("returns coords on success", async () => {
		lookupPostcode.mockResolvedValue({
			statusCode: 200,
			body: { longitude: 50.05, latitude: -5.05 },
		});

		const result = await geocode("E15 4BZ");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.longitude).toBe(50.05);
			expect(result.latitude).toBe(-5.05);
		}
	});

	it("fails on non-200 or missing body", async () => {
		lookupPostcode.mockResolvedValue({ statusCode: 500, body: undefined });

		const result = await geocode("E15 4BZ");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Geocode failed");
		}
	});
});
