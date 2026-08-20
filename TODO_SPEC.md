1. Database & Data Model (בסיס נתונים)
[x] הרחבת Financial_Statements למאזן מלא — כיום קיימים רק נכסים, הכנסות, רווח והוצאות ביטוח. יש להוסיף התחייבויות, הון עצמי ורווח תפעולי (backend/app/models.py + מיגרציית Alembic).
✅ בוצע ב-branch feature/financial-statements-full-balance-sheet: נוספו total_liabilities, total_equity, gross_profit, operating_profit (nullable) ל-FinancialStatement, schema.sql, מיגרציית Alembic 8f2a4c6e1d09, seed.py, schemas.py ו-frontend/src/api/client.ts. services/financials.py חושב כעת gross_margin/operating_margin/equity_ratio, ודוח הרגולציה משתמש ב-total_equity האמיתי (עם נפילה ל-total_assets לשורות ישנות).

[x] טבלת נמעני התראות (Notification_Recipients) — הוצאת נמעני ההתראות מהקוד (Hardcoded) לטבלה דינמית לצורך ניהול עתידי דרך ה-UI.
✅ בוצע ב-branch feature/notification-recipients-table: נוספה טבלת Notification_Recipients (models.py, schema.sql, מיגרציית Alembic c3d9a17f4b62, seed.py — מיגרציה של שני נמעני ברירת המחדל הקודמים). services/notifications.py קורא כעת מה-DB דרך _load_recipients (עם נפילה חזרה ל-DEFAULT_RECIPIENTS אם הטבלה ריקה). נוספו endpoints לניהול: GET/POST/PATCH/DELETE /api/notifications/recipients (כתיבה מוגבלת ל-ADMIN), schemas.py, docs/erd.md, וטסטים ב-test_api_notification_recipients.py.

[x] טבלת Notification_Log — תיעוד התראות שנשלחו בפועל (ערוץ, נמען, סטטוס, חותמת זמן) לצורך Audit Trail.
✅ בוצע ב-branch feature/notification-log-table: נוספה טבלת Notification_Log (models.py, schema.sql עם אינדקס על sent_at, מיגרציית Alembic d4e1b298a715). services/notifications.dispatch_notifications כותבת כעת שורת Audit לכל התראה שנשלחה (בנוסף ל-logger.log הזמני שהיה קיים). נוסף endpoint לקריאה בלבד: GET /api/notifications/log (אותה קבוצת תפקידים כמו preview/dispatch, ללא endpoint כתיבה — האפליקציה היא הכותבת היחידה), schemas.py, docs/erd.md, וטסטים ב-test_api_notification_log.py.

[x] אינדקסים לביצועים — הוספת אינדקס מרחבי (GIST) על קואורדינטות נכסים, FK indexes ואינדקסים מורכבים בטבלאות התביעות והאירועים.
✅ בוצע ב-branch feature/performance-indexes (backend/sql/schema.sql + מיגרציית Alembic e5f7a2c9b3d1). בבדיקה מול הסכימה הקיימת התברר ששני חלקים מהמשימה כבר טופלו בעבר (commit c7cbdcb, "Add Claim_Payments composite index; document existing/impractical index gaps") אך התיעוד שלהם ב-TODO_SPEC.md אבד בעדכון מאוחר יותר של הקובץ (commit 3823186): (1) "אינדקס מרחבי GIST" — GIST הוא מנוע PostgreSQL; SQL Server דורש לשם כך עמודת geography/geometry ייעודית במקום זוג ה-DECIMAL הקיימים (latitude/longitude), שינוי מבנה נתונים החורג מהיקף המשימה — האינדקס המורכב הקיים IX_Properties_Coordinates(latitude, longitude) כבר משרת בפועל את דפוסי השאילתה (מפה, אשכולות MFL), עם הערה מתועדת ב-schema.sql המסבירה את הפער. (2) "אינדקס מורכב על Incidents(status, hazard_type)" ו-"Claims(claim_status, payment_date)" — כבר קיימים כ-IX_Incidents_StatusHazard ו-IX_ClaimPayments_ClaimDate (payment_date קיים בפועל ב-Claim_Payments ולא ב-Claims); תוקנה גם הפניה תלויה (dangling) בהערת schema.sql ל-"אינדקסים חסרים" שכבר לא קיים כסעיף. מה שבאמת נותר וטופל כעת: **FK indexes חסרים** על חמש עמודות שלא היו ממופתחות — Properties.primary_manager_id (IX_Properties_PrimaryManager), Policy_Assets.property_id כעמודה עצמאית מעבר ל-PK המורכב (IX_PolicyAssets_Property), Incidents.reported_by_user_id (IX_Incidents_ReportedBy), Incident_Media.incident_id (IX_IncidentMedia_Incident), Mitigation_Tasks.assigned_to_user_id (IX_Mitigation_AssignedTo). models.py לא עודכן (עקביות עם הדפוס הקיים בקוד — כל האינדקסים מוגדרים רק ב-schema.sql, לא כ-Index() ב-ORM). 58/58 טסטים עוברים.

[x] ניהול מיגרציות — יצירת מיגרציות אינקרמנטליות לכל שינויי הסכימה תחת backend/alembic/versions/.
✅ בוצע ב-branch feature/verify-migration-chain: אומת (`alembic history`) ששרשרת המיגרציות תחת backend/alembic/versions/ שלמה ורציפה, ראש יחיד ללא ענפים — <base> → 5d5363142853 (baseline, תואם schema.sql נכון למועד היווצרותו, ר' c6d2ea1) → 8f2a4c6e1d09 (financial statements) → c3d9a17f4b62 (Notification_Recipients) → d4e1b298a715 (Notification_Log) → e5f7a2c9b3d1 (performance indexes, head). כל שינוי סכימה שבוצע מאז יצירת ה-baseline קיבל בפועל מיגרציה ייעודית משלו במקביל לעדכון schema.sql (התהליך שתואר ב-CLAUDE.md כבר נשמר בפועל ב-4 השינויים האחרונים) — לא נמצא פער. לא בוצע שינוי קוד; זו משימת אימות/תיעוד בלבד, ללא נספח קוד.

2. Backend — APIs חסרים (ליבת הלוגיקה)
[ ] CRUD מלא לנכסים — הוספת POST, PUT, DELETE ל-properties.py (קריטי לניהול Asset Inventory).

[ ] API לסקרי סיכונים (Asset_Risk_Profiles) — יצירת Endpoint ליצירה ועדכון של סקר סיכונים, MFL ואמצעי מיגון (risk_profiles.py).

[ ] API לעדכון רזרבות (Claim_Reserves) — הוספת דרך להזין ולעדכן רזרבה על תביעה פתוחה ב-claims.py.

[ ] ניהול משתמשים (users.py) — הוספת יכולות כתיבה: יצירת משתמש, עריכת פרטים, שינוי תפקיד והשבתה.

[ ] ניהול Role_Permissions — יצירת API לצפייה ולעריכה של הרשאות לפי תפקיד (החלפת ה-Seed הקבוע).

[ ] API פיננסי — הוספת אפשרות הזנה (POST) של דוחות כספיים רב-שנתיים למערכת ב-financials.py.

[ ] אוטומציית שטח (ERP & Alerts) — חיבור טריגר למשימת אחזקה ב-ERP ומשלוח התראות Push/SMS בעת הגשת אירוע בסטטוס CRITICAL.

3. אבטחה, RBAC ותאימות (Security & Compliance)
[ ] אכיפת RBAC על בקשות ה-GET — חסימת צפייה במידע פיננסי (KPIs, פוליסות) לתפקידים כמו FIELD_WORKER על ידי הוספת require_roles גם לקריאות קריאה.

[ ] הצפנת שדות רגישים — הצפנת פרטי שמאי, סכומי כיסוי רגישים ומטא-דאטה מעבר למוצפן כיום (ב-encryption.py).

[ ] מוכנות לפרודקשן (Production Ready) — הפעלת force_https=True מבוסס משתני סביבה ומנגנון רוטציית מפתחות ל-JWT ולשדות מוצפנים.

[ ] הרחבת דוחות רגולציה — הרחבת מודול ה-Compliance גם לתקני Solvency II והנחיות שוק ההון.

4. חוויית משטח, AI ומובייל (Field UX & Copilot) — חדש
[ ] סייר AI (Copilot Widget) — פיתוח רכיב צף ב-UI לשאילתות שפה טבעית מול מנוע ה-AI (/api/ai/ask) עבור מנהלי הסיכונים.

[ ] סיווג אוטומטי בטופס הדיווח — הוספת כפתור "נתח בעזרת AI" בטופס דיווח אירוע שממלא אוטומטית חומרה, סוג והערכת נזק על בסיס הטקסט באמצעות קריאה ל-/api/ai/classify-incident.

[ ] זיהוי נכס מבוסס GPS — מימוש לחצן "זהה מיקום" שמפעיל Browser Geolocation API ובוחר אוטומטית את הנכס הקרוב ביותר לזירת האירוע.

[ ] סנכרון Offline מלא — הרחבת תור הסנכרון (syncQueue.ts) לתמיכה בעריכת טיוטות, הגשה סופית והעלאת מדיה במצב ללא אינטרנט.

[ ] חילוץ EXIF ממדיה — חילוץ והצגת מטא-דאטה של מיקום וזמן מתמונות המועלות דרך טופס דיווח הנזק.

5. Frontend — מסכים ודשבורדים חסרים
[ ] ניהול משתמשים והרשאות (Users.tsx / Roles.tsx) — פיתוח מסכי הניהול ל-ADMIN, כולל הוספתם לתפריט הניווט (NAV).

[ ] ניהול נכסים ותיק נכס (PropertyDetail.tsx) — טופס להוספה/עריכה של נכס, ומסך Drill-down מלא המציג את הפוליסה, המסמכים וסקר הסיכונים של נכס בודד.

[ ] מסך סקר סיכונים (RiskSurveyDialog.tsx) — ממשק להזנת ציוני הצפה, שריפה, רעידת אדמה ואמצעי מיגון.

[ ] דשבורד מותאם לשטח (Field Worker) — יצירת תצוגה מצומצמת שמסתירה נתונים פיננסיים (MFL, VaR) ומציגה רק סטטוס אירועים וסנכרון רשת.

[ ] מסכי אינטגרציה והתראות (Notifications.tsx / Integrations.tsx) — ממשקים לצפייה ביומני התראות וסנכרון ידני מול מערכות ERP/GIS.

6. אנליטיקה חזותית וחישובים אינטראקטיביים — חדש
[ ] סימולציית VaR אינטראקטיבית (Simulation.tsx) — יצירת מסך המציג היסטוגרמה של התפלגות הנזק מתוך פלט מונטה-קרלו, עם סליידרים לאיטרציות ושנות אופק.

[ ] מחשבון השתתפות עצמית (RetentionCalculator.tsx) — פיתוח כלי הממליץ האם לספוג נזק (ABSORB) או לתבוע (CLAIM), על בסיס שווי האירוע והתייקרות הפרמיה הצפויה.

[ ] שדרוג מפת הסיכונים (Risk Map) — הוספת Layer Control למפה להדלקה/כיבוי של שכבות: סיכות לפי סטטוס, אזורי הצפה וסימון אשכולות חשיפה (Clusters). הוספת כפתור מעבר לתיק הנכס מתוך הפופ-אפ.

[ ] שילוב מזג אוויר — שילוב התראות מזג אוויר אזוריות בדשבורד המרכזי באמצעות רכיב הבאנר.

7. אינטגרציות (חיבורים חיצוניים "אמיתיים")
[ ] תקשורת: החלפת הלוגים (Simulated) במימוש מול שירותי Email / SMS (למשל: Twilio / SendGrid).

[ ] אחסון ענן: החלפת שמירת הקבצים המקומית ב-AWS S3 או Azure Blob.

[ ] סנכרון שווי: בניית מחבר פעיל לסנכרון שווי נכסים מול מערכת ERP.

[ ] שכבות מפה: קריאה לשירות Govmap או Mapbox לקבלת מפות הצפה/אקלים אמיתיות במקום חישובים פנימיים.

[ ] הזדהות ארגונית: השלמת זרימת OAuth2 / OIDC מול שירותי Azure AD / Okta למשתמשי המטה.

8. דוחות מודפסים וייצוא (Reports)
[ ] ייצוא ל-Excel — הוספת פונקציונליות ייצוא לדוחות חשיפה תקופתיים ודוחות השתתפות עצמית.

[ ] דוח הפחתת סיכון מודפס (MitigationReportPrintable.tsx) — יצירת תצוגה מותאמת להדפסה של דוח משימות המיטיגציה וחישובי ה-ROI.

[ ] פילוח חשיפה בדוח הנהלה — שילוב התפלגות החשיפה (TIV/MFL) לפי אזור גיאוגרפי (צפון, מרכז, דרום) בתוך ה-Executive Report הקיים.

9. בדיקות, תיעוד והגשה (Testing & Demo Prep)
[ ] בדיקות Backend — הוספת טסטים למודולים שטרם כוסו (Cashflow, Financials, Compliance, Analytics, Notifications).

[ ] בדיקות הרשאות רגרסיה — יצירת טסטים למערך ה-RBAC על פונקציות הקריאה (GET) כדי לוודא שמשתמשי שטח לא נחשפים למידע פיננסי.

[ ] בדיקות Frontend ו-E2E — הוספת Vitest ו-React Testing Library, ומימוש E2E לבדיקת זרימת שטח: Offline -> Sync -> Incident -> Claim.

[ ] תסריט הדגמה (docs/DEMO_SCRIPT.md) — כתיבת מסמך Walkthrough המנחה את המרצה/הבודק בצעדי שימוש במערכת מקצה לקצה.

[ ] תיעוד ארכיטקטורה (docs/ARCHITECTURE.md + ROLES_MATRIX.md) — עדכון תרשימי ה-ERD בעזרת Mermaid, ויצירת מטריצת הרשאות ברורה כרפרנס לכלל תפקידי המערכת.
