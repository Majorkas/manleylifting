function escapeCsvValue(value) {
  const normalizedValue = value == null ? '' : String(value)
  if (/[",\n\r]/.test(normalizedValue)) {
    return `"${normalizedValue.replace(/"/g, '""')}"`
  }
  return normalizedValue
}

function sanitizeFilename(filename) {
  const fallback = 'export.csv'
  const normalized = String(filename || '').trim()
  if (!normalized) return fallback
  return normalized.replace(/[\\/:*?"<>|]+/g, '_')
}

export function buildCsv(columns, rows) {
  const safeColumns = Array.isArray(columns) ? columns : []
  const safeRows = Array.isArray(rows) ? rows : []

  const headerLine = safeColumns.map((column) => escapeCsvValue(column.header)).join(',')
  const dataLines = safeRows.map((row) =>
    safeColumns
      .map((column) => {
        const rawValue = typeof column.format === 'function'
          ? column.format(row?.[column.key], row)
          : row?.[column.key]
        return escapeCsvValue(rawValue)
      })
      .join(','),
  )

  return [headerLine, ...dataLines].join('\n')
}

export function downloadCsv(filename, csvContent) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const blob = new Blob(['\uFEFF', csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = sanitizeFilename(filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function exportRowsToCsv({ filename, columns, rows }) {
  const csvContent = buildCsv(columns, rows)
  downloadCsv(filename, csvContent)
}
