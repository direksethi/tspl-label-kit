# tspl-label-kit

Print anything you can draw on a canvas to a cheap TSPL thermal label printer over USB, from JavaScript, with no vendor driver.

Desktop label printers from Gprinter, Xprinter and many others speak TSPL, a plain command language. On Linux the kernel exposes a USB printer as a character device such as `/dev/usb/lp0`, and a label prints when the right bytes are written to it. This kit produces those bytes:

- A pure library that turns a 1-bit, greyscale or RGBA bitmap into a complete TSPL job (`SIZE`, `GAP`, `DIRECTION`, `REFERENCE`, `SHIFT`, `CLS`, `BITMAP`, `PRINT`). It has no dependencies and runs in a browser, a worker or Node.
- A declarative label layout model (text, lines, boxes, images, in millimetres) with a canvas renderer, field filling and resizing. Text is drawn by the canvas, so any script the browser can shape works, Thai included.
- A Node CLI that sends a job to the printer device, and an agent that polls an HTTP queue so a web app can print through a machine sitting next to the printer.

Because the label is sent as one bitmap, the printer's built-in fonts, code pages and barcode commands are not involved. What you draw is what prints.

## Supported printers

Tested on one printer only: the **Gprinter GP-3120TU** (203 dpi, USB), on Linux, with die-cut label rolls.

The job uses only basic TSPL commands, so other TSPL printers (other Gprinter models, Xprinter, TSC and similar) are expected to work, but none of them has been tried. Printers that speak only ESC/POS, ZPL or EPL are not supported.

## Install

Requires Node 20 or later.

The package is not published to npm yet. Install it from a checkout:

```sh
git clone <this repository>
cd tspl-label-kit
npm install
npm run build
npm link            # optional: puts the tspl-label command on your PATH
```

## Quick start: print a bitmap

```js
import { packRgba, buildTspl } from "tspl-label-kit";
import { findPrinter, sendToPrinter } from "tspl-label-kit/node";

// RGBA pixels, for example from canvas.getContext("2d").getImageData(...).
// An 80 x 60 mm label at 8 dots a mm is 640 x 480 pixels.
const bitmap = packRgba(imageData.data, 640, 480);

const job = buildTspl(bitmap, { widthMm: 80, heightMm: 60, copies: 1 });

const device = findPrinter({ usbId: "0471:0055" }); // or { device: "/dev/usb/lp0" }
await sendToPrinter(device, job);
```

`packGrey` does the same for one byte a pixel, and `fromPacked` wraps bytes that are already one bit a dot.

From the command line, the input is a binary PBM file (`P4`), which stores one bit a pixel in exactly the layout the printer uses:

```sh
# Any image to a 640 x 480 one-bit PBM, here with ImageMagick
magick input.png -resize 640x480! -monochrome label.pbm

tspl-label print label.pbm --width 80 --height 60

# Dry run: write the TSPL bytes to a file, send nothing to the printer
tspl-label print label.pbm --out label.tspl

# A calibration label with a frame and millimetre ticks
tspl-label test-pattern --width 80 --height 60
```

### Options

| Option | `tspl-label` flag | Agent environment variable | Default |
| --- | --- | --- | --- |
| Gap between labels, mm | `--gap` | `GAP_MM` | 2 |
| Move the print across the roll, dots | `--reference-x` | `REFERENCE_X` | 0 |
| Move the print along the roll, dots (0 or more) | `--shift-y` | `SHIFT_Y` | 0 |
| Turn the label half a turn | `--rotate` | `ROTATE=1` | off |
| Printer device path | `--device` | `PRINTER_DEVICE` | found by USB id |
| USB vendor:product id | `--usb-id` | `PRINTER_USB_ID` | `0471:0055` |
| Copies | `--copies` | set by each job | 1 |

The flags fall back to the same environment variables. `buildTspl` takes the same settings as `gapMm`, `referenceX`, `shiftY`, `rotate` and `copies`.

Two of these exist because of how a real printer behaves:

- **`referenceX`**: the print head is wider than most labels, and where the roll sits under it depends on the paper guides. If the print is shifted sideways or cut off at one edge, print `test-pattern` and adjust `referenceX` until the frame is complete. One GP-3120TU with an 80 mm roll needed 14 dots.
- **`rotate`**: the label feeds out bottom edge first or top edge first depending on how you look at the printer. `rotate` turns the bitmap half a turn so it reads the right way up as it comes out.

## The layout model

A design is a label size and a list of elements, all in millimetres from the top left corner. There are four kinds of element: `text`, `line`, `box` and `image`.

```js
import { drawLabel, renderLabel, labelPixels, buildTspl } from "tspl-label-kit";

const design = {
  width: 60,
  height: 40,
  elements: [
    { id: "title", kind: "text", x: 4, y: 4, w: 52, h: 6,
      text: "{title}", font: "Inter", weight: 700, size: 12, align: "left", lineHeight: 1.2 },
    { id: "thai", kind: "text", x: 4, y: 11, w: 52, h: 5,
      text: "{titleTh}", font: "Noto Sans Thai", weight: 500, size: 9 },
    { id: "rule", kind: "line", x: 4, y: 18, w: 52, h: 0.3 },
    { id: "note", kind: "text", x: 4, y: 20, w: 52, h: 16,
      text: "Batch {batch}\nBest before {date}", size: 8, lineHeight: 1.4 },
    { id: "mark", kind: "image", x: 44, y: 26, w: 12, h: 10, image: "mark" },
  ],
};

const values = { title: "Green tea", titleTh: "ชาเขียว", batch: "A-102", date: "" };

const canvas = document.createElement("canvas");
Object.assign(canvas, labelPixels(design));          // 480 x 320 at 8 dots a mm
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const bitmap = await renderLabel(ctx, design, values, {
  images: { mark: someImageElement },
  fallbackFonts: ["Noto Sans Thai"],
});
const job = buildTspl(bitmap, { widthMm: design.width, heightMm: design.height });
```

How it behaves:

- **Text** has a font family, weight (100 to 900), size in points, alignment, line height (a multiple of the size), tracking (in em) and an uppercase switch. It wraps at whitespace to the element's width and keeps its own line breaks. The element's height is not enforced: text that runs longer continues below.
- **Fields** are written `{name}` and filled from the values object. Braces with no matching key are left as typed. A line whose fields are all blank is left out, so `Best before {date}` above prints nothing when `date` is empty.
- **Thai and other scripts** are shaped by the canvas, so the font decides what is supported. List a Thai family in `fallbackFonts` (or set it as the element's font) so Thai text does not fall back to an arbitrary system font. In a browser the renderer waits for every font and weight the design uses before drawing. Thai is written without spaces between words, and the renderer breaks lines at whitespace only, so a long Thai line breaks only where the text has a space or a line break.
- **Lines** are filled rectangles whose height is the thickness, never thinner than one dot. **Boxes** are outlined rectangles with a 0.25 mm stroke.
- **Images** are looked up by key in `images`, fitted inside the element's box from the top left and keep their shape. An element whose image is missing is skipped.
- `drawLabel(ctx, design, values, { scale })` draws at any scale for an on-screen preview. `renderLabel` draws at printer resolution and returns the packed bitmap.
- `offset: { top, bottom, left, right }` (mm) moves the whole print to correct where the printer places it.
- `atSize(design, { width, height })` redraws a design for another label size: positions stretch with the label, type scales with the smaller of the two stretches, lines keep their thickness and images keep their shape.
- `cleanSize` and `cleanElements` turn untrusted input (a stored design, a request body) into a valid size and element list: known kinds only, numbers clamped, at most 60 elements.

Two example designs are included as starting points: `shippingLabel()` (80 x 60 mm; fields `name`, `phone`, `address`, `reference`) and `productLabel()` (50 x 30 mm; fields `title`, `titleTh`, `sku`, `price`).

The renderer needs a canvas 2D context. It is written against the small subset of the API it uses (see `LabelContext`), so a Node canvas library with the standard API should work, but only the browser types have been checked and the tests use a stand-in context.

## The agent and the queue

A web app usually cannot reach a USB printer. The agent closes that gap: it runs on the machine the printer is plugged into, asks your server for queued labels every two seconds and prints them. It only makes outgoing requests, so that machine needs no open port, public address or tunnel.

```sh
export LABEL_QUEUE_URL=https://example.com/api/label-queue
export LABEL_QUEUE_TOKEN=...          # shared secret, see below
tspl-label agent
```

Other settings (`PRINTER_DEVICE`, `PRINTER_USB_ID`, `GAP_MM`, `REFERENCE_X`, `SHIFT_Y`, `ROTATE`, `POLL_MS`) are listed in `.env.example`. `tspl-label agent --once` prints what is queued and exits. With `--out file` the agent writes each job to that file instead of a printer.

The agent looks the printer up again before every job, so unplugging and replugging it needs no restart. If the queue cannot be reached it logs the problem once, waits three poll intervals and keeps trying.

To run it as a service with systemd:

```ini
[Unit]
Description=Label print agent
After=network-online.target

[Service]
EnvironmentFile=/etc/tspl-label.env
ExecStart=/usr/bin/env tspl-label agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Queue contract

Your server implements two routes under `LABEL_QUEUE_URL`. Every request carries `Authorization: Bearer <LABEL_QUEUE_TOKEN>`; reject anything else with 401.

**`POST /next?info=<text>`** hands out the next job.

- `200` with a JSON job when one is queued. The server marks it as being printed so it is not handed out twice.
- `204` with no body when the queue is empty.
- `info` is a short status line, for example `hostname ready /dev/usb/lp0` or `hostname printer not found`. Each call also works as a heartbeat: a server that records the time of the last call can show whether the printer is online before a user sends a label.

```json
{
  "id": "5f0c",
  "width": 80,
  "height": 60,
  "dotsW": 640,
  "dotsH": 480,
  "copies": 1,
  "data": "<base64>"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Any string that identifies the job. |
| `width`, `height` | Label size in mm. |
| `dotsW`, `dotsH` | Bitmap size in dots. |
| `copies` | Number of labels to print. |
| `data` | Base64 of `ceil(dotsW / 8) * dotsH` bytes: rows top to bottom, most significant bit leftmost, `1` for black. |

`toJob(bitmap, { widthMm, heightMm, copies })` builds this object from a packed bitmap, typically in the browser that drew the label.

**`POST /jobs/<id>`** reports the result, with a JSON body:

```json
{ "status": "printed" }
{ "status": "failed", "error": "The label printer is not connected." }
```

The agent retries this report up to five times. A server should also give up on a job that was handed out but never reported (the reference server does so after two minutes), so a crash between the two calls does not leave a job stuck.

`examples/queue-server.mjs` is a complete in-memory implementation of this contract in about 150 lines, including a route to add jobs and one to read the printer's status. `examples/print-from-browser.js` shows the browser side. Keep the agent token on the server and the agent only; the browser should add jobs through a route protected by your own sign-in.

"Printed" means the bytes were written to the device. The agent does not read status back from the printer, so it cannot detect an empty roll or an open cover.

## Linux USB permissions

When a USB printer is plugged in, the kernel's `usblp` driver creates `/dev/usb/lp0` (then `lp1`, and so on). By default only root, or root and the `lp` group, may write to it. Find the printer's id:

```sh
lsusb
# Bus 001 Device 007: ID 0471:0055 ...
```

Then add a udev rule, for example `/etc/udev/rules.d/60-label-printer.rules`, with your own ids and a group your user belongs to:

```
SUBSYSTEM=="usbmisc", KERNEL=="lp*", ATTRS{idVendor}=="0471", ATTRS{idProduct}=="0055", GROUP="plugdev", MODE="0660"
```

Reload and replug the printer:

```sh
sudo udevadm control --reload-rules
sudo udevadm trigger
ls -l /dev/usb/lp*
```

The number in `lpN` depends on the order devices were plugged in. Leave `PRINTER_DEVICE` unset and the kit finds the right device by USB id through `/sys/class/usbmisc`.

If `/dev/usb/lp*` does not appear at all, check that the `usblp` kernel module is loaded and that CUPS or another driver has not claimed the printer.

Device lookup by USB id is Linux only. On another system, pass the device path yourself; this has not been tested.

## How TSPL BITMAP packing works

A 203 dpi head prints 8 dots a millimetre, so an 80 x 60 mm label is 640 x 480 dots. Each dot is one bit.

1. **Threshold.** Each pixel becomes a luminance, `(299 R + 587 G + 114 B) / 1000`, blended over white by its alpha so that transparent counts as paper. Luminance below the threshold (160 by default) is a black dot. The threshold sits above the midpoint so that the grey, anti-aliased edges of thin strokes print black instead of dropping out. There is no dithering: a thermal head has no greys, and text and line art print sharper without it.
2. **Pack.** Rows run top to bottom. Each row is `ceil(width / 8)` whole bytes, the leftmost dot in the most significant bit. A row whose width is not a multiple of 8 is padded at the end.

   ```
   10 dots wide, black at x = 0 and x = 9:

   x:     0 1 2 3 4 5 6 7   8 9 . . . . . .
   bits:  1 0 0 0 0 0 0 0   0 1 0 0 0 0 0 0
   bytes:      0x80              0x40
   ```

3. **Invert.** In TSPL `BITMAP` data a `0` bit prints and a `1` bit is left white, the reverse of the packing above and of nearly every other one-bit format. The kit keeps `1` for black everywhere and inverts as it writes the job. The padding bits become `1`, so they stay white.
4. **Send.** The job is ASCII lines ending in CR LF, with the raw bytes straight after the last comma of the `BITMAP` line:

   ```
   SIZE 80 mm,60 mm
   GAP 2 mm,0 mm
   DIRECTION 1
   REFERENCE 0,0
   SHIFT 0
   CLS
   BITMAP 0,0,80,480,0,<38400 raw bytes>
   PRINT 1,1
   ```

   `BITMAP x,y,width,height,mode,data` takes its width in bytes and its height in dots. The data is not quoted, escaped or length-prefixed; the printer counts `width * height` bytes. The whole job must reach the device as bytes, never through a text encoding. The printer remembers `SIZE`, `GAP`, `DIRECTION`, `REFERENCE` and `SHIFT` between jobs, so every job sends all of them.

## Limitations

- Tested on a single printer model, on Linux. See "Supported printers".
- 203 dpi is assumed by default. `renderLabel` and `testPattern` accept another dots-per-millimetre value, but nothing else has been printed.
- Threshold only, no dithering, so photographs print as hard black and white.
- One full-label bitmap per job. Printer fonts, native barcodes and QR commands, cutters, peelers and continuous (gapless) media are not handled; draw barcodes on the canvas yourself.
- Nothing is read back from the printer, so paper-out and similar faults are not detected.
- The CLI reads binary PBM and job JSON only. Convert other image formats first.
- Text wraps at whitespace only and is not clipped to its element's height.
- The reference queue server keeps jobs in memory and is an example, not a production service.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT. Copyright (c) 2026 Direk Sethi.
