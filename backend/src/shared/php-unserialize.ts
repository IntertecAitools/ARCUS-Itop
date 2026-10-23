import { AppError } from "../core/errors.js";

/**
 * Reads PHP's serialize() format: what some iTop extensions store in a text
 * field (the approval extension keeps its steps that way, ApprovalScheme.steps).
 *
 * Only plain data is supported -- arrays, strings, integers, floats, booleans
 * and null. Objects and references are refused, so nothing PHP-specific can
 * reach the BFF through it. String lengths are in bytes, so it works on the
 * UTF-8 bytes, not on JavaScript characters.
 *
 * Arrays come back as plain objects keyed by their PHP keys; `phpList()`
 * reads a 0..n-1 array as a JavaScript array.
 */

export type PhpValue = string | number | boolean | null | PhpArray;
export interface PhpArray {
  [key: string]: PhpValue;
}

function fail(message: string): never {
  throw new AppError("upstream_error", `Unreadable serialized data from iTop: ${message}.`);
}

export function phpUnserialize(text: string): PhpValue {
  const bytes = Buffer.from(text, "utf8");
  let pos = 0;

  const readUntil = (stop: string): string => {
    const end = bytes.indexOf(stop, pos, "utf8");
    if (end < 0) fail(`expected "${stop}" after byte ${pos}`);
    const value = bytes.toString("utf8", pos, end);
    pos = end + 1;
    return value;
  };
  const expect = (char: string) => {
    if (bytes.toString("utf8", pos, pos + 1) !== char) fail(`expected "${char}" at byte ${pos}`);
    pos += 1;
  };
  const integer = (raw: string): number => {
    if (!/^-?\d+$/.test(raw)) fail(`bad integer "${raw}"`);
    return Number(raw);
  };

  const value = (): PhpValue => {
    const type = bytes.toString("utf8", pos, pos + 1);
    if (type === "N") {
      pos += 1;
      expect(";");
      return null;
    }
    pos += 1;
    expect(":");
    switch (type) {
      case "i":
        return integer(readUntil(";"));
      case "d": {
        const raw = readUntil(";");
        const n = Number(raw);
        if (Number.isNaN(n) && raw !== "NAN") fail(`bad float "${raw}"`);
        return n;
      }
      case "b":
        return readUntil(";") === "1";
      case "s": {
        const length = integer(readUntil(":"));
        expect('"');
        if (pos + length > bytes.length) fail("string runs past the end");
        const s = bytes.toString("utf8", pos, pos + length);
        pos += length;
        expect('"');
        expect(";");
        return s;
      }
      case "a": {
        const count = integer(readUntil(":"));
        expect("{");
        const out: PhpArray = {};
        for (let i = 0; i < count; i += 1) {
          const key = value();
          if (typeof key !== "string" && typeof key !== "number") fail("array key is not a string or integer");
          out[String(key)] = value();
        }
        expect("}");
        return out;
      }
      default:
        return fail(`unsupported type "${type}"`);
    }
  };

  const result = value();
  if (pos !== bytes.length) fail("trailing data");
  return result;
}

/** A PHP list (keys 0..n-1) as an array; anything else as []. */
export function phpList(value: PhpValue | undefined): PhpValue[] {
  if (!value || typeof value !== "object") return [];
  const out: PhpValue[] = [];
  for (let i = 0; String(i) in value; i += 1) out.push(value[String(i)]!);
  return out;
}
