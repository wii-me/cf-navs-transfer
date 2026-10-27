export type ParsedCssColor = {
  hex: string
  alpha: number
  red: number
  green: number
  blue: number
}

export function clampAlpha(input: number): number {
  if (!Number.isFinite(input)) return 1
  return Math.min(1, Math.max(0, input))
}

export function formatAlpha(input: number): string {
  return clampAlpha(input).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim()
  const match = trimmed.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!match) return null

  const raw = match[1]
  if (raw.length === 3 || raw.length === 4) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase()
  }

  return `#${raw.slice(0, 6)}`.toLowerCase()
}

export function hexAlpha(input: string): number {
  const raw = input.trim().replace(/^#/, '')
  if (raw.length === 4) {
    return clampAlpha(parseInt(raw[3] + raw[3], 16) / 255)
  }
  if (raw.length === 8) {
    return clampAlpha(parseInt(raw.slice(6, 8), 16) / 255)
  }
  return 1
}

function clampByte(input: number): number {
  if (!Number.isFinite(input)) return 0
  return Math.min(255, Math.max(0, Math.round(input)))
}

function componentToHex(input: number): string {
  return clampByte(input).toString(16).padStart(2, '0')
}

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`
}

export function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return null

  return {
    red: parseInt(normalized.slice(1, 3), 16),
    green: parseInt(normalized.slice(3, 5), 16),
    blue: parseInt(normalized.slice(5, 7), 16),
  }
}

export type Hsv = { h: number; s: number; v: number }

export function rgbToHsv(red: number, green: number, blue: number): Hsv {
  const r = clampByte(red) / 255
  const g = clampByte(green) / 255
  const b = clampByte(blue) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : delta / max
  return { h, s: s * 100, v: max * 100 }
}

export function hsvToRgb(
  hue: number,
  saturation: number,
  value: number,
): { red: number; green: number; blue: number } {
  const h = ((hue % 360) + 360) % 360
  const s = Math.min(1, Math.max(0, saturation / 100))
  const v = Math.min(1, Math.max(0, value / 100))

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let r = 0
  let g = 0
  let b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }

  return {
    red: clampByte((r + m) * 255),
    green: clampByte((g + m) * 255),
    blue: clampByte((b + m) * 255),
  }
}

function parseRgbChannel(input: string): number {
  const value = input.trim()
  if (value.endsWith('%')) {
    return clampByte((Number.parseFloat(value) / 100) * 255)
  }
  return clampByte(Number.parseFloat(value))
}

function parseAlphaChannel(input: string | undefined): number {
  if (!input) return 1

  const value = input.trim()
  if (value.endsWith('%')) {
    return clampAlpha(Number.parseFloat(value) / 100)
  }
  return clampAlpha(Number.parseFloat(value))
}

function parseRgbColor(input: string): ParsedCssColor | null {
  const match = input
    .trim()
    .match(/^rgba?\(\s*([+-]?\d*\.?\d+%?)\s*(?:,|\s)\s*([+-]?\d*\.?\d+%?)\s*(?:,|\s)\s*([+-]?\d*\.?\d+%?)(?:\s*(?:,|\/)\s*([+-]?\d*\.?\d+%?))?\s*\)$/i)
  if (!match) return null

  const red = parseRgbChannel(match[1])
  const green = parseRgbChannel(match[2])
  const blue = parseRgbChannel(match[3])

  return {
    hex: rgbToHex(red, green, blue),
    alpha: parseAlphaChannel(match[4]),
    red,
    green,
    blue,
  }
}

export function parseCssColor(input: string): ParsedCssColor | null {
  const normalizedHex = normalizeHexColor(input)
  if (normalizedHex) {
    const rgb = hexToRgb(normalizedHex)
    if (!rgb) return null

    return {
      hex: normalizedHex,
      alpha: hexAlpha(input),
      ...rgb,
    }
  }

  return parseRgbColor(input)
}

export function formatCssColor(hex: string, alpha: number): string {
  const normalizedHex = normalizeHexColor(hex) ?? '#ffffff'
  const clampedAlpha = clampAlpha(alpha)
  if (clampedAlpha >= 1) return normalizedHex

  const rgb = hexToRgb(normalizedHex) ?? { red: 255, green: 255, blue: 255 }
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${formatAlpha(clampedAlpha)})`
}

export function colorToRgbString(input: string, fallback = '255 255 255'): string {
  const parsed = parseCssColor(input)
  if (!parsed) return fallback

  return `${parsed.red} ${parsed.green} ${parsed.blue}`
}

export function cssColorIncludesAlpha(input: string): boolean {
  const trimmed = input.trim()
  const hexBody = trimmed.startsWith('#') ? trimmed.slice(1) : ''
  return /^rgba\(/i.test(trimmed) || hexBody.length === 4 || hexBody.length === 8
}

export function splitCssColorAlpha(
  input: string,
  fallbackColor: string,
  fallbackAlpha: number,
): { color: string; alpha: number } {
  const trimmed = input.trim()
  const parsed = parseCssColor(trimmed)
  if (!parsed) {
    return {
      color: trimmed || fallbackColor,
      alpha: clampAlpha(fallbackAlpha),
    }
  }

  return {
    color: parsed.hex,
    alpha: cssColorIncludesAlpha(trimmed) ? parsed.alpha : clampAlpha(fallbackAlpha),
  }
}
