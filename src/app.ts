import express, { NextFunction, Request, Response } from "express";
import { HttpError, deliverNextForm, ingestForm, retryForm } from "./forms/service";

const app = express();

app.use(express.json());

app.post("/ingest", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const form = await ingestForm(req.body);
		res.json(form);
	} catch (err) {
		next(err);
	}
});

app.post("/retry", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const sessionId = req.body?.session_id;
		if (typeof sessionId !== "string" || !sessionId) {
			throw new HttpError(400, "session_id is required");
		}
		const form = await retryForm(sessionId);
		res.json(form);
	} catch (err) {
		next(err);
	}
});

app.post("/bot/next", (req: Request, res: Response, next: NextFunction) => {
	try {
		res.json(deliverNextForm());
	} catch (err) {
		next(err);
	}
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
	if (err instanceof HttpError) {
		res.status(err.statusCode).json({ error: err.message });
		return;
	}
	console.error(err);
	res.status(500).json({ error: "Internal server error" });
});

export default app;
