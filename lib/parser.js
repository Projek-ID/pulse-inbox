function unique(items) { return [...new Set(items.filter(Boolean))]; }

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function htmlToText(html) {
  return decodeBasicEntities(String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function normalizeDigits(value) { return String(value || '').replace(/[^0-9]/g, ''); }

function extractOtp(text) {
  const source = decodeBasicEntities(String(text || '').replace(/<[^>]+>/g, ' '));
  if (!source) return [];
  const candidates = [];
  const labelled = source.match(/(?:otp|one[-\s]?time password|verification(?:\s+code)?|verify(?:\s+code)?|security code|confirmation code|passcode|auth(?:entication)? code|login code|sign[-\s]?in code|kode(?:\s+verifikasi)?)[^\d]{0,70}((?:\d[\s-]?){3,7}\d)/gi) || [];
  for (const match of labelled) {
    const digits = normalizeDigits(match);
    if (digits.length >= 4 && digits.length <= 8) candidates.push(digits.slice(-8));
  }
  const spaced = source.match(/(?<![\w])(?:\d[\s-]){3,7}\d(?![\w])/g) || [];
  for (const match of spaced) {
    const digits = normalizeDigits(match);
    if (digits.length >= 4 && digits.length <= 8) candidates.push(digits);
  }
  const generic = source.match(/(?<![\w])\d{4,8}(?![\w])/g) || [];
  for (const match of generic) candidates.push(match);
  return unique(candidates).filter(x => !/^20\d{2}$/.test(x)).slice(0, 8);
}

function extractLinks(text) {
  const source = decodeBasicEntities(String(text || ''));
  if (!source) return [];
  const hrefs = [];
  for (const match of source.matchAll(/(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) hrefs.push(match[1]);
  const plain = source.match(/https?:\/\/[^\s<>'"\]\)}]+/gi) || [];
  return unique([...hrefs, ...plain].map(u => u.replace(/[.,;:!?]+$/g, ''))).slice(0, 20);
}

function makePreview(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180); }

module.exports = { extractOtp, extractLinks, makePreview, htmlToText };
