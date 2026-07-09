import { IngestedFormSchema } from "./schemas/ingested_schema";
import { TransformedFormSchema } from "./schemas/transformed_schema";

export function transform(
	validated: IngestedFormSchema,
	coords: { longitude: number; latitude: number }
): TransformedFormSchema {
	const trimmed = validated.name.trim();
	const spaceIdx = trimmed.indexOf(" ");
	const firstName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const lastName = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

	return {
		sessionId: validated.session_id,
		applicationReference: validated.application_reference,
		firstName,
		lastName,
		email: validated.email,
		gender: validated.gender === "other" ? "prefer-not-to-say" : validated.gender,
		dateOfBirth: new Date(validated.date_of_birth),
		phoneNumber: validated.phone_number,
		mobileNumber: validated.mobile_number,
		addressLine1: validated.address.address_line_1,
		addressLine2: validated.address.address_line_2,
		addressLine3: validated.address.address_line_3,
		postcode: validated.address.postcode,
		country: validated.address.country,
		longitude: coords.longitude,
		latitude: coords.latitude,
	};
}
