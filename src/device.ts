import { readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

/**
 * The USB vendor:product id the Gprinter GP-3120TU reports. Check yours with
 * `lsusb`; other models and brands report other ids.
 */
export const DEFAULT_USB_ID = "0471:0055";

export interface FindOptions {
	/** A device path to use as is, for example /dev/usb/lp0. */
	device?: string;
	/** USB vendor:product id in hex, as `lsusb` prints it. */
	usbId?: string;
	/** Where the kernel lists USB printer class devices. Only tests change this. */
	sysRoot?: string;
}

/**
 * The printer's device file: the configured one, or the lp device whose USB
 * id matches. Linux only.
 *
 * The kernel's usblp driver gives each USB printer a /dev/usb/lpN node, and
 * N depends on the order devices were plugged in, so a fixed path breaks as
 * soon as a second printer appears or the cable moves. Matching by USB id
 * through /sys/class/usbmisc finds the right node each time. Calling this
 * before every job also means a printer that was unplugged and plugged back
 * in is picked up without a restart.
 */
export function findPrinter(options: FindOptions = {}): string | null {
	if (options.device) return options.device;
	const usbId = (options.usbId || DEFAULT_USB_ID).toLowerCase();
	const root = options.sysRoot ?? "/sys/class/usbmisc";
	let names: string[] = [];
	try {
		names = readdirSync(root).filter((n) => /^lp\d+$/.test(n));
	} catch {
		return null;
	}
	for (const name of names) {
		try {
			// lpN/device is the USB interface; its parent is the USB device with the ids.
			const dir = `${root}/${name}/device/..`;
			const id = `${readFileSync(`${dir}/idVendor`, "utf8").trim()}:${readFileSync(`${dir}/idProduct`, "utf8").trim()}`;
			if (id.toLowerCase() === usbId) return `/dev/usb/${name}`;
		} catch {}
	}
	return null;
}

/**
 * Sends a job to the printer. The device is a plain character device: the
 * whole TSPL program is written to it in one go, and nothing is read back.
 * A regular file path works too, which is how a dry run captures a job.
 */
export async function sendToPrinter(device: string, tspl: Uint8Array) {
	await writeFile(device, tspl);
}

/** A device error in plain words. */
export function describeDeviceError(e: unknown): string {
	const code = (e as { code?: string } | null)?.code;
	if (code === "EACCES")
		return "This user is not allowed to write to the printer device. See the udev rule in the README.";
	if (code === "ENOENT" || code === "ENODEV") return "The label printer is not connected.";
	return String((e as { message?: string } | null)?.message ?? e);
}
