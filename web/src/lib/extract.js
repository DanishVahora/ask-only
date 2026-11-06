/**
 * AskOnly — reading a document without the document leaving the device.
 *
 * ── Why this is on-device and not in the enclave ─────────────────────────────
 *
 * 0G does serve an image-capable TeeML model (`0gm-1.0-35b-a3b`, text+image,
 * Intel TDX), so a photograph of a payslip COULD be sent into the enclave
 * directly. We deliberately don't.
 *
 * Sending the image means sending all of it: the employer, the PAN, the bank
 * account, the address — everything the camera caught. That throws away
 * minimisation, which is the strongest property this product has. Measured on
 * a real payslip, the enclave sees 4 of 12 lines.
 *
 * So the file is read HERE: PDF text with pdf.js, scans with Tesseract, both
 * running in this tab. The original never leaves the machine — not to our
 * server, and not to the enclave either. Only the handful of extracted lines
 * bearing on the permitted question are ever transmitted.
 *
 * Both libraries are bundled, so this works with no network once the page has
 * loaded. That matters at a venue.
 */

export const ACCEPT = ".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp";

const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name);
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** Collapse the whitespace soup that PDF and OCR extraction both produce,
 *  while keeping the line structure that minimisation matches against. */
function tidy(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function readPlain(file) {
  return tidy(await file.text());
}

/**
 * PDF text layer, page by page. Items are positioned fragments rather than
 * lines, so we rebuild lines from their y coordinate — otherwise "Gross" and
 * "68,000" arrive as separate entries and no line ever matches "gross".
 */
async function readPdf(file, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  // The worker is bundled by Vite rather than fetched from a CDN, so this
  // works offline and nothing about the document goes to a third party.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    onProgress?.(`reading page ${n} of ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      // round the baseline so fragments on the same visual line group together
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: item.transform[4], s: item.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // top of the page first
      .map(([, frags]) => frags.sort((a, b) => a.x - b.x).map((f) => f.s).join(" "));
    pages.push(lines.join("\n"));
  }
  await doc.destroy();
  return tidy(pages.join("\n"));
}

/** OCR, in this tab. Slow the first time because the model downloads, then cached. */
async function readImage(file, onProgress) {
  const { createWorker } = await import("tesseract.js");
  onProgress?.("loading the text recogniser…");
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress?.(`reading the image… ${Math.round((m.progress ?? 0) * 100)}%`);
      }
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return tidy(data.text);
  } finally {
    await worker.terminate();
  }
}

/**
 * Read a file into text, locally.
 *
 * @returns {{ text, kind, note }} - `note` is shown to the person so they know
 *   what happened to their file, rather than having to trust a claim.
 */
export async function extractLocally(file, onProgress) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("that file is over 20 MB — try a single page");
  }

  let text;
  let kind;
  if (isPdf(file)) {
    kind = "pdf";
    text = await readPdf(file, onProgress);
    if (!text) {
      // A PDF with no text layer is a scan in a PDF wrapper.
      throw new Error(
        "this PDF has no text layer — it is a scan. Export the page as an image and drop that in, so it can be read here.",
      );
    }
  } else if (isImage(file)) {
    kind = "image";
    text = await readImage(file, onProgress);
    if (!text) throw new Error("no text could be read from that image");
  } else {
    kind = "text";
    text = await readPlain(file);
    if (!text) throw new Error("that file is empty");
  }

  const lines = text.split("\n").length;
  return {
    text,
    kind,
    note:
      kind === "text"
        ? `${lines} lines read in this tab.`
        : kind === "pdf"
          ? `${lines} lines read from the PDF in this tab. The file itself was never uploaded.`
          : `${lines} lines read from the image in this tab. The image itself was never uploaded — not even to the enclave.`,
  };
}
