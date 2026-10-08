import { normalizeDestinationText, scopeDestinationHistory } from "./destination-context.js";
// Deterministic fallback only: no model, scraping, inventory or date inference.
export const OWNER_SITE = 'https://www.travelor.com/he?fid=84016';
const DISCLAIMER = 'אין כאן מחיר או זמינות שנבדקו בזמן אמת. את התוצאה והתנאים יש לבדוק באתר לפני הזמנה.';
const DESTINATIONS = ['דובאי','פראג','ברלין','ברצלונה','אמסטרדם','פריז','לונדון','רומא','בנגקוק','פוקט','קוסמוי','קיוטו','טוקיו','יפן','תאילנד','קפריסין','לרנקה','פאפוס','אתונה','רודוס','כרתים','ניו יורק','אילת','ירושלים','תל אביב','dubai','prague','berlin','paris','london','tokyo','japan','thailand','cyprus'];
const INVENTORY = /מלון|מלונות|טיס[הות]|חביל[הת]|חופשה|מחיר|זמינות|דיל|הזמנה|באתר שלי|טרוולאור|travelor|beagent|hotel|flight|availability|price/i;
const SENSITIVE = /כשר|כשרות|חב.?ד|ויזה|אשר[הת]|דרכון|passport|visa|פיצוי|זכויות|תביעה|החזר|מונטריאול|eu261|כבודה|מזווד[הת]|baggage|חירום|תרופ[הת]|חיסון/i;
const CONCEPTS = [
  [/אוברבוק|overbook/i, 'אוברבוקינג הוא מכירת יותר מקומות מהקיבולת הזמינה. בקשו מהספק חלופה ותנאים בכתב, בדקו העברות והפרשי מחיר, ושמרו תיעוד. אין להבטיח פיצוי בלי בדיקת הדין ותנאי ההזמנה.'],
  [/בסיס אירוח|board basis|half board|full board|all inclusive|הכל כלול|חצי פנסיון|פנסיון מלא/i, 'בסיס האירוח מתאר מה כלול בשהייה: לינה בלבד, ארוחת בוקר, חצי פנסיון, פנסיון מלא או הכל כלול. התכולה המדויקת, המשקאות ושעות הארוחות נקבעים בתנאי המלון וההצעה, לא לפי שם המסלול בלבד.'],
  [/סוגי חדרים|twin|double room|חדר זוגי|חדר משפחתי/i, 'Double בדרך כלל מתאר מיטה זוגית ו-Twin מיטות נפרדות, אך סידור המיטות כפוף לתיאור החדר ולאישור המלון. בחדר משפחתי בדקו תפוסה, גילאי ילדים, מיטות נוספות ומה כלול במחיר.'],
  [/non.?refundable|לא ניתן לביטול/i, 'תעריף שאינו ניתן לביטול עשוי לחייב תשלום גם אם לא מגיעים. יש לקרוא את תנאי ההצעה המדויקת; אין להבטיח ביטול או החזר על בסיס ידע כללי.'],
];
function lastUser(messages) { return [...messages].reverse().find(m => m.role === 'user')?.content || ''; }
function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s;
}
function extractDates(text) {
  const result = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const value = m[1] ? m[0] : `${m[6]}-${m[5].padStart(2,'0')}-${m[4].padStart(2,'0')}`;
    if (validDate(value)) result.push(value);
  }
  return result;
}
export function travelSlots(messages) {
  messages = scopeDestinationHistory(messages).map(m=>({...m,content:normalizeDestinationText(m.content)}));
  const slots = { destination:null, dates:[], adults:null, children:null, ages:null, rooms:null };
  // Only recover slots from user words, never from an AI's guessed itinerary.
  let previous = '';
  for (const message of messages.slice(-12)) {
    if (message.role !== 'user') { previous = message.content; continue; }
    const text = message.content.trim();
    const explicit = /(?:^|\n)יעד\s*[:：]\s*([^\n,;]{2,60})/.exec(text)?.[1]?.trim();
    const named = DESTINATIONS.find(d => text.toLowerCase().includes(d.toLowerCase()));
    if (explicit || named) {
      const next = explicit || named;
      if (slots.destination && slots.destination !== next) {
        Object.assign(slots,{dates:[], adults:null, children:null, ages:null, rooms:null});
      }
      slots.destination = next;
    } else if (previous.includes('מה היעד לחיפוש?') && /^[\p{L} .'-]{2,60}$/u.test(text)) slots.destination = text;
    const dates = extractDates(text);
    if (dates.length) slots.dates = dates.slice(0,2);
    const adults = /(?:מבוגרים\s*[:：]\s*(\d+)|(\d+)\s*מבוגרים)/.exec(text);
    const children = /(?<!גילאי ה)(?<!גילאי )(?:ילדים\s*[:：]\s*(\d+)|(\d+)\s*ילדים)/.exec(text);
    const rooms = /(?:חדרים\s*[:：]\s*(\d+)|(\d+)\s*חדרים)/.exec(text);
    if (adults) slots.adults = Number(adults[1] || adults[2]);
    if (/זוג/.test(text)) slots.adults = 2;
    if (children) { slots.children = Number(children[1] || children[2]); slots.ages = null; }
    if (/ללא ילדים|בלי ילדים/.test(text)) { slots.children = 0; slots.ages = []; }
    if (rooms) slots.rooms = Number(rooms[1] || rooms[2]);
    const ages = /(?:גילאי הילדים|גילאים|גילאי|בני)\s*[:：]?\s*([\d\s,ו-]+)/.exec(text);
    if (ages) slots.ages = (ages[1].match(/\d+/g)||[]).map(Number);
    previous = '';
  }
  return slots;
}
function guidance(messages) {
  const s = travelSlots(messages);
  let question;
  if (!s.destination) question = 'מה היעד לחיפוש?';
  else if (s.dates.length !== 2 || s.dates[1] <= s.dates[0]) question = 'מה תאריך היציאה/הכניסה ומה תאריך החזרה/העזיבה? כתבו את שני התאריכים עם שנה, למשל בפורמט YYYY-MM-DD. איני מנחש שנה או תאריך יחסי.';
  else if (!Number.isInteger(s.adults) || s.adults < 1 || s.adults > 20 || !Number.isInteger(s.children) || s.children < 0 || s.children > 10) question = 'כמה מבוגרים וכמה ילדים? למשל: 2 מבוגרים, ללא ילדים. אם יש ילדים, ציינו את מספרם.';
  else if (s.children > 0 && (!s.ages || s.ages.length !== s.children || s.ages.some(a=>a<0||a>17))) question = 'מה גילאי הילדים בזמן הנסיעה? כתבו גיל לכל ילד, למשל: גילאי הילדים: 5, 9.';
  else if (/מלון|מלונות|hotel|חביל[הת]/i.test(messages.filter(m=>m.role==='user').map(m=>m.content).join(' ')) && (!Number.isInteger(s.rooms) || s.rooms<1 || s.rooms>10)) question = 'כמה חדרים נדרשים? למשל: חדרים: 1. את חלוקת הנוסעים בין החדרים יש להזין באתר.';
  const summary = [s.destination && `יעד: ${s.destination}`, s.dates.length===2 && `תאריכים: ${s.dates.join(' עד ')}`, s.adults!==null && `מבוגרים: ${s.adults}`, s.children!==null && `ילדים: ${s.children}`, s.children>0 && s.ages && `גילאי הילדים: ${s.ages.join(', ')}`, s.rooms!==null && `חדרים: ${s.rooms}`].filter(Boolean).join('\n');
  return `${summary ? summary+'\n\n' : ''}${question || 'הפרטים מוכנים לחיפוש. פתחו את האתר האישי והזינו אותם במנוע החיפוש; הפרטים לא הוזנו אוטומטית.'}\n\nאתר Travelor של יהודה: ${OWNER_SITE}\n${DISCLAIMER}`;
}
export function fallbackAnswer(messages, reason='ai_unavailable') {
  messages = scopeDestinationHistory(messages).map(m=>({...m,content:normalizeDestinationText(m.content)}));
  const latest = lastUser(messages);
  const concept = CONCEPTS.find(([pattern])=>pattern.test(latest));
  const continued = messages.some(m=>m.role==='assistant' && /מה היעד לחיפוש|מה תאריך היציאה|כמה מבוגרים וכמה ילדים|מה גילאי הילדים|כמה חדרים נדרשים/.test(m.content));
  let reply;
  if (concept) reply = concept[1]+'\n\nזהו ידע כללי, לא תנאים של הזמנה מסוימת.';
  else if (SENSITIVE.test(latest)) reply = 'השאלה דורשת מקור רשמי ועדכני המתאים למקרה. במצב הזה לא אקבע זכויות, סכומי פיצוי, כללי כבודה, כניסה למדינה או כשרות בלי אימות. ציינו את הספק/חברת התעופה, המסלול והתאריכים כדי לברר מול המקור המתאים.';
  else if (INVENTORY.test(latest) || (messages.some(m=>m.role==='user' && INVENTORY.test(m.content)) && /^(?:[\d\s,/:-]|מבוגרים|ילדים|גילאי|הילדים|חדרים|ללא|בלי|זוג|עד|ו)+$/.test(latest)) || (continued && /^[\p{L}\d\s,/.:'-]{1,120}$/u.test(latest)) || DESTINATIONS.some(d=>latest.toLowerCase().includes(d.toLowerCase()))) reply = guidance(messages);
  else reply = 'אפשר לעזור גם בלי AI בהבנת מושגי תיירות ובאיסוף פרטים לחיפוש באתר של יהודה. למחיר או זמינות, כתבו מה מחפשים, יעד, תאריכים והרכב נוסעים.\n\n'+OWNER_SITE+'\n'+DISCLAIMER;
  return {reply:'מענה קבוע ללא AI\n\n'+reply, basis:'knowledge', researchStatus:'deterministic_fallback', fallbackReason:reason, sources:[], liveInventory:false};
}

// Search snippets and affiliate login/home pages are not bookable quotes.
export function isHotelPriceQuery(messages) {
  const users = messages.filter(m=>m.role==='user');
  const latest = users.at(-1)?.content || '';
  return /מחיר|כמה עולה|כמה עולים|עלות|תעריף|price|cost|rate/i.test(latest)
    && /מלון|מלונות|לינה|hotel/i.test(users.map(m=>m.content).join(' '));
}
export function hotelPriceGuidance(messages) {
  const result = fallbackAnswer(messages,'travelor_inventory_not_connected');
  return {...result, reply:'מחירי מלונות ייבדקו רק באתר Travelor של יהודה. כרגע אין לבוט חיבור מאומת למלאי ולמחירים באתר, ולכן לא אציג מחיר מתוך זיכרון או תוצאת חיפוש כללית.\n\n'+guidance(messages), researchStatus:'travelor_inventory_not_connected'};
}
