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
[x] CRUD מלא לנכסים — הוספת POST, PUT, DELETE ל-properties.py (קריטי לניהול Asset Inventory).
✅ בוצע ב-branch feature/properties-crud: נוספו POST /api/properties (יצירה, בדיקת ייחודיות property_code, ולידציית קיום primary_manager_id/region_id), PUT /api/properties/{id} (עדכון חלקי, אותן ולידציות) ו-DELETE /api/properties/{id} (soft delete — is_active=False, ולא מחיקה פיזית, כדי לשמר את שרשרת הנתונים התלויה: Asset_Risk_Profiles/Incidents/Claims/Mitigation_Tasks/Policy_Assets — GET /api/properties הקיים כבר מסנן לפי is_active כך שההיסטוריה נשארת נגישה דרך GET /{id}). תפקידי כתיבה: RISK_MANAGER/PROPERTY_MANAGER/ADMIN (כמו mitigation.py). נוספו PropertyCreate/PropertyUpdate ב-schemas.py, עודכן docs/README.md (טבלת ה-routers), וטסטים ב-test_api_properties_crud.py. 68/68 טסטים עוברים (10 חדשים).

[x] API לסקרי סיכונים (Asset_Risk_Profiles) — יצירת Endpoint ליצירה ועדכון של סקר סיכונים, MFL ואמצעי מיגון (risk_profiles.py).
✅ בוצע ב-branch feature/risk-profiles-api: נוסף ראוטר חדש backend/app/routers/risk_profiles.py, רשום ב-main.py. מאחר ול-Property יש לכל היותר פרופיל סיכון אחד (יחס 1:1, models.Property.risk_profile), ה-endpoints מקוננים תחת /api/properties/{property_id}/risk-profile ולא כאוסף שטוח: GET (שליפה), POST (יצירה ראשונה — 409 אם כבר קיים פרופיל, מכוון להשתמש ב-PUT), PUT (עדכון חלקי/סקר חוזר — 404 אם עוד אין פרופיל). ולידציית טווח 1-5 לציוני הסיכון (flood/fire/earthquake) ב-Pydantic (Field(ge=1, le=5)) כדי להחזיר 422 ברור במקום שגיאת CHECK גולמית מה-DB. נוספו RiskProfileCreate/RiskProfileUpdate ב-schemas.py, עודכן docs/README.md (טבלת ה-routers וספירת ה-routers ל-19), וטסטים ב-test_api_risk_profiles.py. 77/77 טסטים עוברים (9 חדשים).

[x] API לעדכון רזרבות (Claim_Reserves) — הוספת דרך להזין ולעדכן רזרבה על תביעה פתוחה ב-claims.py.
✅ בוצע ב-branch feature/claim-reserves-api: נוספו ל-claims.py שלושה endpoints תחת /api/claims/{claim_id}/reserves — GET (רשימה, מהחדש לישן), POST (הזנת רזרבה חדשה) ו-PATCH /{reserve_id} (עדכון). שניהם (POST/PATCH) חסומים לתביעה "פתוחה" בלבד — נבדק מול claim_status לא ב-_TERMINAL_CLAIM_STATUSES (SETTLED/REJECTED), אותו guard הקיים כבר ב-update_claim. נוספו ClaimReserveOut/Create/Update ב-schemas.py, עודכן docs/README.md, וטסטים ב-test_api_claim_reserves.py. 83/83 טסטים עוברים (6 חדשים).

[x] ניהול משתמשים (users.py) — הוספת יכולות כתיבה: יצירת משתמש, עריכת פרטים, שינוי תפקיד והשבתה.
✅ בוצע ב-branch feature/users-write-api: נוספו POST /api/users (יצירה, בדיקת ייחודיות email) ו-PATCH /api/users/{id} (עדכון חלקי — משמש גם לעריכת פרטים, גם לשינוי role, וגם להשבתה דרך is_active=False), שניהם ADMIN בלבד. Users.is_active הוא שדה חדש (models.py, schema.sql, מיגרציית Alembic a1c4d8e2f6b0, ברירת מחדל True) — נאכף לא רק בהתחברות הבאה (routers/auth.py login/refresh) אלא גם על כל טוקן שכבר הונפק (dependencies/permissions.get_current_user בודק is_active בכל בקשה), כך שהשבתה נכנסת לתוקף מיידית. הגנה נוספת: אדמין לא יכול להשבית את עצמו (400). נוספו UserAdminOut/UserCreate/UserUpdate ו-UserRole (Literal) ב-schemas.py; GET /api/users הקיים נשאר פתוח ומינימלי (ל-UI pickers). עודכן docs/README.md (טבלת routers + §9, ההערה הישנה ש"אין ניהול משתמשים" תוקנה לשקף את המצב בפועל). טסטים ב-test_api_users_admin.py. 93/93 טסטים עוברים (10 חדשים).

[x] ניהול Role_Permissions — יצירת API לצפייה ולעריכה של הרשאות לפי תפקיד (החלפת ה-Seed הקבוע).
✅ בוצע ב-branch feature/role-permissions-api: נוסף ראוטר חדש backend/app/routers/role_permissions.py (רשום ב-main.py) — GET /api/role-permissions (פתוח, עם פילטר role אופציונלי), POST (יצירה, 400 אם הצירוף role+permission_key כבר קיים), PATCH /{id} (עריכת description בלבד — role/permission_key יחד מזהים את השורה, שינוי שלהם הוא בפועל מחיקה+יצירה ולא עריכה), DELETE /{id}, כולם ADMIN בלבד לכתיבה. **הערת היקף חשובה שתועדה בקוד:** ה-API מנהל את קטלוג ההרשאות (התיעוד של מה כל role אמור להיות מורשה) ומחליף את רשימת ה-Seed הקבועה כמקור לעריכה — אך **אינו** משנה את אכיפת ה-RBAC בפועל, שממשיכה להתבצע כמו קודם דרך require_roles() מקושח בכל router; חיווט אכיפה חיה שקוראת מהטבלה הזו הוא שינוי גדול משמעותית מ"צפייה ועריכה של הקטלוג" וחורג מהיקף המשימה. אגב כך תוקן פער אמיתי: UniqueConstraint(role, permission_key) שהיה קיים רק ב-schema.sql (UQ_RolePermissions_RoleKey) אך לא ממופה ב-models.py — נוסף ל-RolePermission כך שגם ה-DB הזמני של הטסטים (SQLite, נבנה מ-models.py) אוכף את הייחודיות. נוספו RolePermissionOut/Create/Update ו-UserRole (Literal, נוצר גם עבור users.py הקודם) ב-schemas.py, עודכן docs/README.md (טבלת routers + ספירה ל-20), וטסטים ב-test_api_role_permissions.py. 101/101 טסטים עוברים (8 חדשים).

[x] API פיננסי — הוספת אפשרות הזנה (POST) של דוחות כספיים רב-שנתיים למערכת ב-financials.py.
✅ בוצע ב-branch feature/financial-statements-post-api: נוספו GET /api/financials/statements (רשימת שורות Financial_Statements גולמיות, מהשנה החדשה לישנה) ו-POST /api/financials/statements (הזנת דוח לשנה נתונה — 400 אם כבר קיים דוח לאותה שנה, מגבלת UNIQUE על year). אותה קבוצת תפקידים כמו שאר financials.py (RISK_MANAGER/CFO/ADMIN). הדוח שנכנס דרך ה-POST מוזן מיד ל-services/financials.calculate_multi_year_trends / build_regulatory_report (נבדק בטסט ייעודי). נוספו FinancialStatementOut/Create ב-schemas.py, עודכן docs/README.md, וטסטים חדשים ב-test_api_financial_statements.py. 106/106 טסטים עוברים (5 חדשים).

[x] אוטומציית שטח (ERP & Alerts) — חיבור טריגר למשימת אחזקה ב-ERP ומשלוח התראות Push/SMS בעת הגשת אירוע בסטטוס CRITICAL.
✅ בוצע ב-branch feature/critical-incident-alerts: חלק ה-ERP (משימת מיטיגציה + כרטיס תחזוקה מדומה) כבר היה קיים מקודם (routers/incidents.py::_trigger_critical_incident_ticket). נוסף כעת החלק החסר — משלוח התראות: services/notifications.py קיבל build_critical_incident_alert (בונה alert יחיד מסוג "critical_incident") ו-dispatch_critical_incident_alert (מנתב+"שולח" אותו לנמענים הפעילים ב-Notification_Recipients, אותה לוגיקת ניתוב וסימולציה כמו dispatch_notifications — רפקטור משותף דרך _route_alerts/_send_and_log כדי לא לשכפל קוד). _trigger_critical_incident_ticket קורא לזה בסוף (רק אם settings.notifications_enabled, silent skip ולא 503 — זהו טריגר רקע ולא endpoint). כל התראה שנשלחה נרשמת גם ב-Notification_Log כרגיל (נראית ב-GET /api/notifications/log). alert_type "critical_incident" נוסף ל-3 מקומות Literal ב-schemas.py (AlertOut/NotificationOut/NotificationLogOut). תוקנה גם הפניה תלויה (dangling) בתיעוד services/notifications.py ל-"docs/README.md §8" שכבר לא קיים בפועל. עודכן docs/README.md (שורת incidents.py). טסטים חדשים ב-test_api_incidents.py (2 חדשים: שולח לנמענים על CRITICAL, לא שולח על לא-CRITICAL). 108/108 טסטים עוברים.

3. אבטחה, RBAC ותאימות (Security & Compliance)
[x] אכיפת RBAC על בקשות ה-GET — חסימת צפייה במידע פיננסי (KPIs, פוליסות) לתפקידים כמו FIELD_WORKER על ידי הוספת require_roles גם לקריאות קריאה.
✅ בוצע ב-branch feature/rbac-financial-get-endpoints: נוסף require_roles (חדש: _FINANCIAL_READ_ROLES / _POLICIES_READ_ROLES — כל תפקיד חוץ מ-FIELD_WORKER) לקריאות GET שמובילות בדמויות כספיות: analytics.py (/kpis, /cashflow, /exposure-by-region, /geographic-exposure-clusters, /loss-ratio-trend) ו-policies.py (כל ה-GETs: רשימה, לפי-id, /assets), וגם GET /api/incidents/{id}/eligible-policies (מחזיר PolicyOut, אותה הגנה). endpoints תפעוליים שלא מובילים בסכום כספי (map, risk-matrix, alerts, hazard-distribution) נשארו פתוחים במכוון — נבדק בטסט ייעודי. financials.py/compliance.py/integrations.py כבר היו מוגנים מקודם. עודכן טסט קיים ב-test_api_policies.py (הוספת headers, כי ה-endpoint כבר לא פתוח). claims.py לא נגע — נשאר פתוח במכוון, יש טסט קיים (test_list_claims_is_readable_without_auth) שמתעד זאת במפורש והיקף המשימה נקב רק ב-KPIs/פוליסות. עודכן דוקסטרינג המודול dependencies/permissions.py לשקף את החריגה החדשה, ו-docs/README.md (שורות policies.py/analytics.py). טסטים חדשים ב-test_api_permissions.py (2 חדשים). 110/110 טסטים עוברים.

[x] הצפנת שדות רגישים — הצפנת פרטי שמאי, סכומי כיסוי רגישים ומטא-דאטה מעבר למוצפן כיום (ב-encryption.py).
✅ בוצע ב-branch feature/encrypt-sensitive-fields: הורחבה services/encryption.py (EncryptedString הקיים + EncryptedText חדש ל-NVARCHAR(MAX)) והוחלו על ארבעה שדות חדשים: Claims.adjuster_name ("פרטי שמאי" — הורחב מ-Unicode(100) ל-EncryptedString(255)), Insurance_Policies.per_event_limit ו-Policy_Assets.specific_deductible ("סכומי כיסוי רגישים" — Numeric(18,2) → EncryptedString(64)), ו-Audit_Log.old_value/new_value ("מטא-דאטה" — תמונת המצב לפני/אחרי של גוף הבקשה, עלולה להכיל בעצמה שדות רגישים אחרים; UnicodeText → EncryptedText). היקף מכוון (מתועד בהרחבה ב-docstring של encryption.py): annual_premium/total_limit/deductible_default של Insurance_Policies **לא** הוצפנו — הם מסוכמים על פני שורות רבות בפייתון (kpi.py/financials.py) לצורך loss ratio/cashflow/תקציר מנהלים AI, אותה בעיית architectural כמו ה-Claim_Payments.amount/Claim_Reserves.reserve_amount שכבר תועדו כמחוץ להיקף. per_event_limit/specific_deductible לעומת זאת נקראים תמיד רשומה-בודדת (retention.py, routers/properties.py, routers/policies.py) ולכן בטוחים להצפנה בלי לשבור אגרגציה — כל אתרי הקריאה כבר עוטפים ב-float() כפי שנדרש כש-EncryptedString מחזיר str מפוענח. נוספה מיגרציית Alembic f1a9c7e4b2d3 (ALTER COLUMN ל-3 מהשדות; old_value/new_value נשארים NVARCHAR(MAX) כך שאין ALTER נדרש עבורם) ועודכן schema.sql בהתאם, כולל הערה שערכים ישנים (plaintext, כפי שנשמרו לפני המעבר או דרך seed.py שמכניס ישירות דרך pyodcb כמו reference_number הקיים) ממשיכים להיקרא תקין דרך ה-fallback הקיים ב-EncryptedString.process_result_value בלי מיגרציית backfill. עודכן docs/erd.md (סימון "מוצפן at-rest" על 5 השדות). נוספו טסטים חדשים ב-test_encryption.py (6 חדשים — round-trip הצפנה/פענוח, אימות שהערך הגולמי בעמודה אינו plaintext, ותאימות אחורה לערכים לא-מוצפנים קיימים). 116/116 טסטים עוברים.

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
