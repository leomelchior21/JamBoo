export function readBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function readBoundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function readFlag(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? '').trim());
}
