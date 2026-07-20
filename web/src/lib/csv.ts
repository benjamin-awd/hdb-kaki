// CSV building + download, shared by the pages that offer a "download data" action.
// toCsv is pure (unit-tested); downloadCsv wraps it in the Blob + object-URL + <a download>
// pattern and therefore touches the DOM only when called (import-safe).

/** Quote one field per RFC 4180: wrap in "" and double internal quotes iff it contains a
 *  comma, quote, CR or LF. Numbers/other values are stringified first. */
const quote = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Build a CSV string (CRLF line endings, RFC-4180-ish quoting) from a header row and rows. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
}

/** Trigger a client-side download of `rows` as `filename`, via a transient object URL. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
