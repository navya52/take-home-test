import { geocode } from "./geocode";
import { transform } from "./transform";
import { validate } from "./validate";
import { TransformedFormSchema } from "./schemas/transformed_schema";

export type ProcessResult =
	| { status: "ready"; transformed: TransformedFormSchema }
	| { status: "failed"; error: string };

export async function processForm(rawPayload: unknown): Promise<ProcessResult> {
	const validated = validate(rawPayload);
	if (!validated.ok) {
		return { status: "failed", error: validated.error };
	}

	const coords = await geocode(validated.data.address.postcode);
	if (!coords.ok) {
		return { status: "failed", error: coords.error };
	}

	const transformed = transform(validated.data, {
		longitude: coords.longitude,
		latitude: coords.latitude,
	});

	return { status: "ready", transformed };
}
