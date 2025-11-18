// Utilities for parsing tool arguments from various event encodings

export function parseToolArgs(input) {
  // Already an object or array
  if (input && (typeof input === 'object')) return input;

  // Nothing passed
  if (input == null) return {};

  const text = String(input);
  // Try strict JSON first
  try {
    const obj = JSON.parse(text);
    return obj;
  } catch {}

  // Try to parse simple key=value lines (INI-ish)
  const lines = text.split(/\r?\n/);
  const out = {};
  let parsedAny = false;
  for (const line of lines) {
    const m = /^\s*([^=#:\s]+)\s*[:=]\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    parsedAny = true;
    const k = m[1];
    let v = m[2];
    // Try to coerce
    if (/^\d+$/.test(v)) v = parseInt(v, 10);
    else if (/^\d+\.\d+$/.test(v)) v = parseFloat(v);
    else if (/^(true|false)$/i.test(v)) v = /^true$/i.test(v);
    else if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
      try { v = JSON.parse(v); } catch {}
    }
    out[k] = v;
  }
  if (parsedAny) return out;

  // Fallback: return as opaque string
  return { input: text };
}
