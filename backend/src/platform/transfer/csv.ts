/**
 * Just enough CSV for the import's column mapping: read a file the way
 * iTop's bulk loader will (one separator, one qualifier that doubles to
 * escape itself, line breaks allowed inside qualified cells) and write it
 * back with a different header row and some columns dropped.
 */

export function parseCsv(text: string, separator: string, qualifier: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // A blank line is no record, as for iTop.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === qualifier) {
        if (text[i + 1] === qualifier) {
          cell += qualifier;
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }
    if (ch === qualifier) quoted = true;
    else if (ch === separator) endCell();
    else if (ch === "\r" && text[i + 1] === "\n") {
      endRow();
      i += 1;
    } else if (ch === "\n" || ch === "\r") endRow();
    else cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

export function writeCsv(rows: string[][], separator: string, qualifier: string): string {
  const quote = (value: string) =>
    value.includes(separator) || value.includes(qualifier) || /[\r\n]/.test(value) || value !== value.trim()
      ? `${qualifier}${value.split(qualifier).join(qualifier + qualifier)}${qualifier}`
      : value;
  return rows.map((r) => r.map(quote).join(separator)).join("\n") + "\n";
}

/**
 * Renames and drops columns: `mapping[i]` is the new heading for the file's
 * column `i`, or null to leave that column out.
 */
export function remapCsv(rows: string[][], mapping: (string | null)[]): string[][] {
  const keep = mapping.flatMap((target, index) => (target === null ? [] : [index]));
  const [, ...body] = rows;
  return [keep.map((index) => mapping[index]!), ...body.map((cells) => keep.map((index) => cells[index] ?? ""))];
}

/**
 * Defuses cells a spreadsheet would run as a formula (CSV injection): a cell
 * starting with = + - @ or a tab/CR gets a leading apostrophe, which Excel
 * and LibreOffice show as text. Ticket titles and descriptions come from end
 * users, so an export must not carry `=HYPERLINK(...)` live into an agent's
 * spreadsheet. Plain numbers ("-5", "+3.2") are left as they are.
 */
export function defuseFormulas(rows: string[][]): string[][] {
  return rows.map((cells) =>
    cells.map((cell) => (/^[=+\-@\t\r]/.test(cell) && !/^[+-]?\d+(\.\d+)?$/.test(cell) ? `'${cell}` : cell)),
  );
}
