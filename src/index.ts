import app from "./app";
import { initDb } from "./db/db";
import { startEmailWorker } from "./forms/emailWorker";

const PORT = process.env.PORT || 3000;

initDb();
startEmailWorker();

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
