/**
 * Browser side of printing through a queue: draw a design on a canvas, pack
 * it into dots and post it as a job. Bundle this with your application.
 *
 * QUEUE_URL is your own route that adds a job (POST /jobs in
 * examples/queue-server.mjs). In a real application that route sits behind
 * your sign-in, and the browser never sees the agent's token.
 */
import { labelPixels, renderLabel, shippingLabel, toJob } from "tspl-label-kit";

const QUEUE_URL = "/api/label-queue/jobs";

export async function printShippingLabel(values, copies = 1) {
	const design = shippingLabel();
	const canvas = document.createElement("canvas");
	Object.assign(canvas, labelPixels(design));
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const bitmap = await renderLabel(ctx, design, values, {
		fallbackFonts: ["Noto Sans Thai"],
	});
	const res = await fetch(QUEUE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(toJob(bitmap, { widthMm: design.width, heightMm: design.height, copies })),
	});
	if (!res.ok) throw new Error(`The queue answered ${res.status}.`);
	return res.json();
}
