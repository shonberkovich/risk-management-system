# ROLES_MATRIX — מטריצת הרשאות (RBAC) לפי תפקיד ותחום API

מסמך רפרנס: מי מורשה לקרוא (GET) ולכתוב (POST/PUT/PATCH/DELETE) בכל תחום API. **נגזר ישירות מקריאת קוד** — `backend/app/dependencies/permissions.py` (מנגנון `require_roles`) ו-`backend/app/routers/*.py` (איפה בפועל `Depends(require_roles(...))` מופיע, ועם אילו ארגומנטים) — ולא משוער. כל שורה בטבלה מפנה לקובץ/שורה בקוד שמאמתת אותה.

## תפקידים (7, מלא ב-`backend/app/seed.py`)

`ADMIN` · `RISK_MANAGER` · `CFO` · `PROPERTY_MANAGER` · `RISK_OFFICER` · `ADJUSTER` · `FIELD_WORKER`

## מוסכמות RBAC (`dependencies/permissions.py`)

- **`Depends(require_roles())`** ללא ארגומנטים = "מחייב התחברות (JWT תקין + `is_active=True`), כל תפקיד" — **לא** פתוח לגמרי, רק לא-מוגבל-תפקיד.
- **`Depends(require_roles("A", "B"))`** = מחייב התחברות **וגם** תפקיד ∈ {A, B} (403 אחרת).
- **ללא `Depends` כלל** = פתוח לחלוטין, כולל למי שלא התחבר בכלל.
- טבלאות שלהלן משתמשות ב-**✅** = מותר, **❌** = חסום (403 אם מחובר בתפקיד לא-מתאים, 401 אם לא מחובר בכלל ונדרשת התחברות).

---

## מטריצה מרכזית — 17 תחומי ה-API המבוקשים

| תחום (Router) | פעולה | ADMIN | RISK_ MANAGER | CFO | PROPERTY_ MANAGER | RISK_ OFFICER | ADJUSTER | FIELD_ WORKER | לא מחובר | מקור בקוד |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **properties** | קריאה (GET) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `properties.py` — אין `require_roles` על ה-GETs |
| **properties** | כתיבה (POST/PUT/DELETE — DELETE=soft) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `_PROPERTIES_WRITE_ROLES` (שורה 17) |
| **risk-profiles** | קריאה (GET) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `risk_profiles.py` — GET פתוח |
| **risk-profiles** | כתיבה (POST חד-פעמי / PUT) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `_RISK_PROFILE_WRITE_ROLES` (שורה 20) |
| **claims** | קריאה (GET רשימה/פרטים) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `claims.py` — GET פתוח |
| **claims** | כתיבה (POST/PATCH תביעה, POST תשלום) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | `_CLAIMS_WRITE_ROLES` (שורה 13) |
| **claim-reserves** (`/claims/{id}/reserves`) | קריאה (GET) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `claims.py` — GET פתוח (אותו router) |
| **claim-reserves** | כתיבה (POST/PATCH רזרבה) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | `_CLAIMS_WRITE_ROLES` (זהה ל-claims) |
| **users** | קריאה (GET `""` — שמות+תפקיד בלבד, ל-UI pickers) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `users.py` שורה 29 — GET פתוח במכוון |
| **users** | קריאה מלאה (GET `/admin`) + כתיבה (POST/PATCH — יצירה/עריכה/שינוי תפקיד/השבתה) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `_USERS_WRITE_ROLES = ("ADMIN",)` (שורה 26) |
| **role-permissions** | קריאה (GET קטלוג) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `role_permissions.py` שורה 30 — GET פתוח |
| **role-permissions** | כתיבה (POST/PATCH/DELETE) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `_ROLE_PERMISSIONS_WRITE_ROLES = ("ADMIN",)` (שורה 27) |
| **financials** | קריאה (GET trends/regulatory-report/statements) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_FINANCIALS_ROLES` (שורה 18) — **כן, גם ה-GET גדור** |
| **financials** | כתיבה (POST statements) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_FINANCIALS_ROLES` (זהה) |
| **compliance** | קריאה (GET iso31000-report) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | `_COMPLIANCE_ROLES` (שורה 15) |
| **compliance** | כתיבה | — | — | — | — | — | — | — | — | אין endpoint כתיבה (דוח מחושב בלבד) |
| **analytics** — kpis / loss-ratio-trend / cashflow / exposure-by-region / geographic-exposure-clusters | קריאה (GET, "גילוי פיננסי") | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `_FINANCIAL_READ_ROLES` (שורה 20) |
| **analytics** — map / risk-matrix / alerts / hazard-distribution | קריאה (GET, לא-פיננסי) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | אין `require_roles` על 4 ה-GETs האלה — פתוח לגמרי |
| **analytics** | כתיבה | — | — | — | — | — | — | — | — | אין endpoint כתיבה (הכל read-only, חישובי on-the-fly) |
| **policies** | קריאה (GET רשימה/פרטים/נכסים מבוטחים) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `_POLICIES_READ_ROLES` (שורה 17) |
| **policies** | כתיבה (POST/PUT פוליסה, POST/DELETE שיוך נכסים) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_POLICIES_WRITE_ROLES` (שורה 12) |
| **notifications** — preview/log/recipients | קריאה (GET) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_NOTIFICATIONS_ROLES` (שורה 17) |
| **notifications** | כתיבה (POST dispatch) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_NOTIFICATIONS_ROLES` (זהה) |
| **notifications** — recipients | כתיבה (POST/PATCH/DELETE) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `_RECIPIENTS_WRITE_ROLES = ("ADMIN",)` (שורה 22) |
| **integrations** — erp (book-values, post-claim-receipts) | קריאה+כתיבה | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_ERP_ROLES` (שורה 14) |
| **integrations** — gis (risk-layers) | קריאה | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | `_GIS_ROLES` (שורה 18) |
| **integrations** — weather (alerts) | קריאה | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | `require_roles()` (שורה 71) — כל מחובר, כל תפקיד |
| **integrations** — economics (index-series, replacement-value-updates) | קריאה | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `_ECONOMICS_ROLES` (שורה 26) |
| **incidents** | קריאה (GET רשימה/פרטים/full drill-down) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `incidents.py` — GET פתוח |
| **incidents** | כתיבה (POST דיווח, PATCH עריכה/הגשת טיוטה) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | `require_roles()` (שורות 133,173,199) — כל מחובר, כולל FIELD_WORKER שמדווח מהשטח |
| **incidents** | כתיבה (PATCH status — קידום סטטוס) | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | `_STATUS_WRITE_ROLES` (שורה 16) |
| **incidents** | קריאה (GET eligible-policies) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `_POLICIES_READ_ROLES` (שורה 243, מקומי לקובץ) |
| **mitigation** | קריאה (GET משימות/roi-summary) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `mitigation.py` — GET פתוח |
| **mitigation** | כתיבה (POST/PATCH משימה) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `_MITIGATION_WRITE_ROLES` (שורה 32) |
| **simulation** | קריאה (GET portfolio/property VaR) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `simulation.py` — **אין כלל `require_roles`/`get_current_user`**, פתוח לגמרי |
| **simulation** | כתיבה | — | — | — | — | — | — | — | — | אין endpoint כתיבה |
| **retention** | קריאה (GET recommendation) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `retention.py` — **אין כלל `require_roles`/`get_current_user`**, פתוח לגמרי |
| **retention** | כתיבה | — | — | — | — | — | — | — | — | אין endpoint כתיבה |
| **ai** — classify-incident / executive-summary / ask | קריאה+כתיבה | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `ai.py` — `Depends(require_roles())` (מחייב התחברות, כל תפקיד) + `enforce_ai_rate_limit` (מגבלת קצב לפי IP) |

---

## תוקן: `ai.py` היה פתוח לגמרי, לא "authenticated" כפי שתועד

`docs/README.md` §6 תיעד מאז ומתמיד את `ai.py` כ-`authenticated` ב-RBAC, אך עד לאחרונה `backend/app/routers/ai.py` לא אכף זאת בפועל — לא היה שם אף `Depends(require_roles(...))` או `Depends(get_current_user)` על שלושת ה-endpoints (`classify-incident`, `executive-summary`, `ask`), רק `Depends(enforce_ai_rate_limit)` (הגבלת קצב לפי כתובת IP, `services/rate_limit.py`), שאינו בדיקת זהות/תפקיד. תוקן ב-branch `feature/ai-endpoints-require-auth`: נוסף `Depends(require_roles())` (ללא ארגומנטים = מחייב התחברות בלבד, לא מוגבל לתפקיד ספציפי — תואם לכך שגם FIELD_WORKER וגם מנהלים משתמשים ביכולות האלה בפועל) ל-`router` כולו. הפרונטאנד (`api/client.ts`) כבר שלח את טוקן ה-Bearer בכל קריאה מראש (ראו ההערה שם), כך שהתיקון לא דרש שינוי צד-לקוח. נוספו טסטים ב-`backend/tests/test_api_ai_auth.py`.

## סטייה שנייה: `financials` ו-`analytics`-הפיננסי גודרים גם קריאה, לא רק כתיבה

בניגוד לרוב ה-routers שבהם GET נשאר פתוח במכוון (ראו docs/README.md §6), חמישה תחומים כן חוסמים גם GET לתפקידים מסוימים — כל תחום ה-`financials` (כל 4 ה-endpoints, כולל שלושת ה-GET), וחמשת ה-GET "הפיננסיים" ב-`analytics` (kpis/loss-ratio-trend/cashflow/exposure-by-region/geographic-exposure-clusters), `compliance`, ו-`policies`/`incidents/eligible-policies`. אלה מכוונים (ראו `dependencies/permissions.py` docstring, §"Exception") — סוגרים גילוי מידע פיננסי בפני `FIELD_WORKER` ובפני קוראים לא-מחוברים, בעוד רוב שאר ה-GET-ים (properties, incidents, claims, mitigation, risk-profiles, map/risk-matrix/alerts) נשארים פתוחים לגמרי כדי שדשבורדים יעבדו גם לפני התחברות.

## בונוס — תחומים נוספים שנבדקו לשלמות (מעבר ל-17 המבוקשים)

| תחום | פעולה | ADMIN | RISK_ MANAGER | CFO | PROPERTY_ MANAGER | RISK_ OFFICER | ADJUSTER | FIELD_ WORKER | לא מחובר | מקור בקוד |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **documents** | קריאה (GET לפי entity, signed-url, download) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `documents.py` — GET פתוח |
| **documents** | כתיבה (POST העלאה) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | `require_roles()` (שורה 65) — כל מחובר |
| **documents** | כתיבה (DELETE) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `require_roles("RISK_MANAGER","ADMIN")` (שורה 107) |
| **media** (`/incidents/{id}/media`, `/media/...`) | קריאה (GET רשימה, signed-url, download) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `media.py` — GET פתוח |
| **media** | כתיבה (POST העלאה) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | `require_roles()` (שורה 55) — כל מחובר |
| **media** | כתיבה (DELETE) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `require_roles("RISK_MANAGER","ADMIN")` (שורה 111) |
| **audit-log** (`/api/audit-log`) | קריאה (GET רשימה + entity-types) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `_AUDIT_ROLES = ("ADMIN",)` (שורה 21) — היוצא-מן-הכלל: גם קריאה חסומה ל-ADMIN בלבד |
| **audit-log** | כתיבה | — | — | — | — | — | — | — | — | אין endpoint כתיבה — נכתב אוטומטית ע"י `AuditLogMiddleware`, לא דרך API |
| **auth** (`/api/auth`) | login/refresh/logout/me/sso | פתוח (public) — נקודת הכניסה עצמה, ללא RBAC. `me` דורש טוקן תקין (לא `require_roles`) | | | | | | | | `auth.py` |

---

## סיכום מספרי

- **7 תפקידים** נבדקו: ADMIN, RISK_MANAGER, CFO, PROPERTY_MANAGER, RISK_OFFICER, ADJUSTER, FIELD_WORKER (מקור: `backend/app/seed.py`, 9 משתמשי seed).
- **21 routers** נסרקו בקובץ `backend/app/main.py` (`app.include_router(...)`); **17 מהם** מכוסים במטריצה המרכזית לפי דרישת המשימה (properties, risk-profiles, claims, claim-reserves, users, role-permissions, financials, compliance, analytics, policies, notifications, integrations, incidents, mitigation, simulation, retention, ai — כאשר claim-reserves ו-policies/eligible-policies נגזרים מאותו router כ-claims/incidents בהתאמה); **3 נוספים** (documents, media, audit-log) נבדקו כבונוס לשלמות; `auth.py` הוא נקודת הכניסה הציבורית ואינו מגודר ב-RBAC כשלעצמו.
- כל שורה נגזרה ישירות מ-`grep`-ים שיטתיים על `Depends(require_roles(...))` ו-`_[A-Z_]*_ROLES = (...)` בכל קובצי `backend/app/routers/*.py`, לא משוערת.
