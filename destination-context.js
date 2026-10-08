// Explicit country changes must not inherit another trip's dates or answers.
const COUNTRIES = [
  ['תאילנד', /תאילנד|תילאנד|תאילאנד|thailand/iu],
  ['יפן', /יפן|japan/iu],
  ['ארצות הברית', /ארצות הברית|ארה[״"']?ב|united states|\busa\b/iu],
  ['בריטניה', /בריטניה|united kingdom/iu],
  ['קפריסין', /קפריסין|cyprus/iu],
];
export function namedCountries(text) {
  return COUNTRIES.filter(([,pattern])=>pattern.test(text || '')).map(([name])=>name);
}
export function scopeDestinationHistory(messages) {
  const latestIndex = messages.findLastIndex(m=>m.role==='user');
  if (latestIndex < 0) return messages;
  const current = namedCountries(messages[latestIndex].content);
  // Comparisons and trips across multiple countries keep their full context.
  if (current.length !== 1) return messages;
  const previous = messages.slice(0,latestIndex).filter(m=>m.role==='user').flatMap(m=>namedCountries(m.content));
  return previous.some(country=>country!==current[0]) ? messages.slice(latestIndex) : messages;
}
export function normalizeDestinationText(text) {
  return text.replace(/תילאנד|תאילאנד/gu,'תאילנד');
}
