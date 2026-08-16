# RMIS — מערכת מידע לניהול סיכונים משולבת AI

מסמך תיעוד טכני לפרויקט בקורס ניהול סיכונים (תואר שני, מדעי המחשב).

## 1. רקע ומטרה

המערכת מחברת בין העולם הפיזי (נכסים, מפגעים, אירועי נזק) לעולם הפיננסי (פוליסות ביטוח, תביעות, תזרים), ומספקת שכבת בינה מלאכותית (LLM) המסייעת למנהל הסיכונים בסיווג אירועים, הפקת דוחות וקבלת תשובות על נתוני המערכת בשפה טבעית.

הפרויקט הוא **דמו עובד end-to-end**, לא מוצר production. סעיף 8 מפרט מה נותר מחוץ להיקף.

## 2. ארכיטקטורה טכנולוגית

```
┌─────────────────────────────────────────────────────────┐
│  Frontend — React 18 + TypeScript + Vite                │
│  MUI v6 (RTL) · React Query · React Router · Leaflet ·   │
│  Recharts                                                 │
└───────────────────────┬───────────────────────────────────┘
                         │ REST (JSON) — proxy /api → :8000
┌───────────────────────▼───────────────────────────────────┐
│  Backend — Python 3.12 · FastAPI · SQLAlchemy 2.0 ORM     │
│  Routers: properties / incidents / policies / claims /   │
│  mitigation / analytics / ai                              │
│  Services: kpi.py (חישובי סיכון) · llm.py (Anthropic)     │
└───────────────────────┬───────────────────────────────────┘
                         │ pyodbc (ODBC Driver 17)
┌───────────────────────▼───────────────────────────────────┐
│  SQL Server (LocalDB) — RiskDB                            │
│  9 טבלאות, NVARCHAR ל-Unicode, FK מלא, אינדקסים            │
└───────────────────────┬───────────────────────────────────┘
                         │
┌───────────────────────▼───────────────────────────────────┐
│  Anthropic Claude API (claude-opus-5)                     │
│  1. סיווג אירוע (Structured Outputs)                       │
│  2. דוח הנהלה (Streaming)                                  │
│  3. שאלות על הנתונים (Tool Use מאובטח)                     │
└─────────────────────────────────────────────────────────┘
```

**למה הסטאק הזה:** React+Python+SQL Server נבחר על פי דרישת המשתמש. FastAPI נבחר על פני Flask/Django בשל תמיכה מובנית ב-async, תיעוד Swagger אוטומטי (`/docs`), ואינטגרציה טבעית עם Pydantic (משמש גם ל-structured outputs של Claude). SQL Server LocalDB נבחר על פני Docker כדי לצמצם תלויות סביבה.

## 3. מודל הנתונים

9 טבלאות לפי המפרט המקורי, עם התאמות ל-SQL Server:

| החלטה | נימוק |
|---|---|
| `NVARCHAR` לכל טקסט | חובה לתמיכה בעברית (Unicode) |
| `NVARCHAR(30) + CHECK` במקום `ENUM` | אין טיפוס ENUM מובנה ב-SQL Server |
| `latitude/longitude DECIMAL(9,6)` במקום PostGIS `Point` | פשוט, מספיק לכ-50 נכסים, עובד ישירות עם Leaflet |
| Composite index על `(latitude, longitude)` במקום GIST spatial index | ללא הרחבת PostGIS ב-SQL Server; מספיק בהיקף הדמו |

ראו ERD מלא ב-[erd.md](./erd.md) וסכימת DDL מלאה ב-[`backend/sql/schema.sql`](../backend/sql/schema.sql).

**שרשרת הערך:** `Properties → Asset_Risk_Profiles → Incidents → Claims → Claim_Payments`, עם `Insurance_Policies` ↔ `Properties` דרך טבלת קישור `Policy_Assets`, ו-`Mitigation_Tasks` כמסלול נפרד לניהול תחזוקה מונעת.

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

## 6. מבנה תיקיות

```
risk-management-system/
├── backend/
│   ├── app/
│   │   ├── main.py, config.py, database.py, models.py, schemas.py
│   │   ├── routers/        # properties, incidents, policies, claims, mitigation, analytics, ai
│   │   ├── services/       # kpi.py, llm.py
│   │   └── seed.py         # נתוני דמו (Python/pyodbc — לא sqlcmd, ר' סעיף 9)
│   ├── sql/schema.sql       # DDL מלא
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/           # Dashboard, Properties, IncidentReport, Claims, Reports
│       ├── components/      # KpiCard, RiskMap, RiskMatrix, HazardChart, ClaimsTable
│       └── api/client.ts    # טיפוסי TS + קריאות API
└── docs/                    # מסמך זה + ERD + צילומי מסך
```

## 7. הרצה מקומית

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # ולמלא ANTHROPIC_API_KEY
sqlcmd -S "(localdb)\MSSQLLocalDB" -C -i sql\schema.sql
python -m app.seed
uvicorn app.main:app --reload

# Frontend (טרמינל נפרד)
cd frontend
npm install
npm run dev
```

גישה: Frontend ב-`http://localhost:5173`, Swagger UI ב-`http://localhost:8000/docs`.

## 8. מה מחוץ להיקף (עבודה עתידית)

לפי המפרט המקורי, הפריטים הבאים תועדפו החוצה בכוונה כדי למקד את הדמו בשרשרת הערך המרכזית:

- אינטגרציית ERP (SAP/Priority) לסנכרון שווי נכסים ותשלומים
- אינטגרציית Govmap למפות סיכון רשמיות (הוחלף ב-OpenStreetMap חינמי)
- סנכרון offline למובייל בשטח
- RBAC מלא ו-Audit Log (יש טבלת `Users` עם `role`, אך אין אכיפת הרשאות בפועל)
- הצפנת נתונים at-rest
- סימולציות Monte Carlo לחישוב VaR מלא (הוחלף בחישובי MFL/Risk Score דטרמיניסטיים)
- התראות Push/SMS אוטומטיות על אירועים קריטיים
- ייצוא PDF מעוצב לדירקטוריון (יש ייצוא נתונים גולמי בלבד)
- העלאת מדיה אמיתית לאירועים (יש טבלת `Incident_Media` בסכימה, אך העלאת קבצים בטופס היא הדגמה בלבד ללא שמירה בשרת)

## 9. הערות פיתוח ומלכודות שנתקלנו בהן

תיעוד לצורכי שקיפות (רלוונטי גם לדוח ההגשה):

1. **`sqlcmd` שיבש טקסט עברי בפועל** (לא רק בתצוגה) בזמן טעינת נתוני seed — קידוד הקובץ מול פענוח sqlcmd לא תאמו. הפתרון: מעבר לטעינת seed data דרך Python + `pyodbc` עם פרמטרים (`app/seed.py`), שמטפל ב-Unicode נכון באופן טבעי.
2. **`DBCC CHECKIDENT ... RESEED 0`** על טבלה שמעולם לא הוכנסו אליה שורות מתנהג אחרת (ה-ID הבא הופך להיות ממש 0/הערך שהוזן) לעומת טבלה שכבר אוכלסה בעבר (ה-ID הבא = ערך+1). הפתרון בשימוש: `schema.sql` תמיד מבצע DROP+CREATE מסודר (בסדר תלויות FK הפוך) לפני seeding, כדי שההתנהגות תהיה עקבית.
3. **SQLAlchemy `String`/`Text` גנרי במקום `Unicode`/`UnicodeText`** יכול לגרום ל-pyodbc לקשור פרמטרים כ-ANSI צר במקום Unicode רחב, מה שהופך טקסט עברי ל-`?????` בזמן INSERT — למרות שהעמודה בפועל היא `NVARCHAR`. כל השדות הטקסטואליים ב-`models.py` משתמשים כעת ב-`Unicode`/`UnicodeText` באופן מפורש.
4. **`--reload` של uvicorn** תקוע לעיתים אחרי כמה מחזורי rewrite מהירים על אותם קבצים (במיוחד ב-Windows) — נצפה `RuntimeWarning: coroutine 'Server.serve' was never awaited`. הפתרון: הפעלה מחדש מלאה של תהליך השרת אחרי שינויים משמעותיים, ולא הסתמכות בלבד על ה-reloader.

## 10. סטטוס נוכחי ומשימות להמשך

עדכון אחרון: 2026-08-16.

### מה בוצע עד כה

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

אומת ידנית בדפדפן מול ה-DB האמיתי: 25 האירועים הקיימים נטענים עם ה-KPIs הנכונים, סינון לפי סטטוס עובד, ופתיחת דיאלוג "פתח תביעה" שולפת בהצלחה את הפוליסות הזמינות דרך `eligible-policies` (`GET /api/incidents/25/eligible-policies` אומת ב-Network). טרם נבדק ידנית מסלול השליחה המלא (`POST /api/claims`, `PATCH /api/incidents/{id}/status`, `PATCH /api/claims/{id}`) כדי לא לזהם seed data משותף שנבדק גם על ידי סשן אחר שרץ באותו זמן על אותו dev server — נבדק רק סטטית (`py_compile`, `tsc -b`, ללא שגיאות חדשות מעבר לשגיאת ה-`stylis` הקיימת מראש).

### מה עוד נשאר לעשות

נבדק מיפוי פערים מול המפרט (routers, מסכים, מודל נתונים, seed data). בסדר עדיפות משוער:

**פערים משמעותיים בהיקף הפרויקט:**
- **מטריצת הסיכונים אינה אינטראקטיבית:** ה-API של `/api/analytics/risk-matrix` כבר מחזיר `property_ids` לכל תא, אך ב-[`RiskMatrix.tsx`](../frontend/src/components/RiskMatrix.tsx) אין `onClick` — לחיצה על תא לא מסננת כלום (למרות ה-`cursor:pointer` ב-CSS).
- **ניתוח רב-שנתי / מגמות:** `calculate_loss_ratio` ב-[`kpi.py`](../backend/app/services/kpi.py) מקבל פרמטר `year` אך תמיד נקרא בברירת מחדל (שנה נוכחית) — כלומר יחס הנזקים כרגע **מתעלם משנת 2025 כולה**. אין אנדפוינט טרנד רב-שנתי בכלל.
- **`Claim_Payments` יתום לחלוטין:** הטבלה קיימת, מאוכלסת (5 רשומות), עם `relationship` במודל — אך אין אנדפוינט, סכימה, או שימוש בקוד בכלל. זו נקודת ההתחלה הטבעית למודול "ניהול רזרבות ותזרים" מהמפרט.
- **ייצוא דוחות (Excel/PDF):** אין שום יכולת ייצוא בקוד (לא openpyxl, לא reportlab, לא כפתור הורדה). מוזכר כדוגמה ב-wireframes ("ייצוא ל-Excel", "ייצוא דוח הנהלה PDF") אך לא מומש.
- **התראות סף (thresholds/alerts):** אין מנגנון טריגרים — לא על חשיפה גיאוגרפית שחוצה סף, לא על אירוע קריטי. ה-"תיבחור" הקיים (`_band` ב-`analytics.py`) הוא חלוקה קבועה ל-3 רמות, לא סף מוגדר.

**מוצהר כמחוץ להיקף (ראו סעיף 8) ולא צפוי להשתנות בפרויקט הקורס:** RBAC/Audit Log, הצפנת at-rest, אינטגרציית ERP/Govmap, סנכרון offline, סימולציות Monte Carlo/VaR מלאות, התראות Push/SMS, שמירת מדיה אמיתית לאירועים (`Incident_Media` קיימת במודל ומעולם לא נזרעה).

**המלצה לצעד הבא:** הפעלת `Claim_Payments` — הטבלה קיימת ומאוכלסת (5 רשומות) אך יתומה לחלוטין (ללא אנדפוינט/סכימה/UI). עם זרימת העבודה של אירועים/תביעות קיימת עכשיו, זהו הצעד הטבעי הבא: מודול "ניהול רזרבות ותזרים" שמציג את תשלומי התביעות בפועל (מקדמות מול סילוק סופי) מול הסכום המאושר, ומאפשר רישום תשלום חדש לתביעה שאושרה.
