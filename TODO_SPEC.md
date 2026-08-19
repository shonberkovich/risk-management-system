# TODO_SPEC.md — משימות פיתוח פתוחות

מסמך זה נגזר מניתוח פערים בין מפרט הדרישות (RMIS) לבין המימוש הקיים.
הסדר הוא סדר בנייה מומלץ: תשתית ובסיס נתונים → שכבת שירותים → API → אבטחה → UI → אינטגרציות → מודלים מתקדמים.

---

## שלב 1 — Database & Data Model

- [x] **הרחבת טבלת הפוליסות**: הוספת `per_event_limit` (גבול אחריות לאירוע בודד), `bi_waiting_period_hours` (תקופת המתנה לאובדן רווחים), `exclusions` (החרגות, JSONB/Text).
  📁 `backend/app/models.py` (Class `InsurancePolicy`) + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/policy-extended-fields`: נוספו שלושת השדות כ-nullable ל-`InsurancePolicy` (`SmallInteger` ל-bi_waiting_period_hours, `UnicodeText` ל-exclusions) ול-`schema.sql`.

- [x] **הרחבת טבלת האירועים**: הוספת `is_draft` (שמירה כטיוטה), `business_interruption_requested` (בקשת כיסוי אובדן רווחים), `area_or_building` (אזור/מבנה בתוך הנכס), `reported_coordinates` (מיקום GPS של המדווח).
  📁 `backend/app/models.py` (Class `Incident`) + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/incident-extended-fields`: `is_draft`/`business_interruption_requested` כ-`BIT NOT NULL DEFAULT 0`, `area_or_building` (`NVARCHAR(150)` nullable), `reported_coordinates` (`NVARCHAR(50)` nullable, מחרוזת "lat,lng").

- [x] **טבלת רזרבות וצפי תזרים**: טבלה חדשה `Claim_Reserves` (claim_id, reserve_amount, expected_payment_date, updated_at) לניהול רזרבות וצפי גבייה.
  📁 `backend/app/models.py` + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/claim-reserves-table`: נוספה `ClaimReserve` (models.py) + טבלת `Claim_Reserves` ב-schema.sql (עם FK ל-Claims, אינדקס על claim_id, ו-relationship דו-כיווני מול `Claim`).

- [x] **טבלת Audit Log**: טבלה חדשה `Audit_Log` (user_id, entity_type, entity_id, action, old_value, new_value, timestamp, ip_address).
  📁 `backend/app/models.py` + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/audit-log-table`: נוספה `AuditLog` (models.py) + טבלת `Audit_Log` ב-schema.sql (FK אופציונלי ל-Users, `action` עם CHECK ל-CREATE/UPDATE/DELETE, `old_value`/`new_value` כ-NVARCHAR(MAX) לשמירת JSON, אינדקסים על entity_type+entity_id ועל user_id).

- [ ] **טבלת תפקידים והרשאות**: הרחבת `User` בשדה `role` (RISK_OFFICER / PROPERTY_MANAGER / CFO / ADJUSTER / ADMIN) + טבלת `Role_Permissions`.
  📁 `backend/app/models.py` (Class `User`) + `backend/sql/schema.sql`

- [ ] **טבלת מסמכים כללית (DMS)**: טבלה `Documents` המקשרת קבצים לכל ישות (policy / claim / property / incident) עם `s3_url`, `doc_type`, `uploaded_by`.
  📁 `backend/app/models.py` + `backend/sql/schema.sql`

- [ ] **טבלת אזורים גיאוגרפיים**: `Regions` (region_code, name) + שדה `region_id` ב-`Property`, לצורך דוח חשיפה לפי מרכז/צפון/דרום.
  📁 `backend/app/models.py` (Class `Property`) + `backend/sql/schema.sql`

- [ ] **טבלת נתוני מאקרו פיננסיים**: `Financial_Statements` (year, total_assets, revenue, net_income, insurance_expense) לניתוח רב-שנתי.
  📁 `backend/app/models.py` + `backend/sql/schema.sql`

- [ ] **אינדקסים חסרים**: אינדקס מרחבי GIST על `Properties.coordinates`, אינדקס מורכב על `Incidents(status, hazard_type)` ועל `Claims(claim_status, payment_date)`.
  📁 `backend/sql/schema.sql`

- [ ] **הרחבת נתוני הזרעה (Seed)** לכל הטבלאות והשדות החדשים.
  📁 `backend/app/seed.py` + `backend/sql/seed.sql`

---

## שלב 2 — Backend Services (לוגיקה עסקית)

- [ ] **מנוע רזרבות ותזרים מזומנים**: חישוב צפי תקבולים לפי סטטוס תביעה ותאריכי יעד, וסכימת רזרבות פתוחות.
  📁 קובץ חדש: `backend/app/services/cashflow.py`

- [ ] **מנגנון אופטימיזציה של השתתפות עצמית (Retention Optimizer)**: השוואה בין ספיגת נזק עצמית לבין הגשת תביעה, כולל השפעה צפויה על הפרמיה.
  📁 קובץ חדש: `backend/app/services/retention.py`

- [ ] **סימולציית Monte Carlo וחישוב VaR**: הגרלת תרחישי נזק לפי הסתברות/חומרה ברמת הנכס, והפקת אחוזוני VaR ברמת התיק.
  📁 קובץ חדש: `backend/app/services/simulation.py`

- [ ] **חשיפה מרחבית מצטברת (Limits Exposure)**: הרחבת חישוב האשכולות הקיים להחזרת רדיוס, מרכז אשכול וסך TIV מצטבר לכל אשכול.
  📁 `backend/app/services/kpi.py` (הרחבת `_geographic_clusters`)

- [ ] **חשיפה לפי אזור גיאוגרפי**: פונקציה המחזירה TIV, MFL וסך נזקים לכל `region`.
  📁 `backend/app/services/kpi.py`

- [ ] **חשיפת חישוב ROI למניעת סיכון כשירות מלא**: הפיכת `calculate_mitigation_roi` לשירות המחזיר עלות מול חיסכון צפוי בפרמיה ובנזקים.
  📁 `backend/app/services/kpi.py`

- [ ] **מנוע התראות והתראות חוצה-ערוצים**: הרחבת מנגנון ההתראות לשליחת Email/SMS/Push למנהל הסיכונים ול-CFO באירוע קריטי, כולל ספי התראה ניתנים להגדרה.
  📁 `backend/app/services/kpi.py` (`calculate_alerts`) + קובץ חדש `backend/app/services/notifications.py`

- [ ] **שירות ניתוח דוחות כספיים רב-שנתי**: חישוב מגמות ויחסים (עלות ביטוח מול הכנסות, נזקים מול שווי נכסים) לאורך שנים.
  📁 קובץ חדש: `backend/app/services/financials.py`

- [ ] **שירות אחסון קבצים (S3/Blob)**: העלאה, יצירת Signed URL, וקריאת מטא-דאטה EXIF/GPS מתמונות.
  📁 קובץ חדש: `backend/app/services/storage.py`

---

## שלב 3 — Backend API (Routers)

- [ ] **Endpoints להעלאת מדיה לאירוע**: העלאת תמונות/וידאו/PDF, שליפת רשימת מדיה, מחיקה — כולל שמירת קואורדינטות EXIF.
  📁 קובץ חדש: `backend/app/routers/media.py` + סכמות ב-`backend/app/schemas.py`

- [ ] **השלמת CRUD למשימות מיטיגציה**: יצירה, עדכון, שיוך מבצע, סגירה, וחישוב סטטוס `OVERDUE` אוטומטי + endpoint ל-ROI.
  📁 `backend/app/routers/mitigation.py`

- [ ] **Endpoints לרזרבות וצפי תזרים**: שליפת תחזית תקבולים חודשית ורזרבות פתוחות עבור הדשבורד.
  📁 `backend/app/routers/analytics.py` או קובץ חדש `backend/app/routers/cashflow.py`

- [ ] **Endpoint לחשיפה לפי אזורים**: החזרת טבלת TIV/MFL/נזקים לכל אזור עבור דוח ההנהלה.
  📁 `backend/app/routers/analytics.py`

- [ ] **Endpoint לאשכולות חשיפה מרחבית**: החזרת אשכולות גיאוגרפיים לציור על המפה.
  📁 `backend/app/routers/analytics.py`

- [ ] **Endpoints לסימולציה ו-VaR**: הרצת סימולציה עם פרמטרים (מספר איטרציות, אופק זמן) והחזרת התפלגות תוצאות.
  📁 קובץ חדש: `backend/app/routers/simulation.py`

- [ ] **Endpoint לאופטימיזציית השתתפות עצמית**: קלט אומדן נזק ופוליסה, פלט המלצה (לספוג / לתבוע).
  📁 קובץ חדש: `backend/app/routers/retention.py`

- [ ] **Endpoints לניהול מסמכים (DMS)**: העלאה ושליפה של פוליסות, דוחות שמאי ותכתובות לפי ישות.
  📁 קובץ חדש: `backend/app/routers/documents.py`

- [ ] **Endpoint לתיק אירוע מאוחד (Drill-down)**: החזרת אירוע + מדיה + תביעה + תשלומים + מסמכים בקריאה אחת.
  📁 `backend/app/routers/incidents.py`

- [ ] **תמיכה בשמירת אירוע כטיוטה** ובשליחה מאוחרת (Draft → Submitted).
  📁 `backend/app/routers/incidents.py` + `backend/app/schemas.py`

- [ ] **רישום כל הנתיבים החדשים באפליקציה**.
  📁 `backend/app/main.py`

---

## שלב 4 — Auth & Security

- [ ] **מודול אימות משתמשים**: התחברות, JWT/Session, רענון טוקן, יציאה.
  📁 קובץ חדש: `backend/app/routers/auth.py` + `backend/app/services/auth.py`

- [ ] **RBAC — הרשאות לפי תפקיד**: Dependency ב-FastAPI החוסמת גישה לנתיבים לפי תפקיד המשתמש (CFO / מנהל סיכונים / מנהל נכס / שמאי).
  📁 קובץ חדש: `backend/app/dependencies/permissions.py` + החלה על כל ה-routers

- [ ] **אינטגרציית SSO / Active Directory** (OAuth2 / SAML) לחיבור למערכת הזהויות הארגונית.
  📁 `backend/app/services/auth.py` + `backend/app/config.py`

- [ ] **Middleware ל-Audit Log**: תיעוד אוטומטי של כל פעולת כתיבה (מי, מה, מתי, ערך קודם/חדש).
  📁 קובץ חדש: `backend/app/middleware/audit.py`

- [ ] **הצפנת נתונים רגישים ותצורת אבטחה**: הצפנה במנוחה לשדות פיננסיים, אכיפת HTTPS, CORS מוגבל, ניהול סודות בסביבה.
  📁 `backend/app/config.py` + `backend/.env.example`

- [ ] **הגבלת קצב ו-API Key מסודר לשירותי AI**: חיזוק המנגנון הקיים והסרת מפתחות מהקוד.
  📁 `backend/app/routers/ai.py` + `backend/app/config.py`

---

## שלב 5 — Frontend: טפסים ודיווח שטח

- [ ] **שדרוג מסך דיווח אירוע לאשף שלבים (Wizard)**: 4 שלבים — זיהוי נכס, פרטי נזק, אומדן ותיאור, תיעוד מצולם.
  📁 `frontend/src/pages/IncidentReport.tsx`

- [ ] **זיהוי נכס לפי GPS**: קבלת מיקום המכשיר והצעת הנכסים הקרובים ברדיוס מוגדר.
  📁 קובץ חדש: `frontend/src/hooks/useGeolocation.ts` + שימוש ב-`IncidentReport.tsx`

- [ ] **רכיב העלאת מדיה**: צילום ישיר מהמצלמה, העלאת קבצים, תצוגה מקדימה ומחיקה.
  📁 קובץ חדש: `frontend/src/components/MediaUploader.tsx`

- [ ] **שמירה כטיוטה ושליחה מאוחרת** במסך הדיווח.
  📁 `frontend/src/pages/IncidentReport.tsx`

- [ ] **באנר חירום ורכיבי מגע גדולים**: הודעת חירום קבועה, כפתורי Pill לבחירת סוג נזק וחומרה עם קידוד צבע (ירוק/כתום/אדום).
  📁 `frontend/src/pages/IncidentReport.tsx` + `frontend/src/theme.ts`

- [ ] **שדה "בקשת כיסוי אובדן רווחים"** בטופס הדיווח.
  📁 `frontend/src/pages/IncidentReport.tsx`

- [ ] **הרחבת טופס הפוליסה**: גבול אחריות לאירוע בודד, תקופת המתנה, והחרגות.
  📁 `frontend/src/components/PolicyDialog.tsx`

---

## שלב 6 — Frontend: דשבורד, מפה ודוחות

- [ ] **שכבות מפה ניתנות להדלקה/כיבוי**: נכסים, אירועים פעילים, אזורי הצפה/שריפה.
  📁 `frontend/src/components/RiskMap.tsx`

- [ ] **הצגת אשכולות חשיפה מרחבית** (עיגולי ריכוז TIV) על גבי המפה.
  📁 `frontend/src/components/RiskMap.tsx`

- [ ] **Popup מפורט בלחיצה על נכס**: שווי, מנהל אחראי, פוליסה פעילה וגבול אחריות.
  📁 `frontend/src/components/RiskMap.tsx`

- [ ] **מסך תיק אירוע מלא (Drill-down)**: תמונות מהשטח, דוח שמאי, תביעה משויכת ותשלומים.
  📁 קובץ חדש: `frontend/src/pages/IncidentDetail.tsx` + ניתוב ב-`frontend/src/App.tsx`

- [ ] **מסך/כרטיס תזרים ורזרבות**: גרף צפי תקבולים לפי חודש מול רזרבות פתוחות.
  📁 קובץ חדש: `frontend/src/components/CashflowChart.tsx` + `frontend/src/pages/Dashboard.tsx`

- [ ] **טבלת חשיפה לפי אזורים** בדוח ההנהלה.
  📁 `frontend/src/components/ExecutiveReportPrintable.tsx`

- [ ] **מסך סימולציה ו-VaR**: הרצת סימולציה, הצגת התפלגות תוצאות ואחוזוני VaR.
  📁 קובץ חדש: `frontend/src/pages/Simulation.tsx`

- [ ] **מסך/רכיב אופטימיזציית השתתפות עצמית**: מחשבון "לספוג או לתבוע".
  📁 קובץ חדש: `frontend/src/components/RetentionCalculator.tsx`

- [ ] **השלמת ניהול משימות מיטיגציה ב-UI**: יצירה, עריכה, שיוך מבצע, סימון ביצוע והצגת ROI.
  📁 `frontend/src/pages/Mitigation.tsx` + `frontend/src/components/MitigationTable.tsx`

- [ ] **מסך ניהול מסמכים**: העלאה וצפייה בפוליסות, דוחות שמאי ותכתובות.
  📁 קובץ חדש: `frontend/src/pages/Documents.tsx`

- [ ] **מסכי התחברות וניהול משתמשים**: מסך Login, הצגת תפקיד, והסתרת תפריטים לפי הרשאה.
  📁 קבצים חדשים: `frontend/src/pages/Login.tsx`, `frontend/src/auth/AuthContext.tsx` + `frontend/src/components/Layout.tsx`

- [ ] **הרחבת שכבת ה-API בפרונט** לכל ה-Endpoints החדשים (מדיה, מסמכים, סימולציה, תזרים, אימות).
  📁 `frontend/src/api/client.ts`

---

## שלב 7 — Mobile & Offline

- [ ] **התאמת PWA**: manifest, Service Worker, והתקנה כאפליקציה במכשיר נייד.
  📁 `frontend/index.html`, `frontend/vite.config.ts` + קובץ חדש `frontend/public/manifest.json`

- [ ] **מנגנון Offline Sync**: שמירת דיווחים ותמונות בזיכרון מקומי (IndexedDB) וסנכרון אוטומטי עם חידוש הקליטה.
  📁 קובץ חדש: `frontend/src/offline/syncQueue.ts`

- [ ] **אינדיקציית מצב חיבור** בממשק הדיווח.
  📁 `frontend/src/components/Layout.tsx`

---

## שלב 8 — Integrations

- [ ] **מחבר ERP / הנהלת חשבונות** (SAP / Oracle / Priority): משיכת שווי נכסים בספרים ורישום תקבולי תביעות.
  📁 קובץ חדש: `backend/app/integrations/erp.py`

- [ ] **פתיחת משימה אוטומטית ב-ERP/תחזוקה** בעת אירוע בחומרה קריטית.
  📁 `backend/app/integrations/erp.py` + `backend/app/routers/incidents.py`

- [ ] **מחבר GIS חיצוני** (Govmap / Mapbox Layers): שכבות אזורי הצפה וסיכון אקלימי.
  📁 קובץ חדש: `backend/app/integrations/gis.py`

- [ ] **מחבר נתוני מזג אוויר**: התראות מזג אוויר קיצוני לפי מיקום הנכסים.
  📁 קובץ חדש: `backend/app/integrations/weather.py`

- [ ] **מחבר מדדים כלכליים**: מדד אינפלציה ומחירי תשומות בנייה לעדכון שווי כינון.
  📁 קובץ חדש: `backend/app/integrations/economics.py`

- [ ] **שירות שליחת התראות חיצוני** (SMS / Email / Push).
  📁 `backend/app/services/notifications.py` + `backend/app/config.py`

---

## שלב 9 — Compliance & Reporting

- [ ] **דוח תאימות ISO 31000**: מיפוי סיכונים, בעלי אחריות וסטטוס בקרות.
  📁 קובץ חדש: `backend/app/routers/compliance.py` + `frontend/src/pages/Compliance.tsx`

- [ ] **דוחות רגולטוריים** בהתאם להנחיות רשות שוק ההון / Solvency II.
  📁 `backend/app/services/financials.py` + `frontend/src/pages/Reports.tsx`

- [ ] **מסך צפייה ב-Audit Log** למנהלי מערכת בלבד.
  📁 קובץ חדש: `frontend/src/pages/AuditLog.tsx`

- [ ] **הרחבת דוח ההנהלה**: הוספת סימולציית VaR, ROI על מיטיגציה וניתוח מגמות רב-שנתי.
  📁 `frontend/src/components/ExecutiveReportPrintable.tsx`

---

## שלב 10 — Quality & Ops

- [ ] **בדיקות יחידה לשירותי החישוב** (TIV, MFL, Loss Ratio, ROI, VaR).
  📁 תיקייה חדשה: `backend/tests/`

- [ ] **בדיקות אינטגרציה ל-API** (אירועים, תביעות, פוליסות, הרשאות).
  📁 `backend/tests/`

- [ ] **מיגרציות בסיס נתונים מסודרות** (Alembic) במקום עדכון ידני של הסכימה.
  📁 תיקייה חדשה: `backend/alembic/`

- [ ] **עדכון תיעוד**: ERD מעודכן, תיאור Endpoints והוראות הרצה.
  📁 `docs/erd.md`, `docs/README.md`, `README.md`
