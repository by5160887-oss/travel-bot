// Runtime source/answer gates. Public code, no credentials or private data.
export function lastQuestion(messages) { return [...(messages || [])].reverse().find(m => m?.role === 'user')?.content || ''; }
const ENTRY = /דרכון|ויזה|אשרת|כניסה ל|passport|visa|entry requirement|תוקף/i;
const BAGGAGE = /כבודה|מזווד|מטען יד|טרולי|baggage|luggage|carry.?on|checked bag/i;
const LEGAL = /חוק שירותי תעופה|פיצוי|תביע|אוברבוק|overbook|זכויות נוסע|refund|מונטריאול|montreal/i;
export function isOfficialRequired(messages) {
  // Short followups retain the legal/entry/baggage context; unrelated new topics do not.
  const q = lastQuestion(messages);
  return ENTRY.test(q) || BAGGAGE.test(q) || LEGAL.test(q) || (q.length < 65 && /כמה|מה המועד|אז|מה עושים|what|how much/i.test(q) && messages.some(m => m.role === 'user' && (ENTRY.test(m.content) || BAGGAGE.test(m.content) || LEGAL.test(m.content))));
}
export function officialResearchQuery(messages) {
  const q = lastQuestion(messages);
  const context = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content).join(' ');
  return `${q}\nהקשר: ${context}\nמקורות ראשוניים בלבד: רשות הגירה או שגרירות לויזה ודרכון; חברת התעופה המפעילה לכבודה; ICAO לאמנת מונטריאול; ממשלה וחקיקה לזכויות נוסעים. בדוק מסלול, תעריף, אזרחות ותאריכים, לא כלל מהזיכרון.`;
}
export function authoritativeSources(sources) { return sources.filter(s => ['government','airline','legal_official'].includes(s.sourceType) && typeof s.content === 'string' && s.content.trim().length >= 30); }
export const NO_OFFICIAL_REPLY = 'לא הצלחתי לאמת את הכלל במקור רשמי ועדכני. איני יכול לצטט משקל, סכום, מועד או דרישת דרכון מהזיכרון. יש לבדוק באתר חברת התעופה או הרשות המתאימה לפי המסלול, סוג הכרטיס, הדרכון ותאריך הנסיעה.';
export function isChabadDirectory(messages) { return /חב["״'׳]?ד|chabad/i.test(lastQuestion(messages)) && !/מלון|מלונות|hotel/i.test(lastQuestion(messages)); }
export function directoryReply(sources) {
  const verified = sources.filter(s => s.sourceType === 'community_official' && s.content?.trim());
  if (!verified.length) return 'לא נמצא במקורות שנשלפו מידע מספיק לבניית רשימת בתי חב"ד. זו אינה הוכחה שאין בית חב"ד בעיר. בדוק במדריך chabad.org או באתר בית חב"ד המקומי.';
  return 'בתי חב"ד שנמצאו במקורות שנשלפו (לא רשימה מלאה):\n\n' + verified.map((s) => {
    const i = sources.indexOf(s);
    const text = s.content;
    const phone = text.match(/\+\d[\d ()-]{7,24}/)?.[0]?.trim();
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    const address = text.match(/(?:כתובת|Address)\s*[:：]\s*([^\n]{8,180})/i)?.[1]?.trim();
    return `${s.title}\nכתובת: ${address || 'לא אומתה בקטע המקור'}\nטלפון: ${phone || 'לא אומת בקטע המקור'}\nדוא"ל: ${email || 'לא אומת בקטע המקור'}\nקישור: ${s.url} [${i+1}]`;
  }).join('\n\n');
}
export function removeMixedScript(text) {
  // Protect complete URLs/email and non-Hebrew names; edit only mixed Hebrew words.
  return text.replace(/[\p{L}\p{M}]+/gu, word => {
    if (!/\p{Script=Hebrew}/u.test(word) || !/[\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(word)) return word;
    const fixed = word.replace(/ة/g,'ה');
    return /[\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(fixed) ? '[מילה לא ברורה]' : fixed;
  });
}
export function itineraryDays(messages) {
  const q=lastQuestion(messages);
  if (/כבודה|מועד|פיצוי|מונטריאול|תביע/i.test(q)) return 0;
  const m=q.match(/(?:^|\s)(\d{1,2})\s*(?:ימים|לילות|days)/i);
  return m ? Number(m[1]) : 0;
}
export function itineraryGaps(text, messages) {
  const days=itineraryDays(messages);if (!days) return [];
  const gaps=[];
  for(let n=1;n<=days;n++) if (!new RegExp(`יום\\s+${n}(?!\\d)`).test(text)) gaps.push(`יום ${n}`);
  for(const term of ['בוקר','צהריים','ערב','לינה','שבת','כשר']) if(!text.includes(term))gaps.push(term);
  return gaps;
}
export function onlyNecessaryFollowup(text, messages) {
  const q=lastQuestion(messages);
  const need=(ENTRY.test(q)&& !/ישראלי|ישראלית|אזרחות|דרכון (?:אמריקאי|אירופי)|israeli/i.test(q))
    || (/מלון|מלונות|hotel/i.test(q)&& !/\d{1,2}[./-]\d{1,2}|תאריך|תקציב/i.test(q))
    || (/מסלול|itinerary|טיול/i.test(q)&& !itineraryDays(messages));
  if(need)return text;
  // Strip optional last paragraph only, never questions embedded in quoted policy.
  return text.replace(/(?:\n\s*\n|\n)(?:האם תרצה|תרצה שא|רוצה שא|מה דעתך|איך אפשר לעזור|יש לך שאלות)[^\n]*[?？]\s*$/u,'').trim();
}
export function rejectUnsupportedNegative(text, messages, sources) {
  if (!/תאילנד|בנגקוק|thailand|bangkok/i.test(lastQuestion(messages))) return text;
  if (/אין (?:מלון|מלונות) כשר|לא קיים מלון כשר|no kosher hotels?/i.test(text)) return 'לא אומת כאן מלון בעל כשרות מלאה. זו אינה הוכחה שאין מלון כשר. אפשר לבדוק בנפרד מלון בעל אישור כשרות, לינה ליד בית חב"ד, או אוכל כשר במשלוח. כשרות הארוחות אינה כשרות של המלון כולו.\n' + sources.filter(s => s.sourceType === 'community_official').map((s) => `${s.title}: ${s.url} [${sources.indexOf(s)+1}]`).join('\n');
  return text;
}
export function travelorSteps(messages) {
  if(!/טרוולאור|טראוולור|travelor/i.test(lastQuestion(messages)) || !/איך|שלב|להשתמש|חיפוש|how/i.test(lastQuestion(messages)))return '';
  return 'חיפוש מלון ב-Travelor:\n1. פתח את הקישור האישי: https://www.travelor.com/he?fid=84016\n2. בחר יעד.\n3. הזן תאריכי הגעה ועזיבה.\n4. הזן חדרים, מבוגרים וילדים, כולל גילאי הילדים כאשר נדרש.\n5. לחץ חיפוש.\n6. בתוצאות בדוק סוג חדר, ארוחות, תפוסה ותנאי ביטול לפני בחירה. אל תניח שקיימת זמינות או עמלה לפני אישור במערכת.\nהכפתורים והמסננים עשויים להשתנות. אין לי גישה לחשבון הסוכן או להזמנות. אם המסך שונה, שלח צילום מסך בלי פרטי לקוח, תשלום או סודות כדי שאוכל להתאים את הצעד הבא.';
}
export function officialAnswerHasSupport(text, sources) {
  if (!sources.length) return false;
  // A changing numeric/legal claim must cite an actual provided official source.
  if (/מובטח|בוודאות זכאי|מגיע לך החזר מלא/.test(text)) return false;
  const claims = text.split(/\n/).filter(line => /\d|זכאי|חייב|מגיע לך|פטור|החזר מלא|מובטח/.test(line));
  return claims.every(line => {
    const refs=[...line.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])-1);
    return refs.some(i => sources[i] && ['government','airline','legal_official'].includes(sources[i].sourceType));
  });
}
