# RMIS — מערכת מידע לניהול סיכונים משולבת AI

מסמך תיעוד טכני לפרויקט בקורס ניהול סיכונים (תואר שני, מדעי המחשב).

## 1. רקע ומטרה

המערכת מחברת בין העולם הפיזי (נכסים, מפגעים, אירועי נזק) לעולם הפיננסי (פוליסות ביטוח, תביעות, תזרים), ומספקת שכבת בינה מלאכותית (LLM) המסייעת למנהל הסיכונים בסיווג אירועים, הפקת דוחות וקבלת תשובות על נתוני המערכת בשפה טבעית.

הפרויקט הוא **דמו עובד end-to-end**, לא מוצר production. סעיף 9 מפרט מה נותר מחוץ להיקף.

## 2. ארכיטקטורה טכנולוגית

```
┌───────────────────────────────────────────────────────────────┐
│  Frontend — React 18 + TypeScript + Vite · PWA                │
│  MUI v6 (RTL) · React Query · React Router · Leaflet ·         │
│  Recharts · IndexedDB (offline sync)                            │
└───────────────────────┬─────────────────────────────────────────┘
                         │ REST (JSON) — proxy /api → :8000, JWT bearer
┌───────────────────────▼─────────────────────────────────────────┐
│  Backend — Python 3.12 · FastAPI · SQLAlchemy 2.0 ORM           │
│  19 routers (auth/RBAC, properties, risk_profiles, incidents,   │
│  policies, claims, mitigation, media, documents, analytics,     │
│  simulation, retention, financials, compliance, integrations,   │
│  notifications, audit-log, users, ai) — see §5 for the full list│
│  ~15 services: kpi / cashflow / retention / simulation /        │
│  financials / compliance / notifications / storage / auth /     │
│  encryption / llm (Anthropic) + integrations/ (erp, gis,        │
│  weather, economics)                                             │
└───────────────────────┬─────────────────────────────────────────┘
                         │ pyodbc (ODBC Driver 17)
┌───────────────────────▼─────────────────────────────────────────┐
│  SQL Server (LocalDB) — RiskDB                                  │
│  18 טבלאות, NVARCHAR ל-Unicode, FK מלא, אינדקסים, שדה מוצפן      │
│  אחד (Claim_Payments.reference_number) · Alembic למיגרציות       │
│  הדרגתיות מעל schema.sql (ראו §3, §7)                            │
└───────────────────────┬─────────────────────────────────────────┘
                         │
┌───────────────────────▼─────────────────────────────────────────┐
│  Anthropic Claude API (claude-opus-5)                            │
│  1. סיווג אירוע (Structured Outputs)                              │
│  2. דוח הנהלה (Streaming)                                         │
│  3. שאלות על הנתונים (Tool Use מאובטח)                            │
└───────────────────────────────────────────────────────────────┘
```

**למה הסטאק הזה:** React+Python+SQL Server נבחר על פי דרישת המשתמש. FastAPI נבחר על פני Flask/Django בשל תמיכה מובנית ב-async, תיעוד Swagger אוטומטי (`/docs`), ואינטגרציה טבעית עם Pydantic (משמש גם ל-structured outputs של Claude). SQL Server LocalDB נבחר על פני Docker כדי לצמצם תלויות סביבה.

## 3. מודל הנתונים

18 טבלאות (9 מהמפרט המקורי + 9 שנוספו לאורך [TODO_SPEC.md](../TODO_SPEC.md): `Regions`, `Claim_Reserves`, `Audit_Log`, `Role_Permissions`, `Documents`, `Financial_Statements`, ומספר עמודות מורחבות על טבלאות קיימות — ראו ERD המלא), עם התאמות ל-SQL Server:

| החלטה | נימוק |
|---|---|
| `NVARCHAR` לכל טקסט | חובה לתמיכה בעברית (Unicode) |
| `NVARCHAR(30) + CHECK` במקום `ENUM` | אין טיפוס ENUM מובנה ב-SQL Server |
| `latitude/longitude DECIMAL(9,6)` במקום PostGIS `Point` | פשוט, מספיק לכ-50 נכסים, עובד ישירות עם Leaflet |
| Composite index על `(latitude, longitude)` במקום GIST spatial index | ללא הרחבת PostGIS ב-SQL Server; מספיק בהיקף הדמו |
| `entity_type`+`entity_id` פוליארפי (`Documents`, `Audit_Log`) במקום FK נפרד per-entity | נמנע מארבעה עמודות FK nullable לכל ישות אפשרית |

ראו ERD מלא ב-[erd.md](./erd.md) וסכימת DDL מלאה ב-[`backend/sql/schema.sql`](../backend/sql/schema.sql). `backend/alembic/` עוקב אחרי שינויי סכימה **הדרגתיים** מעבר לנקודת הבסיס הנוכחית (ראו §7) — `schema.sql` נשאר מקור האמת ליצירת DB חדש מאפס.

**שרשרת הערך:** `Properties → Asset_Risk_Profiles → Incidents → Claims → Claim_Payments` (+ `Claim_Reserves` לתזרים צפוי), עם `Insurance_Policies` ↔ `Properties` דרך טבלת קישור `Policy_Assets`, ו-`Mitigation_Tasks` כמסלול נפרד לניהול תחזוקה מונעת. `Regions`, `Documents`, `Audit_Log`, `Role_Permissions` ו-`Financial_Statements` הן טבלאות תומכות שנוספו לצורך דוחות חשיפה אזוריים, ניהול מסמכים, ביקורת (audit) ותאימות רגולטורית.

## 4. חישובי סיכון (`backend/app/services/kpi.py`)

לוגיקה דטרמיניסטית, ללא AI:

- **TIV** (Total Insured Value) = `Σ replacement_value` על נכסים פעילים
- **MFL** (Maximum Foreseeable Loss) = החשיפה המקסימלית באשכול גיאוגרפי — מחשב מרחק Haversine בין כל זוגות נכסים, ומוצא את הצירוף עם סכום `mfl_amount` הגבוה ביותר ברדיוס של 10 ק"מ (מדמה תרחיש אסון אזורי יחיד)
- **Loss Ratio** = `Σ claimed_amount (שנה נוכחית) / Σ annual_premium`
- **Risk Score לנכס** = ממוצע משוקלל (הצפה 35%, אש 40%, רעידת אדמה 25%), מוכפל ב-0.8 אם קיימים מתזים
- **ROI למשימת מיטיגציה** = `expected_annual_savings / cost_estimate × 100%`

## 5. שכבת ה-AI (`backend/app/services/llm.py`)

מודל: `claude-opus-5` (ניתן לשינוי ב-`.env`). כל היכולות דורשות `ANTHROPIC_API_KEY` בקובץ `backend/.env` (ראו `.env.example`).

### 5.1 סיווג אוטומטי של דיווח שטח
`POST /api/ai/classify-incident` — עובד שטח מקליד תיאור חופשי בעברית, והמערכת מחזירה שדות מובנים (`hazard_type`, `severity_level`, `operational_impact`, אומדן נזק, תחזית לאובדן רווחים, הסבר וביטחון). ממומש עם **Structured Outputs** (`client.messages.parse()` + סכימת Pydantic) — מבטיח JSON תקין תמיד, ללא צורך בפרסור ידני. ה-UI מציג את ההצעה כברת-עריכה, לא כופה אותה.

### 5.2 דוח הנהלה (Executive Summary)
`GET /api/ai/executive-summary` — שולף KPIs חיים מה-DB, ומזרים (streaming) תקציב מנהלים בעברית עם המלצות פעולה. שימוש ב-`client.messages.stream()` כדי שהטקסט יופיע בהדרגה במסך, בלי להמתין לתשובה מלאה.

### 5.3 שאלות בשפה טבעית על הנתונים
`POST /api/ai/ask` — **מאובטח בעיצוב**: המודל *לא* מייצר SQL חופשי. הוגדרו 5 כלים (`get_kpis`, `query_properties`, `query_claims`, `query_incidents`, `query_mitigation_tasks`) שכל אחד מריץ שאילתה קבועה ופרמטרית בלבד. Claude בוחר כלי ופרמטרים; אין נתיב שבו טקסט מהמשתמש הופך לביטוי SQL. מומש עם `client.beta.messages.tool_runner()`.

## 6. שטח ה-API (Endpoints)

התיעוד האינטראקטיבי המלא (כל endpoint, סכימת בקשה/תשובה, ניסוי חי) זמין תמיד ב-**Swagger UI: `http://localhost:8000/docs`** — זהו מקור האמת בפועל, ולא מטרת הטבלה כאן. הטבלה שלהלן היא מפת-דרכים ברמת ה-router, כדי לדעת איפה לחפש:

| Router (prefix) | תחום | RBAC בכתיבה |
|---|---|---|
| `auth.py` (`/api/auth`) | login/refresh/me/logout, שלד SSO (501 כברירת מחדל) | — (public) |
| `properties.py` (`/api/properties`) | CRUD נכסים (מחיקה = soft delete, `is_active=False`) + פרופיל סיכון | RISK_MANAGER/PROPERTY_MANAGER/ADMIN |
| `risk_profiles.py` (`/api/properties/{id}/risk-profile`) | יצירה/עדכון סקר סיכונים (Asset_Risk_Profiles) — יחס 1:1 לנכס: POST פעם ראשונה בלבד (409 אם כבר קיים), PUT לעדכון (404 אם עוד אין) | RISK_MANAGER/PROPERTY_MANAGER/ADMIN |
| `incidents.py` (`/api/incidents`) | דיווח אירוע, טיוטה→הגשה, סטטוס, drill-down מאוחד | תלוי endpoint — ראו הקוד |
| `media.py` (ללא prefix קבוע — `/api/incidents/{id}/media`, `/api/media/...`) | העלאת/שליפת/מחיקת מדיה לאירוע, כולל EXIF GPS | RISK_MANAGER/ADMIN למחיקה |
| `policies.py` (`/api/policies`) | CRUD פוליסות + שיוך נכסים (`Policy_Assets`) | RISK_MANAGER/CFO/ADMIN |
| `claims.py` (`/api/claims`) | פתיחת/עדכון תביעות, תשלומים, רזרבות (`Claim_Reserves`) | RISK_MANAGER/CFO/ADJUSTER/ADMIN |
| `mitigation.py` (`/api/mitigation-tasks`) | CRUD משימות מיטיגציה, `OVERDUE` אוטומטי, `/roi-summary` | RISK_MANAGER/PROPERTY_MANAGER/ADMIN |
| `documents.py` (`/api/documents`) | DMS: העלאה/שליפה/מחיקה, Signed URL, לפי ישות | תלוי endpoint |
| `analytics.py` (`/api/analytics`) | KPIs, risk-matrix, alerts, חשיפה לפי אזור/אשכול גיאוגרפי | קריאה פתוחה |
| `simulation.py` (`/api/simulation`) | Monte Carlo VaR — תיק/נכס בודד, פרמטרי `iterations`/`horizon_years`/`seed` | קריאה פתוחה |
| `retention.py` (`/api/retention`) | מחשבון "לספוג או לתבוע" (השתתפות עצמית) | קריאה פתוחה |
| `financials.py` (`/api/financials`) | מגמות רב-שנתי + דוח רגולטורי (Solvency-style) | RISK_MANAGER/CFO/ADMIN |
| `compliance.py` (`/api/compliance`) | דוח תאימות ISO 31000 | RISK_MANAGER/RISK_OFFICER/CFO/ADMIN |
| `integrations.py` (`/api/integrations`) | ERP/GIS/מזג-אוויר/מדדים כלכליים (כולם מסומלים — ראו §8) | תלוי endpoint |
| `notifications.py` (`/api/notifications`) | ניתוב התראות Email/SMS/Push (מסומל) | RISK_MANAGER/CFO/ADMIN |
| `audit.py` (`/api/audit-log`) | קריאה מיומן הביקורת, ADMIN-בלבד גם לקריאה | ADMIN (גם קריאה) |
| `users.py` (`/api/users`) | רשימת משתמשים (לצורך UI pickers בלבד — לא ניהול הרשאות) | קריאה פתוחה |
| `ai.py` (`/api/ai`) | סיווג אירוע, דוח הנהלה (streaming), Q&A — כולם עם rate-limit | authenticated |

מוסכמת RBAC: `Depends(require_roles())` ללא ארגומנטים = "מחייב התחברות, כל תפקיד"; עם ארגומנטים = תפקיד ברשימה בלבד (403 אחרת); ללא `Depends` כלל = פתוח (ראו `backend/app/dependencies/permissions.py`). רוב ה-`GET` נשארו פתוחים בכוונה כדי שדשבורדים ימשיכו לעבוד לפני התחברות; `/api/audit-log` הוא היוצא-מן-הכלל המכוון (גם קריאה חסומה ל-ADMIN, ראו [AuditLog.tsx](../frontend/src/pages/AuditLog.tsx)).

## 7. מבנה תיקיות

```
risk-management-system/
├── backend/
│   ├── app/
│   │   ├── main.py, config.py, database.py, models.py, schemas.py
│   │   ├── routers/         # 19 routers — ראו §6 לרשימה המלאה
│   │   ├── services/        # kpi, cashflow, retention, simulation, financials,
│   │   │                    # compliance, notifications, storage, auth, encryption, llm
│   │   ├── integrations/    # erp.py, gis.py, weather.py, economics.py (מסומלים, §9)
│   │   ├── middleware/      # audit.py — AuditLogMiddleware
│   │   ├── dependencies/    # permissions.py — get_current_user / require_roles
│   │   └── seed.py          # נתוני דמו (Python/pyodbc — לא sqlcmd, ר' §10)
│   ├── sql/schema.sql        # DDL מלא (מקור אמת ל-DB חדש)
│   ├── alembic/               # מיגרציות הדרגתיות (ר' §8) — versions/, env.py
│   ├── tests/                 # pytest — יחידה + אינטגרציה, SQLite בזיכרון
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/            # Dashboard, Properties, Incidents, IncidentReport,
│       │                     # Claims, Policies, Mitigation, Simulation, Retention,
│       │                     # Documents, Reports, Compliance, AuditLog, Login, ...
│       ├── components/       # KpiCard, RiskMap, RiskMatrix, HazardChart, ClaimsTable, ...
│       ├── auth/              # AuthContext (JWT, role)
│       ├── offline/           # syncQueue.ts — IndexedDB offline sync
│       └── api/client.ts      # טיפוסי TS + קריאות API (מראה את schemas.py)
└── docs/                      # מסמך זה + erd.md + צילומי מסך
```

## 8. הרצה מקומית

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # ולמלא ANTHROPIC_API_KEY
sqlcmd -S "(localdb)\MSSQLLocalDB" -C -i sql\schema.sql   # DB חדש בלבד — ר' הערה מתחת
python -m app.seed
uvicorn app.main:app --reload

# Backend — בדיקות (לא דורש DB אמיתי, SQLite בזיכרון)
python -m pytest -q

# Frontend (טרמינל נפרד)
cd frontend
npm install
npm run dev
```

גישה: Frontend ב-`http://localhost:5173`, Swagger UI ב-`http://localhost:8000/docs`. משתמשי seed לדוגמה (סיסמה משותפת `Demo1234!` לכולם — ראו `backend/app/seed.py`): `admin@company.co.il` (ADMIN), `avi.levi@company.co.il` (CFO), ועוד — כל הכתובות מפורטות ב-`seed.py`.

**מיגרציות (Alembic), על DB קיים בלבד:** `schema.sql` הוא עדיין הדרך להקים DB חדש מאפס (הפקודה למעלה). לשינוי סכימה על DB קיים — בעקבות שינוי ב-`models.py` — הזרימה היא `alembic revision --autogenerate -m "..."` ואז סקירה ידנית של המיגרציה שנוצרה (היא תמיד תדגל מחדש רעש קוסמטי קבוע — הבדלי רינדור `DATETIME2`/`DateTime` וכמה אינדקסים שקיימים ב-`schema.sql` אך לא מוצהרים כ-`Index(...)` ב-`models.py`) ואז `alembic upgrade head`. עדכנו את `schema.sql` בהתאם, כדי שהקמת DB חדש מאפס תמשיך לשקף את אותה סכימה.

## 9. מה מחוץ להיקף (עבודה עתידית)

רוב הפריטים שתועדו כאן בגרסאות קודמות של המסמך מומשו בפועל לאורך [TODO_SPEC.md](../TODO_SPEC.md) (RBAC, Audit Log, הצפנה, VaR, ERP/GIS, offline sync, PDF export, העלאת מדיה אמיתית — כולם קיימים כעת). מה שנשאר מחוץ להיקף בכוונה, כי הוא מעבר להיקף דמו לקורס:

- **כל אינטגרציית `backend/app/integrations/*` (ERP, GIS/Govmap, מזג-אוויר, מדדים כלכליים) מסומלת (`simulate=True`)** — אין credentials/API keys אמיתיים לספקים חיצוניים אלה בסביבה זו; כל מודול כתוב כך שקל להחליף בקריאת HTTP אמיתית ביום שיהיו פרטי חיבור.
- **שליחה בפועל של Email/SMS/Push** (`services/notifications.py::dispatch_notifications`) — מדמה שליחה (רושמת ל-log, `status="simulated"`), אין ספק חיצוני מוגדר.
- **אחסון קבצים אמיתי בענן** (`services/storage.py`) — שומר לתיקייה מקומית `backend/media_storage/` ומחתים URL-ים בעצמו, במקום S3/Blob אמיתי (אין credentials בסביבה).
- **SSO/OAuth2/SAML אמיתי** (`routers/auth.py` sso endpoints) — שלד בלבד, מחזיר `501` כברירת מחדל (`SSO_ENABLED=false`), אין IdP זמין לבדיקה.
- **מנוע אקטוארי/תמחור אמיתי** — VaR (`services/simulation.py`), אופטימיזציית השתתפות עצמית (`services/retention.py`) ופיצול ROI/פרמיה (`services/kpi.py`) כולם מבוססי הנחות פשוטות ומתועדות (קבועים כמו `PREMIUM_SURCHARGE_RATE`), לא מודלים אקטואריים מכוילים על נתוני שוק אמיתיים — מכוון: זהו כלי הדגמה לקורס.
- **ניהול משתמשים/הרשאות מלא (יצירה/מחיקה של משתמשים, UI לעריכת `Role_Permissions`)** — קיימות טבלאות `Users`/`Role_Permissions` ואכיפת RBAC בפועל בכל endpoint, אך אין מסך "ניהול משתמשים" ליצירה/מחיקה — משתמשים נזרעים דרך `seed.py` בלבד.

## 10. הערות פיתוח ומלכודות שנתקלנו בהן

תיעוד לצורכי שקיפות (רלוונטי גם לדוח ההגשה):

1. **`sqlcmd` שיבש טקסט עברי בפועל** (לא רק בתצוגה) בזמן טעינת נתוני seed — קידוד הקובץ מול פענוח sqlcmd לא תאמו. הפתרון: מעבר לטעינת seed data דרך Python + `pyodbc` עם פרמטרים (`app/seed.py`), שמטפל ב-Unicode נכון באופן טבעי.
2. **`DBCC CHECKIDENT ... RESEED 0`** על טבלה שמעולם לא הוכנסו אליה שורות מתנהג אחרת (ה-ID הבא הופך להיות ממש 0/הערך שהוזן) לעומת טבלה שכבר אוכלסה בעבר (ה-ID הבא = ערך+1). הפתרון בשימוש: `schema.sql` תמיד מבצע DROP+CREATE מסודר (בסדר תלויות FK הפוך) לפני seeding, כדי שההתנהגות תהיה עקבית.
3. **SQLAlchemy `String`/`Text` גנרי במקום `Unicode`/`UnicodeText`** יכול לגרום ל-pyodbc לקשור פרמטרים כ-ANSI צר במקום Unicode רחב, מה שהופך טקסט עברי ל-`?????` בזמן INSERT — למרות שהעמודה בפועל היא `NVARCHAR`. כל השדות הטקסטואליים ב-`models.py` משתמשים כעת ב-`Unicode`/`UnicodeText` באופן מפורש.
4. **`--reload` של uvicorn** תקוע לעיתים אחרי כמה מחזורי rewrite מהירים על אותם קבצים (במיוחד ב-Windows) — נצפה `RuntimeWarning: coroutine 'Server.serve' was never awaited`. הפתרון: הפעלה מחדש מלאה של תהליך השרת אחרי שינויים משמעותיים, ולא הסתמכות בלבד על ה-reloader.

## 11. סטטוס נוכחי ומשימות להמשך

עדכון אחרון: 2026-08-20.

**המשך ההיסטוריה מתחת (שלב "PR #1" ואילך) הוא היומן המקורי של הפרויקט, לפני שנכתב [TODO_SPEC.md](../TODO_SPEC.md) — נשמר כמות שהוא לצורכי שקיפות. מ-TODO_SPEC.md ואילך (9 שלבי פיתוח: Database & Data Model → Backend Services → API → אבטחה → UI → PWA/Offline → אינטגרציות → מודלים מתקדמים → Compliance & Reporting), כל משימה תועדה עם ה-✅ שלה *בתוך* `TODO_SPEC.md` עצמו (branch, מה נבנה, מה נבדק בפועל) במקום כאן — זהו כעת מקור האמת ל"מה בוצע ומתי", ולא סעיף זה. שלב 10 (Quality & Ops: בדיקות יחידה/אינטגרציה, Alembic, ותיעוד זה) הושלם ב-2026-08-20; שאר תשעת השלבים הושלמו קודם לכן. לתמונת מצב עדכנית — לפתוח את `TODO_SPEC.md` ולראות אילו תיבות עדיין `[ ]` (ריקות).**

### מה בוצע עד כה (יומן היסטורי, לפני TODO_SPEC.md)

**גרסה ראשונית (build מלא, first commit → `8f1398e`):** המערכת המלאה כפי שמתוארת בסעיפים 1-9 — 9 טבלאות, כל ה-routers (properties/incidents/policies/claims/mitigation/analytics/ai), שלוש יכולות ה-AI, וחמשת מסכי ה-Frontend המקוריים (Dashboard, Properties, IncidentReport, Claims, Reports).

**PR #1 — מודול "משימות הפחתת סיכון" (Mitigation Tasks & ROI):** ה-Backend למודול הזה (טבלת `Mitigation_Tasks`, 12 רשומות seed, חישוב ROI ב-[`kpi.py`](../backend/app/services/kpi.py), ואנדפוינט `GET /api/mitigation-tasks`) היה קיים מההתחלה אך **לא היה נגיש דרך שום מסך** — רק דרך כלי ה-AI `query_mitigation_tasks`. נסגר הפער בהוספת:
- [`frontend/src/pages/Mitigation.tsx`](../frontend/src/pages/Mitigation.tsx) — מסך `/mitigation` עם 4 כרטיסי KPI (משימות פתוחות/באיחור, עלות פעילה כוללת, חיסכון שנתי צפוי כולל, ROI ממוצע), סינון לפי סטטוס, וטבלה ממוינת עם משימות באיחור ראשונות
- [`frontend/src/components/MitigationTable.tsx`](../frontend/src/components/MitigationTable.tsx) — טבלה read-only, תואמת לסגנון `ClaimsTable.tsx`
- ראוט וקישור ניווט חדשים ב-`App.tsx` ו-`Layout.tsx`

ללא שינוי בבקאנד — האנדפוינט והחישוב היו כבר נכונים. אומת ידנית בדפדפן: כל 12 המשימות מוצגות עם ROI, שם נכס וסטטוס נכונים; הסינון לפי סטטוס עובד. מוזג ל-`main` (PR #1, commit `5d1d19f`).

**מודול ניהול פוליסות (Policy CRUD):** יישום ההמלצה מהעדכון הקודם. ה-Backend היה read-only בלבד (`GET /api/policies` בלבד); נוספו:
- `POST /api/policies`, `PUT /api/policies/{id}` — יצירה ועדכון פוליסה, כולל טיפול ב-`IntegrityError` על מספר פוליסה כפול (`backend/app/routers/policies.py`)
- `GET/POST /api/policies/{id}/assets`, `DELETE /api/policies/{id}/assets/{property_id}` — האנדפוינטים הראשונים ל-`Policy_Assets` (שהייתה טבלת קישור ללא שום אנדפוינט), לניהול שיוך נכסים לפוליסה עם השתתפות עצמית ייעודית
- [`frontend/src/pages/Policies.tsx`](../frontend/src/pages/Policies.tsx) — מסך `/policies` עם 4 כרטיסי KPI (פוליסות פעילות, ממתינות לחידוש, סה"כ תקרת כיסוי ופרמיה שנתית לפוליסות פעילות), סינון לפי סטטוס וטבלה
- [`PolicyDialog.tsx`](../frontend/src/components/PolicyDialog.tsx) — יצירה/עריכה של פוליסה; [`PolicyAssetsDialog.tsx`](../frontend/src/components/PolicyAssetsDialog.tsx) — שיוך/הסרת נכסים לפוליסה נבחרת דרך `Autocomplete`
- ראוט וקישור ניווט חדשים ב-`App.tsx` ו-`Layout.tsx`

אומת ידנית בדפדפן מול ה-DB האמיתי: 4 הפוליסות הקיימות נטענות עם ה-KPIs הנכונים, פתיחת "נכסים מבוטחים" מציגה את הנכסים המשויכים בפועל, והסרת נכס דרך ה-UI מתעדכנת ונשמרת ב-DB (`DELETE /api/policies/{id}/assets/{property_id}` אומת שמתמיד). טרם נבדק ידנית מסלול היצירה/עריכה המלא (`POST`/`PUT`) כדי לא לזהם seed data משותף שנבדק גם על ידי סשן אחר שרץ באותו זמן על אותו dev server. פותח בענף `feature/policy-crud` ומוזג ל-`main` מקומית (ללא PR ב-GitHub, commit `1525b91`).

**זרימת עבודה (workflow) לאירועים/תביעות:** יישום ההמלצה מהעדכון הקודם. עד כה כל מחזור החיים של אירוע/תביעה היה read-only מלבד יצירת אירוע חדש (`Incidents.status` נשאר `NEW` לצמיתות, ותביעות לא ניתנות ליצירה כלל דרך ה-UI). נוספו:
- `PATCH /api/incidents/{id}/status` — קידום סטטוס אירוע (`NEW → UNDER_INVESTIGATION → CLOSED`) עם אכיפת סדר (לא ניתן לדלג אחורה, ולא ניתן להגדיר `CLAIM_FILED` ידנית — סטטוס זה נקבע רק אוטומטית מפתיחת תביעה)
- `GET /api/incidents/{id}/eligible-policies` — מחזיר את הפוליסות הפעילות המכסות את הנכס של האירוע (JOIN דרך `Policy_Assets`), לצורך בחירת פוליסה בעת פתיחת תביעה
- `POST /api/claims` — פתיחת תביעה חדשה מתוך אירוע קיים ופוליסה מכסה; מייצר `claim_number` (`CLM-{שנה}-{סד"נ}`) ומעדכן אוטומטית את `Incidents.status` ל-`CLAIM_FILED`
- `PATCH /api/claims/{id}` — עדכון סטטוס תביעה (`DRAFT → SUBMITTED → IN_ADJUSTMENT → APPROVED/REJECTED → SETTLED`), סכום מאושר, שמאי וצפי תשלום; חסום לעדכון נוסף לאחר `SETTLED`/`REJECTED`; כשכל התביעות של אירוע מגיעות לסטטוס סופי, האירוע נסגר אוטומטית (`status = CLOSED`)
- [`frontend/src/pages/Incidents.tsx`](../frontend/src/pages/Incidents.tsx) — מסך `/incidents` חדש (ניהול אירועים) עם 4 כרטיסי KPI, סינון לפי סטטוס, וטבלה עם פעולות: קידום לבדיקה, סגירה ללא תביעה, פתיחת תביעה
- [`IncidentsTable.tsx`](../frontend/src/components/IncidentsTable.tsx), [`FileClaimDialog.tsx`](../frontend/src/components/FileClaimDialog.tsx) — טבלת אירועים ודיאלוג פתיחת תביעה (בוחר פוליסה מכסה מתוך `eligible-policies`, סכום נתבע, השתתפות עצמית, שמאי)
- [`ClaimUpdateDialog.tsx`](../frontend/src/components/ClaimUpdateDialog.tsx) — נוסף כפעולה בטבלת התביעות הקיימת ([`ClaimsTable.tsx`](../frontend/src/components/ClaimsTable.tsx), מסך `/claims`) לעדכון סטטוס/סכום מאושר/צפי תשלום; מושבת אוטומטית עבור תביעות בסטטוס סופי
- ראוט וקישור ניווט חדשים ("ניהול אירועים") ב-`App.tsx` ו-`Layout.tsx`

אומת ידנית בדפדפן מול ה-DB האמיתי: 25 האירועים הקיימים נטענים עם ה-KPIs הנכונים, סינון לפי סטטוס עובד, ופתיחת דיאלוג "פתח תביעה" שולפת בהצלחה את הפוליסות הזמינות דרך `eligible-policies` (`GET /api/incidents/25/eligible-policies` אומת ב-Network). טרם נבדק ידנית מסלול השליחה המלא (`POST /api/claims`, `PATCH /api/incidents/{id}/status`, `PATCH /api/claims/{id}`) כדי לא לזהם seed data משותף שנבדק גם על ידי סשן אחר שרץ באותו זמן על אותו dev server — נבדק רק סטטית (`py_compile`, `tsc -b`, ללא שגיאות חדשות מעבר לשגיאת ה-`stylis` הקיימת מראש). פותח בענף `feature/incident-claim-workflow` ומוזג ל-`main` מקומית (ללא PR ב-GitHub, commit `0bb04ad`).

**מודול ניהול רזרבות ותזרים (`Claim_Payments`):** יישום ההמלצה מהעדכון הקודם. הטבלה `Claim_Payments` הייתה קיימת ומאוכלסת (5 רשומות) אך יתומה לחלוטין — ללא אנדפוינט, סכימה או UI. נוספו:
- `GET /api/claims/{id}/payments` — רשימת תשלומים לתביעה נתונה
- `POST /api/claims/{id}/payments` — רישום תשלום חדש (מקדמה/סילוק סופי); חסום לתביעות שאינן `APPROVED`/`SETTLED`, ומוגבל כך שסכום התשלומים המצטבר לא יחרוג מהסכום המאושר לתביעה
- `GET /api/claims` עודכן להחזיר גם `paid_amount` מצטבר לכל תביעה (סכימת `Claim_Payments` דרך `outerjoin`+`subquery`), כדי שרשימת התביעות תשקף גם את מצב התזרים בפועל ולא רק את הסכום המאושר
- [`ClaimPaymentsDialog.tsx`](../frontend/src/components/ClaimPaymentsDialog.tsx) — דיאלוג חדש שנפתח מ-[`ClaimsTable.tsx`](../frontend/src/components/ClaimsTable.tsx) (עמודת "שולם בפועל" + כפתור פעולה); מציג סכום מאושר / שולם / יתרה, טבלת תשלומים היסטורית, וטופס רישום תשלום חדש (מוצג רק כשיש יתרה לתשלום ולסטטוס התביעה מתאים)
- מסך `/claims` עודכן עם עמודת "שולם בפועל" (כולל שורת סה"כ) בטבלת התביעות

אומת ידנית בדפדפן מול ה-DB האמיתי: נבדקו מספר תביעות מאושרות/סגורות אמיתיות — תביעה ששולמה במלואה (`CLM-2026-03`, 95,000 ₪ מאושר = שולם, יתרה 0, הודעת "שולמה במלואה") ותביעה עם יתרה חלקית (`CLM-2025-08`, 850,000 מאושר, 400,000 שולם כמקדמה, יתרה 450,000, טופס רישום תשלום חדש מוצג כראוי). כל קריאות ה-`GET` אומתו ב-Network (200 OK), ללא שגיאות קונסולה. מסלול ה-`POST` (רישום תשלום בפועל) נבדק רק סטטית (`py_compile`, `tsc -b`) כדי לא לזהם seed data משותף עם סשן אחר שרץ על אותו dev server. פותח בענף `feature/claim-payments`, נדחף ל-`origin` ומוזג ל-`main` מקומית (ללא PR ב-GitHub, commit `50caaf5`).

**מטריצת סיכונים אינטראקטיבית:** יישום ההמלצה מהעדכון הקודם. ה-API של `/api/analytics/risk-matrix` כבר החזיר `property_ids` לכל תא, אך [`RiskMatrix.tsx`](../frontend/src/components/RiskMatrix.tsx) לא ניצל זאת — לחיצה על תא לא סיננה כלום. תוספת UI בלבד, ללא שינוי בקאנד:
- `RiskMatrix.tsx` מקבל כעת `selectedCell`/`onSelectCell`; לחיצה על תא עם `count > 0` מסמנת אותו (מסגרת מודגשת) וקוראת ל-callback עם התא (או `null` בלחיצה חוזרת לביטול)
- [`Dashboard.tsx`](../frontend/src/pages/Dashboard.tsx) מחזיק את התא הנבחר ב-state ומסנן לפיו: מפת החשיפה (`RiskMap`) מוצגת רק עם הנכסים ב-`property_ids` של התא, וטבלת האירועים/תביעות התחתונה (`ClaimsTable`) מסוננת לפי שמות אותם נכסים; שבב (`Chip`) עם תיאור הסינון ומספר הנכסים מוצג ליד כל אחד מהם, עם כפתור `×` לניקוי הסינון

אומת ידנית בדפדפן: לחיצה על תא "הסתברות גבוהה × חומרה בינונית" (7 נכסים) מדגישה את התא, מסננת את המפה ל-7 הנקודות התואמות ואת טבלת התביעות לתביעות של אותם נכסים בלבד; מעבר ישיר לתא אחר (4 נכסים) מעדכן את הסינון בהתאם; ניקוי הסינון (כפתור `×` על השבב) מחזיר את המפה והטבלה למצב המלא. `tsc -b` נקי (מלבד שגיאת `stylis` הקיימת מראש). פותח בענף `feature/interactive-risk-matrix`.

**ניתוח יחס נזקים רב-שנתי:** יישום ההמלצה מהעדכון הקודם. `calculate_loss_ratio` ב-[`kpi.py`](../backend/app/services/kpi.py) המשיך להיקרא בברירת מחדל (שנה נוכחית) ב-KPI הראשי — זה לא שונה במכוון, כדי לא לשנות את משמעות הכרטיס הקיים בדשבורד — אך נוסף לצידו נתיב טרנד נפרד:
- `calculate_loss_ratio_trend` חדש ב-`kpi.py` — מקבץ תביעות לפי שנת האירוע (`Incident.incident_timestamp.year`) ומחשב יחס נזקים לכל שנה שיש בה נתונים (לא רק השנה הנוכחית)
- `GET /api/analytics/loss-ratio-trend` חדש ב-[`analytics.py`](../backend/app/routers/analytics.py), מחזיר רשימת `{year, loss_ratio, total_claimed, total_annual_premium}` ממוינת לפי שנה
- [`LossRatioTrendChart.tsx`](../frontend/src/components/LossRatioTrendChart.tsx) — גרף קו (recharts) עם קו יעד מקווקו על 35%, tooltip מפורט (אחוז + סכומים); נוסף כברירת מחדל לדשבורד ([`Dashboard.tsx`](../frontend/src/pages/Dashboard.tsx)) בכרטיס נפרד בין מטריצת הסיכונים/מפה לבין טבלת התביעות

אומת ידנית בדפדפן מול ה-DB האמיתי: הגרף מציג שתי נקודות — 2025 (99.4%, ₪3.5M מתוך ₪3.6M) ו-2026 (32.3%, בהתאמה ל-KPI הראשי בדשבורד) — ומדגים בבירור את הפער שה-KPI היחיד (שנה נוכחית בלבד) הסתיר. `tsc -b` נקי (מלבד שגיאת `stylis` הקיימת מראש), `py_compile` נקי. פותח בענף `feature/loss-ratio-trend`.

**ייצוא תביעות ל-Excel:** יישום ההמלצה מהעדכון הקודם. נוסף ייצוא צד-קליינט בלבד, ללא שינוי בקאנד:
- הותקנה תלות חדשה בפרונטאנד: `xlsx` (SheetJS)
- [`exportClaims.ts`](../frontend/src/exportClaims.ts) — פונקציית עזר שממירה את שורות `ClaimTrackingRow` המוצגות למסך (כולל `paid_amount`) לגיליון עם כותרות עמודות בעברית ותרגום ערכי enum (`HAZARD_LABELS`, `CLAIM_STATUS_LABELS`) לפני כתיבת קובץ `.xlsx` בדפדפן (`XLSX.writeFile`)
- כפתור "ייצוא ל-Excel" חדש ב-[`Claims.tsx`](../frontend/src/pages/Claims.tsx) ליד סינון הסטטוס, מייצא את השורות המסוננות המוצגות כרגע (שם קובץ עם תאריך נוכחי), מושבת כשאין נתונים

אומת: `tsc -b` נקי (מלבד שגיאת `stylis` הקיימת מראש), הכפתור נבדק בדפדפן מול הנתונים האמיתיים ולחיצה עליו לא הניבה שגיאות קונסולה (בדיקת ההורדה בפועל מוגבלת לסביבת ה-preview הסגורה בה נבדק). פותח בענף `feature/claims-excel-export`.

**התראות סף (threshold alerts):** יישום ההמלצה מהעדכון הקודם. נוסף מנגנון בסיסי (ספים קבועים, ללא קונפיגורציה — ראו סעיף 8) שמזהה שני סוגי חריגה:
- [`kpi.py`](../backend/app/services/kpi.py): `_geographic_clusters` חדש (מיצוי הלוגיקה שהייתה חבויה בתוך `calculate_mfl` לאשכולות גיאוגרפיים בפועל, עם דה-דופ' לפי חברות זהה), ו-`calculate_alerts` חדש שמפיק התראה לכל אשכול (≥2 נכסים) שה-MFL המצטבר שלו חוצה 20% מה-TIV הכולל, ולכל נכס עם 3+ אירועים פתוחים במקביל (`INCIDENT_CONCENTRATION_THRESHOLD`); כל התראה מסומנת `warning`/`critical` לפי מרחק מהסף
- `GET /api/analytics/alerts` חדש ב-[`analytics.py`](../backend/app/routers/analytics.py), `schemas.AlertOut` חדש
- [`AlertsBanner.tsx`](../frontend/src/components/AlertsBanner.tsx) — קומפוננטה חדשה (MUI `Alert`/`AlertTitle`, אדום ל-critical/כתום ל-warning); מוצגת ב-[`Dashboard.tsx`](../frontend/src/pages/Dashboard.tsx) מתחת לכותרת, מעל כרטיסי ה-KPI; לא מרנדרת דבר כשאין התראות

אומת ידנית בדפדפן מול ה-DB האמיתי: `GET /api/analytics/alerts` מחזיר בפועל התראת `incident_concentration` אחת (נכס "מרלו\"ג מודיעין", 3 אירועים פתוחים, `warning`), והבאנר מוצג בדשבורד עם הטקסט הנכון וללא שגיאות קונסולה. `tsc -b` ו-`py_compile` נקיים (מלבד שגיאת `stylis` הקיימת מראש). לא נצפתה בפועל התראת `geographic_exposure` בנתוני ה-seed הנוכחיים (אף אשכול לא חוצה את סף ה-20%), כך שהמסלול הזה נבדק רק בקריאה קפדנית של הקוד ולא הודגם חזותית. פותח בענף `feature/threshold-alerts`.

**ייצוא דוח הנהלה ל-PDF:** יישום ההמלצה מהעדכון הקודם. נוסף ייצוא צד-קליינט בלבד, ללא שינוי בקאנד:
- הותקנו תלויות חדשות בפרונטאנד: `jspdf`, `html2canvas`
- [`exportPdf.ts`](../frontend/src/exportPdf.ts) — `exportElementToPdf` גנרי: מצלם אלמנט DOM ל-canvas עם `html2canvas` ומטמיע אותו כתמונה בתוך PDF בגודל A4 (`jsPDF`), עם פיצול אוטומטי למספר עמודים אם הגובה חורג מעמוד בודד. הבחירה ב-html2canvas ולא בציור טקסט ישיר עם `jsPDF` היא בכוונה: לפונטים המובנים של `jsPDF` אין glyphs לעברית, כך שטקסט עברי מצויר ישירות יוצא ריק/משובש — צילום ה-DOM עוקף את זה כי הטקסט מרונדר ע"י מנוע העברה של הדפדפן עצמו, במחיר של PDF שהוא תמונה (לא טקסט הניתן לסימון/חיפוש)
- [`ExecutiveReportPrintable.tsx`](../frontend/src/components/ExecutiveReportPrintable.tsx) — קומפוננטת פריסה ייעודית להדפסה (HTML/inline styles פשוטים, לא MUI, כדי ש-`html2canvas` ירנדר בצורה צפויה): כותרת + תאריך הפקה, 4 כרטיסי KPI עיקריים (TIV, MFL, תביעות פתוחות, יחס נזקים), תקציב המנהלים שהופק ע"י ה-AI אם קיים בזמן הייצוא (מ-5.2), וטבלת התביעות המלאה
- [`Reports.tsx`](../frontend/src/pages/Reports.tsx) — כפתור "ייצוא ל-PDF" חדש ליד כפתור "הפק דוח" בכרטיס "דוח הנהלה"; מרנדר את `ExecutiveReportPrintable` במיכל ממוקם מחוץ למסך (`position: fixed; left: -9999px`, לא `display: none` — `html2canvas` לא יכול לצלם אלמנט שלא עבר layout בפועל) ומפעיל את הייצוא בלחיצה

אומת ידנית בדפדפן מול ה-DB האמיתי: הכרטיסים והטבלה (9 תביעות אמיתיות, כולל שמות נכסים עם גרשיים כמו `מרלו"ג מודיעין`) נטענים נכון במיכל הנסתר; לחיצה על "ייצוא ל-PDF" רצה עד סוף (הכפתור חוזר למצב הרגיל, ללא שגיאת קונסולה חדשה — שתי שגיאות ה-HMR הקיימות בקונסול שייכות לעריכה של סשן אחר על `AlertsBanner.tsx` ולא קשורות). בדיקת פתיחת קובץ ה-PDF שהופק בפועל מוגבלת לסביבת ה-preview הסגורה (כמו בייצוא ה-Excel). `tsc -b` נקי (מלבד שגיאת `stylis` הקיימת מראש). פותח בענף `feature/pdf-export`.

### מה עוד נשאר לעשות (מצב נכון ל-2026-08-16, לפני TODO_SPEC.md)

נבדק מיפוי פערים מול המפרט (routers, מסכים, מודל נתונים, seed data). כל הפערים המשמעותיים שזוהו במחזורי הפיתוח הקודמים נסגרו.

**מוצהר כמחוץ להיקף בזמנו (ראו סעיף 8 הישן):** RBAC/Audit Log, הצפנת at-rest, אינטגרציית ERP/Govmap, סנכרון offline, סימולציות Monte Carlo/VaR מלאות, התראות Push/SMS, שמירת מדיה אמיתית לאירועים — **כל אלה מומשו בפועל לאחר מכן דרך TODO_SPEC.md** (ראו §9 המעודכן למה שעדיין מסומל/מחוץ להיקף בפועל היום).

### שלב 10 (Quality & Ops) — סגירת TODO_SPEC.md

שלב 10, שהושלם ב-2026-08-20, סגר את הפערים התפעוליים האחרונים שנותרו פתוחים אחרי תשעת שלבי הבנייה: `backend/tests/` (50 בדיקות pytest — יחידה על שירותי החישוב, אינטגרציה על ה-API כולל RBAC, נגד SQLite בזיכרון כדי לא לדרוש SQL Server אמיתי בסביבת CI), `backend/alembic/` (מיגרציות הדרגתיות מעל `schema.sql`, ראו §8), ותיעוד זה (ERD מעודכן ל-18 טבלאות, קטלוג endpoints חדש ב-§6, הוראות הרצה מעודכנות). פירוט מלא, כולל מה נבדק בפועל בכל אחד, ב-TODO_SPEC.md עצמו.
