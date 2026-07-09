import { listFormsPendingEmail } from "../db/db";
import { attemptEmail } from "./attemptEmail";

const EMAIL_WORKER_INTERVAL_MS = 60_000;

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runEmailWorkerTick(): Promise<void> {
	const pending = listFormsPendingEmail();
	for (const row of pending) {
		await attemptEmail(row);
	}
}

export function startEmailWorker(): void {
	if (intervalId !== null) {
		return;
	}
	intervalId = setInterval(() => {
		void runEmailWorkerTick();
	}, EMAIL_WORKER_INTERVAL_MS);
}

export function stopEmailWorker(): void {
	if (intervalId !== null) {
		clearInterval(intervalId);
		intervalId = null;
	}
}

export async function runEmailWorkerOnce(): Promise<void> {
	await runEmailWorkerTick();
}
