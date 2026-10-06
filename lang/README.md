# ملفات اللغة — CineAura language files

كل لغة لها ملف واحد بصيغة `.js` بداخله خريطة الترجمة (كائن جافاسكربت). النص الإنجليزي هو **المفتاح**،
لأن الإنجليزية هي اللغة الافتراضية للموقع، والقيمة هي الترجمة:

```js
(window.CineAuraPacks = window.CineAuraPacks || {}).ar = {
  "Free": "مجاني",
  "Search": "بحث",
  "Movies": "أفلام",
  "Plans & Pricing": "الباقات والأسعار"
};
```

## الملفات

| اللغة | الكود | الملف |
| --- | --- | --- |
| English (افتراضية) | `en` | `lang/english.js` |
| العربية | `ar` | `lang/arabic.js` |
| Français | `fr` | `lang/french.js` |
| Deutsch | `de` | `lang/german.js` |
| Español | `es` | `lang/spanish.js` |
| Nederlands | `nl` | `lang/dutch.js` |
| Italiano | `it` | `lang/italian.js` |

`english.js` هو القائمة الكاملة للمفاتيح (كل قيمة فيه تساوي مفتاحها)، ويُستخدم كمرجع
للمفاتيح المتوفرة.

## الصيغة

* كل ملف يسجّل نفسه في `window.CineAuraPacks[<code>]` كأي كائن جافاسكربت عادي.
* لا حاجة لـ `fetch` ولا لإعدادات MIME في الاستضافة: الملف يُحمَّل بوسم `<script>`.
* أي مفتاح غير موجود في الملف يعود الموقع تلقائيًا إلى النص الإنجليزي.
* البحث غير حسّاس لحالة الأحرف (`active` تساوي `Active`)، ويتم تجاهل رموز HTML
  (`Plans &amp; Pricing` تُطابق `Plans & Pricing`).
* مواضع المتغيرات `{n}` و`{name}` و`{date}` تُكتب كما هي في القيمة أيضًا.
* احرص على الفواصل `,` بين الأسطر، وعلى علامات الاقتباس `"` المزدوجة حول المفاتيح والقيم.

## ماذا يوجد داخل كل ملف؟

1. **واجهة الموقع** — كل جملة أو كلمة تظهر في الصفحات (القوائم، الصفحة الرئيسية،
   لوحة التحكم، الملف الشخصي، صفحة المشاهدة، بانل الطاقم …).
2. **قيم قاعدة بيانات Supabase** — القيم الخام المخزّنة في الجداول، مثل حالة العضو
   (`active` / `disabled` / `banned` / `blocked`)، نوع العضوية (`Free` / `Silver` /
   `Gold` / `Diamond`)، الدور (`super` / `admin` / `moderator`)، الظهور
   (`public` / `exclusive` / `private`)، سبب البلاغ (`misleading` / `broken` /
   `malicious` / `stolen` / `bad` / `indirect`)، حالة الرمز (`active` / `disabled` /
   `banned` / `expired`)، نوع IPTV (`free` / `premium` / `xtream` / `m3u`) …

## كيف تعمل؟

* `js/i18n.js` يحمل فهرس المفاتيح فقط: `مفتاح الواجهة → النص الإنجليزي` (مثال
  `"nav.search": "Search"`). هذا الفهرس هو ما تستخدمه الصفحات: `CineAura.t("nav.search")`.
* `js/lang.js` يقرأ ملف اللغة الحالية `lang/<language>.js`، يبني منه خريطة
  «إنجليزي → ترجمة»، ثم يعبّئ كل مفاتيح الواجهة بالترجمة، ويكرّر ترجمة الصفحة عند وصول
  الملف.
* `js/prefs.js` يحمّل ملف اللغة الحالية بشكل متزامن في `<head>` قبل بقية السكربتات، وعند
  تبديل اللغة من الداشبورد يحقن `lang.js` وسم `<script>` للغة الجديدة ثم يعيد ترجمة الصفحة.
* إذا فشل تحميل الملف (مثلاً فُتحت الصفحات بدون سيرفر) يبقى الموقع بالإنجليزية.

### واجهة الاستخدام في الجافاسكربت

```js
CineAura.t("nav.search");          // مفاتيح الواجهة (كما هو الحال سابقًا)
CineAura.tr("Free");               // أي نص إنجليزي: قيمة من Supabase مثلًا
CineAuraText("banned");            // المكافئ المختصر: "محظور" بالعربية
CineAuraLang.text("premium");      // من الخريطة مباشرة
CineAuraLang.load("fr");           // تحميل لغة أخرى (يحدث تلقائيًا عند تبديل اللغة)
```

كل عنصر في HTML يحمل `data-i18n="key"` أو `data-i18n-placeholder="key"` أو
`data-i18n-aria="key"` أو `data-i18n-title="key"` يُترجم تلقائيًا عند التحميل، وتُعاد
ترجمته بعد وصول ملف اللغة.

## تعديل ترجمة

افتح ملف اللغة وعدّل القيمة بعد علامة `=`. لا تحتاج أي شيء آخر (تأكد فقط أن الملف ما زال JavaScript صالحًا).

## إضافة لغة جديدة

1. أنشئ ملفًا جديدًا بنفس النسق (يمكن نسخ `english.js`) باسم اللغة، مثل `lang/portuguese.js`.
2. أضف الكود والملف في `js/lang.js` داخل `FILES`:

   ```js
   pt: "portuguese",
   ```

3. أضف الكود `"pt"` إلى قائمة `LANGS` في `js/i18n.js`، وإلى قوائم اللغات (و`files`) في
   `js/prefs.js` و`js/common.js` (`LANGS` و`TMDB_LANG` و`LOCALE`).
4. أضف اسم اللغة في كل ملفات اللغة عند المفتاح `Language` (مثال `English = الإنجليزية`).

## CineAura language files (English summary)

Every language is one plain-text `.js` map where the English text is the key and the
value is the translation. `english.js` is the master key list. `js/i18n.js` now holds only
the key → English index used by `CineAura.t()`, while `js/lang.js` loads
`lang/<language>.js`, fills the dictionary for that language and re-translates the page.
The same map translates text coming from Supabase (`CineAura.tr("Silver")`,
`CineAuraLang.text("banned")`). Lookups ignore case and HTML entities; missing entries fall
back to English.
