import { validate } from "../src/forms/validate";
import personOne from "../src/forms/examples/person_one.json";
import personTwo from "../src/forms/examples/person_two.json";
import personThree from "../src/forms/examples/person_three.json";

describe("validate", () => {
	it("accepts person_one", () => {
		const result = validate(personOne);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.session_id).toBe(personOne.session_id);
			expect(result.data.phone_number).toBe("07123456789");
			expect(result.data.address.address_line_3).toBe("London");
		}
	});

	it("accepts person_two (multi-part name, no address_line_3)", () => {
		const result = validate(personTwo);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.gender).toBe("other");
			expect(result.data.address.address_line_3).toBeUndefined();
		}
	});

	it("accepts person_three (missing optional phone_number)", () => {
		const result = validate(personThree);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.phone_number).toBeUndefined();
		}
	});

	it("fails when mobile_number is missing", () => {
		const { mobile_number: _, ...rest } = personOne;
		const result = validate(rest);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("mobile_number");
		}
	});

	it("drops unknown/extra fields", () => {
		const result = validate({ ...personOne, unexpected_field: "boom", address: { ...personOne.address, extra: 1 } });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.data as Record<string, unknown>).unexpected_field).toBeUndefined();
			expect((result.data.address as Record<string, unknown>).extra).toBeUndefined();
		}
	});

	it("fails on invalid gender", () => {
		const result = validate({ ...personOne, gender: "nonbinary" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("gender");
		}
	});

	it("fails when a string field is a number", () => {
		const result = validate({ ...personOne, mobile_number: 7123456789 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("mobile_number");
		}
	});
});
