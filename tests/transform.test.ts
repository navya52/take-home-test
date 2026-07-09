import { transform } from "../src/forms/transform";
import { validate } from "../src/forms/validate";
import personOne from "../src/forms/examples/person_one.json";
import personTwo from "../src/forms/examples/person_two.json";

const coords = { longitude: 50.05, latitude: -5.05 };

describe("transform", () => {
	it("maps person_one fields and splits name", () => {
		const validated = validate(personOne);
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;

		const result = transform(validated.data, coords);
		expect(result.sessionId).toBe(personOne.session_id);
		expect(result.applicationReference).toBe(personOne.application_reference);
		expect(result.firstName).toBe("John");
		expect(result.lastName).toBe("Doe");
		expect(result.gender).toBe("male");
		expect(result.dateOfBirth).toEqual(new Date("1990-01-01"));
		expect(result.addressLine1).toBe(personOne.address.address_line_1);
		expect(result.longitude).toBe(50.05);
		expect(result.latitude).toBe(-5.05);
	});

	it("maps gender other → prefer-not-to-say and keeps multi-token last name", () => {
		const validated = validate(personTwo);
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;

		const result = transform(validated.data, coords);
		expect(result.firstName).toBe("Andy");
		expect(result.lastName).toBe("James Smith-Jones");
		expect(result.gender).toBe("prefer-not-to-say");
		expect(result.addressLine3).toBeUndefined();
	});

	it("uses empty lastName for single-token names", () => {
		const validated = validate({ ...personOne, name: "Madonna" });
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;

		const result = transform(validated.data, coords);
		expect(result.firstName).toBe("Madonna");
		expect(result.lastName).toBe("");
	});
});
