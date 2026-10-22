import { Readable } from "node:stream";
import Papa from "papaparse";

const CSV_ENCODING_SAMPLE_SIZE = 64 * 1024;

function detectCsvEncoding(buffer: Buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return "utf-8";
  }

  for (let trim = 0; trim <= Math.min(4, buffer.length); trim += 1) {
    const sample = trim > 0 ? buffer.subarray(0, buffer.length - trim) : buffer;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return "utf-8";
    } catch {
      // Try trimming possible partial trailing UTF-8 bytes before falling back.
    }
  }
  return "gb18030";
}

async function* decodeCsvTextChunks(stream: ReadableStream<Uint8Array>) {
  const nodeStream = Readable.fromWeb(stream as any);
  const sampleChunks: Buffer[] = [];
  let sampleLength = 0;
  let decoder: InstanceType<typeof TextDecoder> | null = null;

  for await (const chunk of nodeStream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!decoder) {
      sampleChunks.push(buffer);
      sampleLength += buffer.length;
      if (sampleLength < CSV_ENCODING_SAMPLE_SIZE) continue;

      const sampleBuffer = Buffer.concat(sampleChunks);
      decoder = new TextDecoder(detectCsvEncoding(sampleBuffer));
      const text = decoder.decode(sampleBuffer, { stream: true });
      if (text) yield text;
      sampleChunks.length = 0;
      continue;
    }

    const text = decoder.decode(buffer, { stream: true });
    if (text) yield text;
  }

  if (!decoder) {
    const sampleBuffer = Buffer.concat(sampleChunks);
    decoder = new TextDecoder(detectCsvEncoding(sampleBuffer));
    const text = decoder.decode(sampleBuffer);
    if (text) yield text;
    return;
  }

  const rest = decoder.decode();
  if (rest) yield rest;
}

export async function* parseCsvRowsByHeader(options: {
  stream: ReadableStream<Uint8Array>;
  isHeaderRow: (cells: unknown[]) => boolean;
  cleanCell: (value: unknown) => string;
  missingHeaderMessage: string;
}) {
  const textStream = Readable.from(decodeCsvTextChunks(options.stream));
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
    header: false,
    skipEmptyLines: true,
  });
  textStream.pipe(parser);

  let headers: string[] | null = null;
  let parsedRowNumber = 0;
  try {
    for await (const cells of parser as AsyncIterable<unknown[]>) {
      parsedRowNumber += 1;
      if (!headers) {
        if (options.isHeaderRow(cells)) headers = cells.map(options.cleanCell);
        continue;
      }

      const row: Record<string, string> = {};
      headers.forEach((header, cellIndex) => {
        if (header) row[header] = options.cleanCell(cells[cellIndex]);
      });
      yield { row, lineNumber: parsedRowNumber };
    }
  } catch (err: any) {
    throw new Error(`CSV解析失败：${err?.message || "文件格式异常"}`);
  }

  if (!headers) throw new Error(options.missingHeaderMessage);
}
