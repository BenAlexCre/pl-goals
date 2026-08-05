// Minimal RFC4180-ish CSV parser — no external dependency, matching this
// project's general preference for small, dependency-free utils. Handles
// quoted fields (with "" as an escaped literal quote) and commas inside
// quotes; does not handle multi-line quoted fields, which the fixed
// Identifier,Pot,Status,Notes format never needs.
function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields.map((f) => f.trim())
}

export function parseCsv(text) {
  return text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine)
}

// Parses the fixed Identifier,Pot,Status,Notes format (business-rules.md
// § Payment verification rules) into row objects. Tolerates an optional
// header row (skipped if its first column reads "identifier",
// case-insensitively) so a real spreadsheet export works unmodified.
export function parsePaymentCsv(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return []

  const looksLikeHeader = rows[0][0]?.toLowerCase() === 'identifier'
  const dataRows = looksLikeHeader ? rows.slice(1) : rows

  return dataRows.map(([identifier, pot, status, notes]) => ({
    identifier: identifier ?? '',
    pot: pot ?? '',
    status: status ?? '',
    notes: notes ?? '',
  }))
}
