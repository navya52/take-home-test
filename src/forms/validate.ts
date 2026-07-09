import { IngestedFormSchema } from "./schemas/ingested_schema";

export type ValidateResult = { ok: true; data: IngestedFormSchema } | { ok: false; error: string };

const GENDERS = new Set(["male", "female", "other"]);

export function validate(raw: unknown): ValidateResult {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, error: "Payload must be a JSON object" };
	}

	const body = raw as Record<string, unknown>;

	const session_id = asString(body.session_id, "session_id");
	if (!session_id.ok) return session_id;

	const application_reference = asString(body.application_reference, "application_reference");
	if (!application_reference.ok) return application_reference;

	const name = asString(body.name, "name");
	if (!name.ok) return name;

	const email = asString(body.email, "email");
	if (!email.ok) return email;

	const genderRaw = asString(body.gender, "gender");
	if (!genderRaw.ok) return genderRaw;
	if (!GENDERS.has(genderRaw.value)) {
		return { ok: false, error: `gender must be one of male|female|other, got "${genderRaw.value}"` };
	}

	const date_of_birth = asString(body.date_of_birth, "date_of_birth");
	if (!date_of_birth.ok) return date_of_birth;

	let phone_number: string | undefined;
	if (body.phone_number !== undefined && body.phone_number !== null) {
		const phone = asString(body.phone_number, "phone_number");
		if (!phone.ok) return phone;
		phone_number = phone.value;
	}

	const mobile_number = asString(body.mobile_number, "mobile_number");
	if (!mobile_number.ok) return mobile_number;

	if (body.address === null || typeof body.address !== "object" || Array.isArray(body.address)) {
		return { ok: false, error: "address must be an object" };
	}
	const address = body.address as Record<string, unknown>;

	const address_line_1 = asString(address.address_line_1, "address.address_line_1");
	if (!address_line_1.ok) return address_line_1;

	const address_line_2 = asString(address.address_line_2, "address.address_line_2");
	if (!address_line_2.ok) return address_line_2;

	let address_line_3: string | undefined;
	if (address.address_line_3 !== undefined && address.address_line_3 !== null) {
		const line3 = asString(address.address_line_3, "address.address_line_3");
		if (!line3.ok) return line3;
		address_line_3 = line3.value;
	}

	const postcode = asString(address.postcode, "address.postcode");
	if (!postcode.ok) return postcode;

	const country = asString(address.country, "address.country");
	if (!country.ok) return country;

	const data: IngestedFormSchema = {
		session_id: session_id.value,
		application_reference: application_reference.value,
		name: name.value,
		email: email.value,
		gender: genderRaw.value as IngestedFormSchema["gender"],
		date_of_birth: date_of_birth.value,
		phone_number,
		mobile_number: mobile_number.value,
		address: {
			address_line_1: address_line_1.value,
			address_line_2: address_line_2.value,
			address_line_3,
			postcode: postcode.value,
			country: country.value,
		},
	};

	return { ok: true, data };
}

function asString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
	if (value === undefined || value === null) {
		return { ok: false, error: `${field} is required` };
	}
	if (typeof value !== "string") {
		return { ok: false, error: `${field} must be a string` };
	}
	return { ok: true, value };
}
