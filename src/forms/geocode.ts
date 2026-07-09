import { lookupPostcode } from "../providers/idealpostcodes";

export type GeocodeResult =
	| { ok: true; longitude: number; latitude: number }
	| { ok: false; error: string };

export async function geocode(postcode: string): Promise<GeocodeResult> {
	const response = await lookupPostcode(postcode);

	if (response.statusCode !== 200 || !response.body) {
		return {
			ok: false,
			error: `Geocode failed for postcode "${postcode}" (status ${response.statusCode})`,
		};
	}

	return {
		ok: true,
		longitude: response.body.longitude,
		latitude: response.body.latitude,
	};
}
