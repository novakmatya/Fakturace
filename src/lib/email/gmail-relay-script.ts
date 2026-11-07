/**
 * Zdrojový kód skriptu Google Apps Script, který odesílá e-maily z Gmailu
 * majitele. Uživatel ho zkopíruje z Nastavení → E-maily do script.google.com
 * a nasadí jako webovou aplikaci. Používá jen MailApp (oprávnění „odesílat
 * e-maily vaším jménem“) – skript nečte vaši poštu.
 */
const SCRIPT = String.raw`/**
 * Fakturace – odesílání faktur z vašeho Gmailu.
 * Nasazení: Nasadit → Nové nasazení → Webová aplikace,
 *   Spustit jako: Já, Kdo má přístup: Kdokoli.
 * Tajný klíč níže musí být stejný jako GMAIL_RELAY_SECRET v aplikaci.
 */
const TAJNY_KLIC = __SECRET__;

function doPost(e) {
  let pozadavek;
  try {
    pozadavek = JSON.parse(e.postData.contents);
  } catch (chyba) {
    return odpoved({ ok: false, permanent: true, error: "Neplatný požadavek." });
  }
  if (!pozadavek || pozadavek.secret !== TAJNY_KLIC) {
    return odpoved({ ok: false, permanent: true, error: "Neplatný tajný klíč – porovnejte se GMAIL_RELAY_SECRET." });
  }
  if (pozadavek.ping) {
    return odpoved({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  }

  const zamek = LockService.getScriptLock();
  let zamceno = false;
  try {
    zamek.waitLock(25000);
    zamceno = true;
    const cache = CacheService.getScriptCache();
    const klic = "odeslano:" + pozadavek.id;
    if (cache.get(klic)) {
      return odpoved({ ok: true, duplicate: true, remaining: MailApp.getRemainingDailyQuota() });
    }
    const volby = { htmlBody: pozadavek.html };
    if (pozadavek.fromName) volby.name = pozadavek.fromName;
    if (pozadavek.cc && pozadavek.cc.length) volby.cc = pozadavek.cc.join(",");
    if (pozadavek.bcc && pozadavek.bcc.length) volby.bcc = pozadavek.bcc.join(",");
    if (pozadavek.replyTo) volby.replyTo = pozadavek.replyTo;
    if (pozadavek.attachment) {
      volby.attachments = [
        Utilities.newBlob(
          Utilities.base64Decode(pozadavek.attachment.content),
          pozadavek.attachment.contentType,
          pozadavek.attachment.filename
        ),
      ];
    }
    MailApp.sendEmail(pozadavek.to.join(","), pozadavek.subject, pozadavek.text, volby);
    cache.put(klic, "1", 21600);
    return odpoved({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (chyba) {
    return odpoved({ ok: false, error: String((chyba && chyba.message) || chyba) });
  } finally {
    if (zamceno) zamek.releaseLock();
  }
}

function odpoved(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
`;

export const GMAIL_SECRET_PLACEHOLDER = "SEM_VLOZTE_GMAIL_RELAY_SECRET";

export function gmailRelayScript(secret: string | null): string {
  return SCRIPT.replace("__SECRET__", JSON.stringify(secret ?? GMAIL_SECRET_PLACEHOLDER));
}
