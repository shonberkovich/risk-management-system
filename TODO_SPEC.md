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

- [x] **טבלת תפקידים והרשאות**: הרחבת `User` בשדה `role` (RISK_OFFICER / PROPERTY_MANAGER / CFO / ADJUSTER / ADMIN) + טבלת `Role_Permissions`.
  📁 `backend/app/models.py` (Class `User`) + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/roles-permissions`: ה-CHECK constraint על `Users.role` הורחב לכלול גם `RISK_OFFICER` ו-`ADJUSTER` (בנוסף לערכים הקיימים `RISK_MANAGER`/`FIELD_WORKER` בהם משתמש `seed.py` הקיים, כדי לא לשבור נתוני הזרעה) — כך שכל חמשת התפקידים מהמפרט (`RISK_OFFICER`/`PROPERTY_MANAGER`/`CFO`/`ADJUSTER`/`ADMIN`) נתמכים. נוספה מחלקת `RolePermission` (models.py) + טבלת `Role_Permissions` ב-schema.sql (`role`, `permission_key`, `description`, UNIQUE על role+permission_key, אינדקס על role).

- [x] **טבלת מסמכים כללית (DMS)**: טבלה `Documents` המקשרת קבצים לכל ישות (policy / claim / property / incident) עם `s3_url`, `doc_type`, `uploaded_by`.
  📁 `backend/app/models.py` + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/documents-dms`: נוספה מחלקת `Document` (models.py) + טבלת `Documents` ב-schema.sql. המשויכות הפוליארפית לישויות (`policy`/`claim`/`property`/`incident`) מומשה בדפוס `entity_type` + `entity_id` (זהה לדפוס שכבר קיים ב-`Audit_Log`) עם CHECK על `entity_type` בארבעת הערכים, במקום ארבעה FK-ים נפרדים nullable — כדי לשמור על עקביות עם המוסכמה הקיימת בסכימה. נוספו `s3_url`, `doc_type`, `uploaded_by` (FK אופציונלי ל-Users), `uploaded_at`. אינדקסים על (entity_type, entity_id) ועל uploaded_by.

- [x] **טבלת אזורים גיאוגרפיים**: `Regions` (region_code, name) + שדה `region_id` ב-`Property`, לצורך דוח חשיפה לפי מרכז/צפון/דרום.
  📁 `backend/app/models.py` (Class `Property`) + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/regions-table`: נוספה מחלקת `Region` (models.py) + טבלת `Regions` ב-schema.sql (`region_code` UNIQUE, `name`), ממוקמת לפני `Users`/`Properties` ב-schema כי `Properties.region_id` מפנה אליה. נוסף שדה `region_id` ל-`Property` כ-FK אופציונלי (nullable) ל-`Regions`, **לצד** שדה `region` (מחרוזת חופשית) הקיים ולא במקומו — כדי לא לשבור קוד/seed קיימים שכבר משתמשים ב-`region`. נוסף אינדקס `IX_Properties_RegionId`.

- [x] **טבלת נתוני מאקרו פיננסיים**: `Financial_Statements` (year, total_assets, revenue, net_income, insurance_expense) לניתוח רב-שנתי.
  📁 `backend/app/models.py` + `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/financial-statements`: נוספה מחלקת `FinancialStatement` (models.py) + טבלת `Financial_Statements` ב-schema.sql — טבלה עצמאית (ללא FK-ים, לא תלויה בישויות אחרות ולא נתלים בה), עם `year` (SMALLINT) כ-UNIQUE כדי להבטיח רשומה אחת בלבד לשנה, מתאים לניתוח רב-שנתי לפי CFO/דוחות מאקרו.

- [x] **אינדקסים חסרים**: אינדקס מרחבי GIST על `Properties.coordinates`, אינדקס מורכב על `Incidents(status, hazard_type)` ועל `Claims(claim_status, payment_date)`.
  📁 `backend/sql/schema.sql`
  ✅ בוצע ב-branch `feature/missing-indexes`. בבדיקה מול הסכימה הקיימת התגלו שלושה פערים בין הניסוח למציאות, שתועדו ונפתרו בפועל:
  1. **אינדקס מרחבי GIST על coordinates** — GIST הוא מנוע אינדוקס של PostgreSQL; ב-SQL Server המקביל הוא `SPATIAL INDEX`, אבל הוא דורש עמודת `geometry`/`geography` ולא זוג `DECIMAL` נפרדים (`latitude`, `longitude`) כפי שקיים כאן. יצירת עמודת geography אמיתית היא שינוי מבנה נתונים מהותי שישפיע על שכבות נוספות (ORM, שירותי המפה) וחורג מהיקף המשימה. `IX_Properties_Coordinates` (אינדקס מורכב רגיל על lat+lng) כבר קיים וממלא בפועל את הצורך המעשי בשאילתות טווח גיאוגרפי — הושאר ללא שינוי, עם התיעוד הזה כהסבר לפער.
  2. **אינדקס מורכב על `Incidents(status, hazard_type)`** — כבר קיים בסכימה כ-`IX_Incidents_StatusHazard`. לא בוצע שינוי.
  3. **אינדקס מורכב על `Claims(claim_status, payment_date)`** — `payment_date` לא קיים בפועל בטבלת `Claims` אלא ב-`Claim_Payments`; ב-`Claims` יש `expected_payment_date`, ועליו כבר קיים `IX_Claims_StatusDate(claim_status, expected_payment_date)`. כפתרון מעשי נוסף אינדקס חדש `IX_ClaimPayments_ClaimDate` על `Claim_Payments(claim_id, payment_date)`, שתומך בדפוס השאילתה הריאלי — תשלומים בפועל לפי תאריך, לכל תביעה.

- [x] **הרחבת נתוני הזרעה (Seed)** לכל הטבלאות והשדות החדשים.
  📁 `backend/app/seed.py` + `backend/sql/seed.sql`
  ✅ בוצע ב-branch `feature/seed-data-expansion`: `seed.py` הורחב (לא `sql/seed.sql`, בהתאם לכלל ב-CLAUDE.md נגד טעינת עברית דרך `sqlcmd -i`) — נוספו שני משתמשים חדשים (`RISK_OFFICER`, `ADJUSTER`), הזרעת `Regions` (מרכז/צפון/דרום) עם קישור `Properties.region_id` בפועל, שדות הפוליסה החדשים (`per_event_limit`/`bi_waiting_period_hours`/`exclusions`) לכל ארבע הפוליסות, ושדות האירוע החדשים (`is_draft`/`business_interruption_requested`/`area_or_building`/`reported_coordinates`) לכל 25 האירועים הקיימים (קואורדינטות GPS מחושבות כ-offset קטן מנקודת הנכס) + שתי טיוטות אירוע חדשות (`INC-2026-010/011`, `is_draft=1`) להדגמת זרימת Draft→Submitted. נוספו גם נתוני הזרעה לטבלאות החדשות לגמרי: `Claim_Reserves` (6 רזרבות לתביעות עם יתרה פתוחה), `Audit_Log` (8 רשומות דוגמה), `Role_Permissions` (25 הרשאות פרוסות על פני 7 התפקידים), `Documents` (10 מסמכים לדוגמה על פני policy/claim/incident/property), ו-`Financial_Statements` (2022–2026). רשימות ה-`DELETE`/`DBCC CHECKIDENT` בראש `seed.py` עודכנו לכלול את כל הטבלאות החדשות בסדר תקין מבחינת FK. נבדק בפועל: `sqlcmd -i sql\schema.sql` ואז `python -m app.seed` רצים בהצלחה מקצה לקצה מול `RiskDB` מקומי, וכל הטבלאות מאוכלסות (נבדק בספירות שורות).

---

## שלב 2 — Backend Services (לוגיקה עסקית)

- [x] **מנוע רזרבות ותזרים מזומנים**: חישוב צפי תקבולים לפי סטטוס תביעה ותאריכי יעד, וסכימת רזרבות פתוחות.
  📁 קובץ חדש: `backend/app/services/cashflow.py`
  ✅ בוצע ב-branch `feature/cashflow-service`: נוצר `cashflow.py` בהתאם לדפוס הקיים ב-`kpi.py` (פונקציות טהורות שמקבלות `db: Session`, ללא קריאות LLM). `get_current_reserves` בוחר, לכל `claim_id`, את רשומת `Claim_Reserves` העדכנית ביותר (לפי `updated_at`) — כי רזרבה יכולה להתעדכן מספר פעמים לאותה תביעה, ורק הערך האחרון רלוונטי. `calculate_claim_outstanding_balance` מחשבת יתרה פתוחה לתביעה (`approved_amount` פחות סכום ה-`Claim_Payments` ששולמו בפועל, עם נפילה ל-`claimed_amount` לתביעות שטרם אושרו). `calculate_expected_receipts_by_month` מקבצת יתרות פתוחות של תביעות בסטטוס פתוח (`SUBMITTED`/`IN_ADJUSTMENT`/`APPROVED`) לפי `Claims.expected_payment_date` (חודש "YYYY-MM"). `calculate_reserves_by_month` מקבצת את הרזרבות הנוכחיות לפי `Claim_Reserves.expected_payment_date`, עם קיבוץ "unscheduled" לרזרבות ללא תאריך יעד. `get_cashflow_summary` מאחדת הכל לתצוגת דשבורד: סך רזרבות פתוחות, סך תקבולים צפויים, רזרבות ללא תאריך, ותחזית חודשית ממוזגת (`months_ahead` חודשים קדימה, ברירת מחדל 12). נבדק בפועל מול `RiskDB` המקומי (עם נתוני ה-seed המורחבים משלב קודם) — כל הפונקציות רצות ומחזירות ערכים תקינים (6 רזרבות נוכחיות, סה"כ רזרבות פתוחות ₪2,990,000), וייבוא `app.main` תקין.

- [x] **מנגנון אופטימיזציה של השתתפות עצמית (Retention Optimizer)**: השוואה בין ספיגת נזק עצמית לבין הגשת תביעה, כולל השפעה צפויה על הפרמיה.
  📁 קובץ חדש: `backend/app/services/retention.py`
  ✅ בוצע ב-branch `feature/retention-optimizer`: נוצר `retention.py` בהתאם לדפוס הקיים (פונקציות טהורות שמקבלות `db: Session`, ללא קריאות LLM). `get_effective_deductible` בוחרת את ההשתתפות העצמית האפקטיבית לנכס — `Policy_Assets.specific_deductible` אם הוגדר, אחרת `Insurance_Policies.deductible_default`. `get_active_policy_for_property` מאתרת את הפוליסה הפעילה (`status == "ACTIVE"`) המכסה נכס נתון דרך `Policy_Assets`. הליבה, `calculate_retention_recommendation`, משווה בין שני תרחישים על סכום נזק נתון: ספיגה עצמית מלאה (העלות = כל סכום הנזק, ללא השפעה על הפרמיה) מול הגשת תביעה (עלות = ההשתתפות העצמית ששולמת בפועל + תוספת פרמיה עתידית צפויה, לפי הנחה פשוטה ומתועדת של `PREMIUM_SURCHARGE_RATE = 15%` מכל שקל שהתקבל מהמבטח — בהתאם לכך שזהו כלי הדגמה לקורס ולא מנוע תמחור אקטוארי, ראו `docs/README.md` §8), עם התחשבות בתקרת `per_event_limit` אם קיימת. הפונקציה מחזירה פירוט מלא (השתתפות עצמית, סכום בר-החזר, עלות כל תרחיש, המלצה `ABSORB`/`CLAIM`, וסכום החיסכון הצפוי). `suggest_for_incident` היא עטיפה נוחה שמריצה את ההשוואה ישירות על אירוע לפי `initial_estimated_loss` והפוליסה הפעילה של נכסו. נבדק בפועל מול `RiskDB` המקומי: מתוך 27 אירועים, ל-27 נמצאה כיסוי פוליסה פעיל והופקה המלצה תקינה (כולל מקרי קצה — נזק מתחת להשתתפות העצמית → `ABSORB` ללא השפעת פרמיה, נזק גדול מעליה → `CLAIM` עם חיסכון משמעותי), וייבוא `app.main` תקין.

- [x] **סימולציית Monte Carlo וחישוב VaR**: הגרלת תרחישי נזק לפי הסתברות/חומרה ברמת הנכס, והפקת אחוזוני VaR ברמת התיק.
  📁 קובץ חדש: `backend/app/services/simulation.py`
  ✅ בוצע ב-branch `feature/monte-carlo-simulation`: נוצר `simulation.py` בהתאם לדפוס הקיים (פונקציות טהורות שמקבלות `db: Session`, ללא קריאות LLM, ללא תלויות חדשות — שימוש ב-`random`/`statistics` מהספרייה הסטנדרטית בלבד). `_get_property_exposures` שולפת לכל נכס פעיל בעל פרופיל סיכון (`Asset_Risk_Profiles`) הסתברות שנתית לאירוע נזק — נגזרת ליניארית מציון הסיכון המשוקלל הקיים (`kpi.calculate_property_risk_score`, סולם 0-100) כאשר נכס עם הציון המקסימלי (100) מקבל `MAX_ANNUAL_EVENT_PROBABILITY = 25%` הסתברות שנתית לאירוע — הנחה פשוטה ומתועדת, לא מודל אקטוארי אמיתי (ראו `docs/README.md` §8). כאשר מתרחש אירוע, החומרה נדגמת מהתפלגות משולשת (triangular) בין 0 ל-`mfl_amount` של הנכס עם שיא (`mode`) ב-30% מה-MFL (`SEVERITY_MODE_FRACTION`) — משקף שרוב האירועים הם נזק חלקי ולא נזק מלא. `run_portfolio_simulation` מריצה `iterations` שנים מדומות (ברירת מחדל 10,000), בכל שנה מדומה מטילה "מטבע משוקלל" לכל נכס ומסכמת את הנזקים לסך-שנתי, וממיינת את כלל התוצאות להפקת VaR באחוזוני הביטחון שב-`VAR_CONFIDENCE_LEVELS` (95%, 99%) — כלומר "הנזק שרק ב-(100%-C%) מהשנים הוא יחרוג ממנו" — בנוסף לנזק הצפוי הממוצע (`expected_annual_loss`) ותרחיש הגרוע ביותר שנדגם. `simulate_property` היא אותה סימולציה ברמת נכס בודד (עטיפה נוחה, מחזירה `None` אם לנכס אין פרופיל סיכון). פרמטר `seed` אופציונלי מאפשר הרצה דטרמיניסטית לבדיקות. נבדק בפועל מול `RiskDB` המקומי: סימולציית תיק על 15 הנכסים הפעילים בעלי פרופיל סיכון עם 10,000 איטרציות (`seed=42`) הניבה נזק שנתי צפוי ₪11.56M, VaR95 ₪30.31M, VaR99 ₪41.07M ותרחיש גרוע ביותר ₪71.76M — סדרי גודל הגיוניים ביחס ל-MFL/TIV הקיימים; סימולציית נכס בודד (property_id=1, MFL ₪18M) הניבה הסתברות אירוע שנתית 12.4%, נזק צפוי ₪910K ו-VaR95 ₪8.12M; נכס לא קיים החזיר `None` כמצופה; וייבוא `app.main` תקין.

- [x] **חשיפה מרחבית מצטברת (Limits Exposure)**: הרחבת חישוב האשכולות הקיים להחזרת רדיוס, מרכז אשכול וסך TIV מצטבר לכל אשכול.
  📁 `backend/app/services/kpi.py` (הרחבת `_geographic_clusters`)
  ✅ בוצע ב-branch `feature/geographic-exposure-clusters`: נוספה `calculate_geographic_exposure_clusters(db)` ב-`kpi.py`, פונקציה חדשה שמעשירה את `_geographic_clusters` הקיימת (שנשארה ללא שינוי, כדי לא לשבור את `calculate_mfl`/`calculate_alerts` שתלויות בחתימה שלה) בפרטים גיאומטריים: מרכז אשכול (`center_lat`/`center_lon` — ממוצע הקואורדינטות של חברי האשכול), רדיוס בפועל (`radius_km` — המרחק המקסימלי בין המרכז לחבר הרחוק ביותר, לא לבלבל עם `CLUSTER_RADIUS_KM` הקבוע שמשמש רק לקביעת השייכות לאשכול), וסך TIV מצטבר (`cluster_tiv_total`, סכימת `replacement_value` של חברי האשכול) לצד סך ה-MFL המצטבר הקיים (`cluster_mfl_total`). מוחזרים גם `property_ids`, `property_names` ו-`property_count` לכל אשכול, ממוינים בסדר יורד לפי `cluster_mfl_total` (התאמה לסדר העדיפויות הקיים ב-`calculate_mfl`/`calculate_alerts`). נבדק בפועל מול `RiskDB` המקומי: 12 אשכולות הופקו מתוך הנכסים הפעילים בעלי פרופיל סיכון, כולל אשכולות רב-נכסיים (למשל אשכול של 2 נכסים עם `cluster_mfl_total` ₪50M ו-`cluster_tiv_total` ₪149M, רדיוס 2.66 ק"מ) ואשכולות של נכס בודד (רדיוס 0 ק"מ כצפוי); `calculate_mfl` הקיימת המשיכה להחזיר את אותה תוצאה (₪50M) ללא שינוי התנהגות; וייבוא `app.main` תקין.

- [x] **חשיפה לפי אזור גיאוגרפי**: פונקציה המחזירה TIV, MFL וסך נזקים לכל `region`.
  📁 `backend/app/services/kpi.py`
  ✅ בוצע ב-branch `feature/exposure-by-region`: נוספה `calculate_exposure_by_region(db)` ב-`kpi.py`, המקבצת חשיפה לפי `Regions.region_id` (טבלת האזורים המובנית, להבדיל מהשדה החופשי הישן `Properties.region`) — להבדיל מהקיבוץ הגיאוגרפי-פיזי הקיים ב-`calculate_geographic_exposure_clusters`, שמקבץ לפי קרבה בפועל (ק"מ) ולא לפי גבולות מנהליים, כך ששני הנכסים עשויים להיות בשני אזורים שונים אך עדיין להצטרף לאותו אשכול פיזי. לכל אזור מוחזרים: `tiv` (סכום `replacement_value` לנכסים פעילים באזור), `mfl` (סכימה פשוטה — לא מקובצת/מקסימלית כמו ב-`calculate_mfl` — של `Asset_Risk_Profiles.mfl_amount` לנכסים פעילים באזור, משקפת קיבולת נזק כוללת ולא ריכוז חד-אירועי) ו-`total_claimed` (סכום `Claims.claimed_amount` לתביעות על אירועים בנכסי האזור, ללא סינון לפי סטטוס, בהתאם לשימוש הקיים ב-`claimed_amount` ב-`calculate_open_claims`). נכסים ללא `region_id` מקובצים תחת רשומה מלאכותית "לא משויך". התוצאה ממוינת בסדר יורד לפי `tiv`. נבדק בפועל מול `RiskDB` המקומי: 3 אזורים הופקו, לדוגמה אזור מוביל עם TIV ₪516M, MFL ₪159M ותביעות ₪2.8M; `calculate_mfl` הקיימת המשיכה להחזיר ₪50M ללא שינוי; וייבוא `app.main` תקין.

- [x] **חשיפת חישוב ROI למניעת סיכון כשירות מלא**: הפיכת `calculate_mitigation_roi` לשירות המחזיר עלות מול חיסכון צפוי בפרמיה ובנזקים.
  📁 `backend/app/services/kpi.py`
  ✅ בוצע ב-branch `feature/mitigation-roi-service`: הפונקציה המקורית `calculate_mitigation_roi(task)` נשארה ללא שינוי (עדיין בשימוש ב-`routers/mitigation.py`), ונוספו לצידה שתי פונקציות חדשות. `calculate_mitigation_roi_breakdown(db, task_id)` מפרקת את `Mitigation_Tasks.expected_annual_savings` (עמודה יחידה בסכמה) לחיסכון צפוי בפרמיה מול חיסכון צפוי בנזקים — מאחר שאין עמודות נפרדות לכך במודל, הפירוק מבוסס על הנחה קבועה ומתועדת (בדומה לדפוס `retention.PREMIUM_SURCHARGE_RATE`): נכס עם פוליסת ביטוח פעילה (נבדק דרך `retention.get_active_policy_for_property`, ייבוא מקומי כדי למנוע מעגליות טעינה) מקבל `MITIGATION_PREMIUM_SAVINGS_SHARE = 40%` מהחיסכון כזיכוי פרמיה צפוי והשאר כהפחתת נזקים צפויה; נכס ללא פוליסה פעילה מקבל את מלוא החיסכון כהפחתת נזקים (אין פרמיה לזכות). הפונקציה מחזירה גם `cost_estimate`, `roi_percent` (זהה לפלט `calculate_mitigation_roi` המקורית) ו-`payback_years` (עלות חלקי חיסכון שנתי כולל), ומחזירה `None` עבור `task_id` לא קיים. `calculate_mitigation_roi_summary(db)` מריצה את הפירוק על כל משימות המיטיגציה במסד, ממוינת בסדר יורד לפי `roi_percent` (משימות ללא `cost_estimate`, ולכן ללא ROI, ממוינות אחרונות). נבדק בפועל מול `RiskDB` המקומי: 12 משימות מיטיגציה הופקו עם פירוק תקין (לדוגמה משימה מובילה בROI 141.2% עם עלות ₪85,000 וחיסכון כולל ₪120,000, מפוצל ל-₪48,000 פרמיה/₪72,000 נזקים, החזר השקעה תוך 0.71 שנים); הושוו כל 12 ערכי `roi_percent` מול `calculate_mitigation_roi` המקורית — 0 אי-התאמות; `task_id` לא קיים החזיר `None` כמצופה; וייבוא `app.main` תקין.

- [x] **מנוע התראות והתראות חוצה-ערוצים**: הרחבת מנגנון ההתראות לשליחת Email/SMS/Push למנהל הסיכונים ול-CFO באירוע קריטי, כולל ספי התראה ניתנים להגדרה.
  📁 `backend/app/services/kpi.py` (`calculate_alerts`) + קובץ חדש `backend/app/services/notifications.py`
  ✅ בוצע ב-branch `feature/alert-notifications-engine`: `calculate_alerts` ב-`kpi.py` הורחבה עם שני פרמטרים אופציונליים, `geo_exposure_threshold_ratio` ו-`incident_concentration_threshold` (ברירת המחדל `None` נופלת לקבועי המודול הקיימים `GEO_EXPOSURE_THRESHOLD_RATIO`/`INCIDENT_CONCENTRATION_THRESHOLD`, כך שקריאות קיימות ללא ארגומנטים ממשיכות להתנהג זהה) — כך שספי ההתראה הפכו ניתנים להגדרה per-call ולא רק קבועים קשיחים. נוצר קובץ חדש `notifications.py` עם מנוע ניתוב חוצה-ערוצים: `Recipient` (dataclass) מגדיר יעד עם תפקיד, פרטי קשר, ערוצים נתמכים (`EMAIL`/`SMS`/`PUSH`) וסף חומרה מינימלי (`min_severity`) — מאחר שאין טבלת משתמשים/אנשי קשר בסכמה (ראו `docs/README.md` §8, ניהול משתמשים/RBAC מחוץ לתחום), הרשימה `DEFAULT_RECIPIENTS` היא תצורה קבועה ומתועדת (בדומה לדפוס `retention.PREMIUM_SURCHARGE_RATE`): מנהל הסיכונים מנוי על כל החומרות (`warning` ומעלה) בערוצי EMAIL+PUSH, ואילו ה-CFO מנוי רק על אירועים קריטיים (`min_severity="critical"`) בערוצי EMAIL+SMS. `build_notifications(db)` מריצה את `calculate_alerts` (עם אפשרות להעברת הספים המותאמים) ומפזרת כל התראה לכל נמען רלוונטי על כל ערוץ נתמך שלו, ומחזירה רשומת התראה מנותבת אחת לכל צירוף (התראה, נמען, ערוץ). שליחה בפועל של Email/SMS/Push היא מחוץ לתחום המוצהר (`docs/README.md` §8 — "התראות Push/SMS אוטומטיות" — אין ספק חיצוני מוגדר/מפתחות ב-`.env`), ולכן `dispatch_notifications(db)` מדמה שליחה: רושמת כל התראה ל-log (רמת WARNING לחומרה קריטית, INFO ל-warning) ומסמנת `status="simulated"` — משקפת את דפוס ה"התדרדרות חינה" הקיים ב-`routers/ai.py` כשאין `ANTHROPIC_API_KEY`, אך כאן מדובר בהיקף מכוון של הדגמת קורס ולא בתלות בהגדרה חסרה. נבדק בפועל מול `RiskDB` המקומי: עם הספים המקוריים הופקו 2 התראות (שתיהן `warning`, ריכוז אירועים) ו-4 רשומות ניתוב (רק למנהל הסיכונים, כיוון שה-CFO מסונן החוצה בחומרת warning) — כולן `dispatch` בהצלחה עם `status="simulated"`; עם `incident_concentration_threshold=1` הופקו 28 רשומות (בדיקת קונפיגורביליות); עם `geo_exposure_threshold_ratio=0.001` (מאולץ לחומרה קריטית) הופקו 16 רשומות בסך הכל, מתוכן 12 קריטיות ו-6 מנותבות ל-CFO (EMAIL+SMS בלבד, כמצופה) — מאמת את סינון ה-`min_severity` ואת ניתוב הערוצים; וייבוא `app.main` תקין.

- [x] **שירות ניתוח דוחות כספיים רב-שנתי**: חישוב מגמות ויחסים (עלות ביטוח מול הכנסות, נזקים מול שווי נכסים) לאורך שנים.
  📁 קובץ חדש: `backend/app/services/financials.py`
  ✅ בוצע ב-branch `feature/financial-analysis-service`: נוצר קובץ חדש `financials.py` המחבר בין `Financial_Statements` (שורה אחת לשנה: הכנסות, רווח נקי, סך נכסים, הוצאות ביטוח) לבין נתוני התביעות/פוליסות ברמת עסקה. מאחר ש-`Claim_Payments` ו-`Insurance_Policies` אינם מתויגים בשנת כספים ישירות, שני פונקציות עזר גוזרות סכומים שנתיים בפייתון (בדומה לדפוס הקיים ב-`kpi.calculate_...` עם `ts.year`): `_annual_claim_losses` מסכמת `Claim_Payments.amount` לפי שנת `payment_date` (תשלום בפועל, לא נתבע/אושר — עקבי עם הגישה התזרימית ב-`cashflow.py`), ו-`_annual_premiums` מסכמת `annual_premium` לכל פוליסה שטווח [`start_date`,`end_date`] שלה חופף לאותה שנה (ללא proration יומי — הנחה קבועה ומתועדת, בדומה ל-`retention.PREMIUM_SURCHARGE_RATE`). `calculate_multi_year_trends(db)` מחזירה רשימה (שורה לשנה, לפי סדר עולה) עם היחסים: `insurance_expense_to_revenue`, `net_income_margin`, `losses_to_asset_value` (נזקים ששולמו באותה שנה חלקי סך הנכסים — פרוקסי מאקרו ל"כמה מהרכוש אבד"), `loss_ratio` (נזקים ששולמו חלקי פרמיה ששולמה), וכן `revenue_growth_pct`/`losses_growth_pct` שנה-על-שנה (עם הגנה מפני חלוקה באפס/ב-`None` בשנה הראשונה). `calculate_trend_summary(db)` מוסיפה תמונת-על רב-שנתית: CAGR של הכנסות ושל נזקים, ממוצע היחסים, ודגל בוליאני `cost_of_risk_outpacing_revenue` שמשווה CAGR של הוצאות ביטוח מול CAGR של הכנסות — מחזירה `None` אם קיימת פחות משנת דוח אחת להשוואה. נבדק בפועל מול `RiskDB` המקומי: 5 שנות דוחות (2022–2026), כאשר רק 2026 (השנה הפעילה בנתוני ה-seed) כוללת תביעות/פוליסות בפועל — `claim_losses_paid=1,175,000`, `premium_paid=3,560,000`, `loss_ratio≈0.33`, `losses_to_asset_value≈0.0014`; שאר השנים הציגו נכון `0`/`null` ללא שגיאות חלוקה באפס. סיכום המגמות: `revenue_cagr_pct≈9.14`, `avg_insurance_expense_to_revenue≈0.0114`, `cost_of_risk_outpacing_revenue=true` (הוצאות הביטוח גדלות מהר יותר מההכנסות). ייבוא `app.main` תקין.

- [x] **שירות אחסון קבצים (S3/Blob)**: העלאה, יצירת Signed URL, וקריאת מטא-דאטה EXIF/GPS מתמונות.
  📁 קובץ חדש: `backend/app/services/storage.py`
  ✅ בוצע ב-branch `feature/file-storage-service`: נוצר קובץ חדש `storage.py`. מאחר שאין חשבון S3/Blob אמיתי ואין credentials ב-`backend/.env` (ראו `docs/README.md` §8 — שמירת קבצים בפועל למדיה של אירועים מחוץ לתחום), השירות מדמה בענן: `upload_file(file_bytes, filename, entity_type, entity_id)` שומר את הקובץ לתיקייה מקומית `backend/media_storage/` (חדשה, נוספה ל-`.gitignore` באותו יחס כמו `backend/.env`) תחת מסלול `<entity_type>s/<entity_id>/<filename>` ומחזיר `UploadResult` עם `storage_key`, `url` (בפורמט `https://storage.rmis-demo.local/...` — עקבי עם ה-domain הפיקטיבי שכבר קיים בנתוני ה-seed תחת `Documents.s3_url`, ראו `seed.py`), `size_bytes` ו-`content_type` (לפי סיומת קובץ). `generate_signed_url(storage_key, expires_in_seconds)` "חותם" URL מקומית — מחשבת טוקן `sha256` מ-(`storage_key`, `expires_at`, סוד קבוע מקומי `_SIGNING_SECRET`) ומצרפת כ-query params, במקום קריאה אמיתית לספק ענן; `is_signed_url_valid(...)` מאמתת טוקן+תפוגה בצד השרת (עבור endpoint הורדה עתידי). `extract_image_metadata(file_bytes)` קוראת EXIF דרך Pillow (נוסף ל-`requirements.txt`): `DateTimeOriginal` מתת-ה-IFD "Exif" (0x8769, לא ה-IFD הראשי) ו-`GPSInfo` מתת-ה-IFD המתאימה (0x8825), עם המרת קואורדינטות DMS→decimal degrees וטיפול בהמיספרות (`GPSLatitudeRef`/`GPSLongitudeRef`); מחזירה `None` (לא זורקת חריגה) עבור קבצים שאינם תמונה קריאה (וידאו/PDF) או תמונה ללא EXIF כלל — עקבי עם דפוס ה-`None`-על-חוסר-נתונים הקיים ב-`simulation.simulate_property`. `delete_file(storage_key)` מוחקת ומחזירה `False` (לא שגיאה) אם הקובץ כבר לא קיים. נבדק בפועל: נבנתה תמונת JPEG לבדיקה עם `piexif` (תלות זמנית להרצת הבדיקה בלבד, הוסרה בסיום) הכוללת `DateTimeOriginal` וקואורדינטות GPS (32.083333, 34.783333 — תל אביב בקירוב); `upload_file` שמרה את הקובץ בפועל לדיסק (גודל תואם), `generate_signed_url`/`is_signed_url_valid` אימתו טוקן תקין/פג-תוקף/מזויף כצפוי (True/False/False), `extract_image_metadata` חילצה נכון תאריך וקואורדינטות, החזירה `None` לתמונת PNG ללא EXIF ול-bytes שאינם תמונה כלל, ו-`delete_file` מחקה בהצלחה והחזירה `False` בניסיון שני. וייבוא `app.main` תקין.

---

## שלב 3 — Backend API (Routers)

- [x] **Endpoints להעלאת מדיה לאירוע**: העלאת תמונות/וידאו/PDF, שליפת רשימת מדיה, מחיקה — כולל שמירת קואורדינטות EXIF.
  📁 קובץ חדש: `backend/app/routers/media.py` + סכמות ב-`backend/app/schemas.py`
  ✅ בוצע ב-branch `feature/media-upload-endpoints`: נוצר קובץ חדש `media.py` שהוא שכבת ה-HTTP מעל השירות `services/storage.py` שנבנה במשימה הקודמת. הוספתי עמודות חדשות `gps_latitude`/`gps_longitude` (FLOAT, NULL) לטבלת `Incident_Media` (ב-`sql/schema.sql`, `models.py` וב-`docs/erd.md`) — הטבלה הקיימת לא כללה שדות לשמירת קואורדינטות EXIF, כנדרש במשימה. חמישה endpoints: (1) `POST /api/incidents/{incident_id}/media` — מקבל `UploadFile` (multipart), קורא ל-`storage.upload_file` לשמירה בפועל, ואם מדובר בתמונה עם EXIF קורא גם ל-`storage.extract_image_metadata`: `DateTimeOriginal` (מפורמט EXIF `YYYY:MM:DD HH:MM:SS`) הופך ל-`captured_at` של הרשומה (עם נפילה חזרה ל"עכשיו" כשאין EXIF), וקואורדינטות ה-GPS (אם קיימות) נשמרות בעמודות החדשות; מגביל גודל קובץ ל-25MB ומוודא שהאירוע קיים (404 אחרת). (2) `GET /api/incidents/{incident_id}/media` — רשימת מדיה לאירוע, מסודרת לפי `captured_at` יורד. (3) `DELETE /api/media/{media_id}` — מוחקת גם את הקובץ בפועל (`storage.delete_file`, לא נכשלת אם כבר נמחק) וגם את הרשומה ב-DB. (4) `GET /api/media/{media_id}/signed-url` — קוראת ל-`storage.generate_signed_url` ומחזירה בנוסף `download_url` אמיתי וניתן-לשליפה כלפי ה-API של עצמנו (`/api/media/download?key=...&expires=...&token=...`), כדי לסגור פער שהתגלה בבדיקה: ה-`url` המקורי שמחזיר `storage.py` מצביע ל-domain הפיקטיבי `storage.rmis-demo.local` (עקבי עם `Documents.s3_url`) שאינו נגיש בפועל — לכן עדכנתי גם את `generate_signed_url` ב-`storage.py` להחזיר `token` בנפרד, כדי לאפשר בניית URL הורדה אמיתי. (5) `GET /api/media/download` — ה-endpoint שה-docstring של `is_signed_url_valid` כבר צפה שיבוא: מאמת טוקן+תפוגה דרך `storage.is_signed_url_valid` ומחזירה את בייטס הקובץ בפועל (`Response` עם `content_type` לפי סיומת) רק אם תקין, אחרת `403`. נבדק בפועל מול `RiskDB` מקומי (לאחר הרצת `schema.sql` מחדש + `seed.py`, כנדרש בעקבות שינוי הסכמה — ראו גם ההערה ב-`CLAUDE.md` לגבי `DBCC CHECKIDENT`): העלאת JPEG עם EXIF (`DateTimeOriginal` + קואורדינטות GPS ליד תל אביב, נבנה עם `piexif` כתלות זמנית בלבד להרצת הבדיקה) — נשמרו נכון גם התאריך וגם הקואורדינטות; רשימת מדיה החזירה את הפריט; `signed-url` החזיר `download_url` תקין; הורדה דרכו החזירה `200` עם התוכן והגודל הנכונים ו-`content-type: image/jpeg`; טוקן מזויף ו-URL שפג תוקפו החזירו `403` כצפוי; העלאת PDF ללא EXIF שמרה `captured_at`="עכשיו" ו-`gps=None` כצפוי; העלאה לאירוע לא קיים החזירה `404`; מחיקה החזירה `204` והסירה את הפריט מהרשימה; מחיקה של רשומה לא קיימת החזירה `404`. לאחר הבדיקות אופסה בסיס הנתונים בחזרה למצב seed נקי (`schema.sql` + `seed.py`), הוסרה תלות הבדיקה הזמנית `piexif`, ותיקיית `backend/media_storage/` נוקתה. ייבוא `app.main` תקין.

- [x] **השלמת CRUD למשימות מיטיגציה**: יצירה, עדכון, שיוך מבצע, סגירה, וחישוב סטטוס `OVERDUE` אוטומטי + endpoint ל-ROI.
  📁 `backend/app/routers/mitigation.py`
  ✅ בוצע ב-branch `feature/mitigation-task-crud`: הרחבתי את `mitigation.py` (שקודם הכיל רק `list_tasks`) לחמישה endpoints: (1) `GET /api/mitigation-tasks` — רשימה (קיים, ללא שינוי בחתימה). (2) `GET /api/mitigation-tasks/{task_id}` — משימה בודדת, `404` אם לא קיימת. (3) `POST /api/mitigation-tasks` — יצירה עם `MitigationTaskCreate` חדש (`schemas.py`): מוודא שהנכס קיים (`404` אחרת) ושמשתמש `assigned_to_user_id` (אם צוין) קיים; סטטוס ראשוני `OPEN`. (4) `PATCH /api/mitigation-tasks/{task_id}` — עדכון חלקי (`MitigationTaskUpdate`, `exclude_unset`) לכל השדות כולל שיוך/שינוי מבצע (`assigned_to_user_id`, מוודא קיום המשתמש) וסגירה (`status="COMPLETED"`). (5) `GET /api/mitigation-tasks/{task_id}/roi` — מפעיל את `kpi.calculate_mitigation_roi_breakdown` הקיים (היה בנוי בעבר אך לא היה חשוף ב-router כלשהו) ומחזיר פירוט מלא (`MitigationRoiBreakdown` חדש): עלות, סה"כ חיסכון, פיצול הנחת פרמיה/הפחתת נזק צפוי, ROI%, תקופת החזר. חישוב `OVERDUE` אוטומטי: פונקציית עזר `_sync_overdue` (בקובץ ה-router) רצה בכל קריאת GET/POST/PATCH — משימה שתאריך היעד שלה עבר וסטטוסה אינו `COMPLETED` הופכת אוטומטית ל-`OVERDUE` (גם אם הבקשה עצמה ניסתה להעביר אותה ל-`IN_PROGRESS` — היותה "בתהליך" לא מבטלת את היותה באיחור); ואם תאריך היעד הוזז לעתיד (או שהמשימה סומנה `COMPLETED`), משימה שהייתה `OVERDUE` חוזרת אוטומטית ל-`OPEN`. גם הוספתי `assigned_to_user_id` ל-`MitigationTaskOut` (הושמט קודם). נבדק בפועל מול `RiskDB` מקומי דרך שרת ה-preview: יצירת משימה עם תאריך יעד בעבר → `OVERDUE` אוטומטית; יצירה עם תאריך עתידי + שיוך מבצע → `OPEN` עם `assigned_to_user_id` נכון; יצירה עם נכס לא קיים / משתמש לא קיים → `404`; שיוך מבצע חדש ל-`PATCH` → מעודכן; ניסיון `PATCH status=IN_PROGRESS` על משימה באיחור → נשארה `OVERDUE` כמצופה; `PATCH status=COMPLETED` (סגירה) → נשמר; הזזת `due_date` של משימה עתידית לתאריך עבר → הפכה אוטומטית ל-`OVERDUE`; `GET .../roi` החזיר פירוט מלא ונכון (כולל `payback_years`), ו-`404` למשימה לא קיימת; `GET`/`PATCH` על משימה לא קיימת → `404`. שימו לב: נתוני ה-seed הקיימים (`seed.py`) כללו כמה משימות עם סטטוס `OVERDUE` קשיח שתאריך היעד שלהן (למשל `2026-08-25`, `2026-09-05`) הוא בעתיד ביחס לתאריך הנוכחי (2026-08-19) — אלה מתוקנות אוטומטית ל-`OPEN`/`IN_PROGRESS`/`COMPLETED` הלוגי בכל קריאת `GET`/`PATCH` הודות ל-`_sync_overdue`, כצפוי מהתנהגות "חישוב אוטומטי". לאחר הבדיקות אופסה בסיס הנתונים בחזרה למצב seed נקי (`schema.sql` + `seed.py`). ייבוא `app.main` תקין.

- [x] **Endpoints לרזרבות וצפי תזרים**: שליפת תחזית תקבולים חודשית ורזרבות פתוחות עבור הדשבורד.
  📁 `backend/app/routers/analytics.py` או קובץ חדש `backend/app/routers/cashflow.py`
  ✅ בוצע ב-branch `feature/cashflow-reserves-endpoint`: התברר שכל שכבת השירות כבר הייתה בנויה מראש ולא הייתה חשופה דרך endpoint כלשהו — `services/cashflow.py` כלל `get_cashflow_summary` מלא (סה"כ רזרבות פתוחות מ-`Claim_Reserves` לפי הרשומה העדכנית ביותר לכל תביעה, סה"כ תקבולים צפויים לפי `Claims.expected_payment_date` והיתרה שטרם שולמה [`approved_amount` פחות תשלומים שכבר בוצעו, עם נפילה חזרה ל-`claimed_amount` לתביעות שטרם אושרו], ותצוגה חודשית ממוזגת מ-`months_ahead` חודשים קדימה). הוספתי endpoint אחד חדש: `GET /api/analytics/cashflow?months_ahead=12` (פרמטר אופציונלי, ברירת מחדל 12), שקורא ישירות ל-`cashflow.get_cashflow_summary`. הוספתי שתי סכמות תשובה חדשות ל-`schemas.py`: `CashflowMonthPoint` (`month`, `expected_receipts`, `open_reserves`) ו-`CashflowSummary` (`total_open_reserves`, `total_expected_receipts`, `unscheduled_reserves`, `monthly: list[CashflowMonthPoint]`). נבדק בפועל מול `RiskDB` מקומי דרך שרת ה-preview (ללא שינוי סכמת DB, לכן ללא צורך לאפס נתונים): `GET /api/analytics/cashflow` החזיר `200` עם `total_open_reserves=2990000.0`, `total_expected_receipts=450000.0`, `unscheduled_reserves=1590000.0` ותצוגה חודשית תקינה (`2026-09`, `2026-10`); `GET /api/analytics/cashflow?months_ahead=3` החזיר את אותם סה"כים גלובליים (כצפוי — הפרמטר משפיע רק על החלון החודשי הממוזג, לא על הסכומים הכוללים) עם אותה תצוגה חודשית (שני החודשים הרלוונטיים נופלים גם בתוך חלון של 3 חודשים). `/docs` (Swagger UI) נטען בהצלחה ומציג את ה-endpoint החדש, מה שמאשר שהוא נרשם כראוי באפליקציה. ייבוא `app.main` תקין.

- [x] **Endpoint לחשיפה לפי אזורים**: החזרת טבלת TIV/MFL/נזקים לכל אזור עבור דוח ההנהלה.
  📁 `backend/app/routers/analytics.py`
  ✅ בוצע ב-branch `feature/exposure-by-region-endpoint`: כמו במשימה הקודמת, שכבת השירות כבר הייתה בנויה במלואה — `kpi.calculate_exposure_by_region` (TIV = סכום `replacement_value` לנכסים פעילים באזור; MFL = סכום פשוט של `Asset_Risk_Profiles.mfl_amount` לנכסים באזור, לא מקסימום אשכולי כמו `calculate_mfl`; `total_claimed` = סכום `Claims.claimed_amount` לכל התביעות על אירועים בנכסי האזור, ללא סינון לפי סטטוס; נכסים ללא `region_id` מקובצים תחת "לא משויך"; ממוין יורד לפי TIV) — רק לא הייתה חשופה דרך endpoint. הוספתי `GET /api/analytics/exposure-by-region` שקורא ישירות ל-`kpi.calculate_exposure_by_region`, וסכמת תשובה חדשה `RegionExposure` (`region_id`, `region_name`, `tiv`, `mfl`, `total_claimed`) ב-`schemas.py`. נבדק בפועל מול `RiskDB` מקומי דרך שרת ה-preview: `GET /api/analytics/exposure-by-region` החזיר `200` עם שלושה אזורים (מרכז/צפון/דרום) ממוינים נכון יורד לפי TIV (516M/136M/79M), עם ערכי MFL ו-`total_claimed` תואמים לנתוני ה-seed. ייבוא `app.main` תקין.

- [x] **Endpoint לאשכולות חשיפה מרחבית**: החזרת אשכולות גיאוגרפיים לציור על המפה.
  📁 `backend/app/routers/analytics.py`
  ✅ בוצע ב-branch `feature/geographic-exposure-clusters-endpoint`: כמו בשתי המשימות הקודמות, שכבת השירות כבר הייתה בנויה במלואה — `kpi.calculate_geographic_exposure_clusters` (מבוססת על `_geographic_clusters` הקיימת: אשכולות חופפים של נכסים במרחק `CLUSTER_RADIUS_KM=10` ק"מ זה מזה, לפי מרחק Haversine; לכל אשכול מחושבים המרכז הגיאוגרפי (ממוצע lat/lon של החברים), הרדיוס בפועל (המרחק המקסימלי מהמרכז לחבר כלשהו — לא סף ה-10 ק"מ ששימש ליצירת האשכול), וסך MFL ו-TIV מצטברים; ממוין יורד לפי `cluster_mfl_total` בדומה ל-`calculate_mfl`/`calculate_alerts`) — רק לא הייתה חשופה דרך endpoint. הוספתי `GET /api/analytics/geographic-exposure-clusters` שקורא ישירות ל-`kpi.calculate_geographic_exposure_clusters`, וסכמת תשובה חדשה `GeographicExposureCluster` (`property_ids`, `property_names`, `property_count`, `center_lat`, `center_lon`, `radius_km`, `cluster_mfl_total`, `cluster_tiv_total`) ב-`schemas.py`. נבדק בפועל מול `RiskDB` מקומי דרך שרת ה-preview: `GET /api/analytics/geographic-exposure-clusters` החזיר `200` עם 12 אשכולות — שלושה אשכולות זוגיים (קניון רעננה+מגדל היי-טק הרצליה עם `cluster_mfl_total=50000000.0`, מגדל משרדים ת"א+מרכז לוגיסטי ראשל"צ עם `40000000.0`, מרכז מסחרי נשר+מתחם משרדים חיפה עם `32000000.0`) ותשעה אשכולות בני נכס בודד עם `radius_km=0.0` כצפוי, כולם ממוינים נכון יורד לפי `cluster_mfl_total` (50M→40M→32M→21M→19M→18M→16M→11M→10M→9M→8M→7M). ייבוא `app.main` תקין.

- [x] **Endpoints לסימולציה ו-VaR**: הרצת סימולציה עם פרמטרים (מספר איטרציות, אופק זמן) והחזרת התפלגות תוצאות.
  📁 קובץ חדש: `backend/app/routers/simulation.py`
  ✅ בוצע ב-branch `feature/simulation-var-endpoints`: `services/simulation.py` כבר כלל את מנוע הסימולציה המלא (`run_portfolio_simulation`/`simulate_property`) אך ללא פרמטר "אופק זמן" וללא החזרת התפלגות תוצאות מלאה (רק סטטיסטיקות מסכמות) — בהתאם לדפוש שהתגלה בשלוש המשימות הקודמות, אך הפעם נדרשה גם הרחבה קטנה של שכבת השירות, לא רק חשיפה. הוספתי לשתי הפונקציות פרמטר `horizon_years` (ברירת מחדל 1, שומר על ההתנהגות המקורית): כל איטרציה כעת מדמה `horizon_years` שנים בלתי-תלויות (אותו מודל הסתברות/חומרה שנתי בכל שנה, ללא מגמת שנה-על-שנה — עקבי עם ההנחות המתועדות הקיימות במודול) ומסכמת אותן לנזק מצטבר אחד לאופק; אומת ש-`horizon_years=3` הניב `expected_annual_loss` פי ~3 מ-`horizon_years=1` עם אותו `seed`, כצפוי ממודל ליניארי-בממוצע. הוספתי גם `_build_histogram(sorted_values, bucket_count)` — פונקציית עזר חדשה שמחלקת את התפלגות הנזקים המדומה ל-`bucket_count` (ברירת מחדל 20, `DEFAULT_HISTOGRAM_BUCKETS`) דליים שווי-רוחב בין המינימום למקסימום שנדגמו, עם טיפול במקרה הבסיסי שכל הערכים זהים (למשל את סימולציה עם הסתברות אירוע אפסית) — כדי לספק "התפלגות תוצאות" בפועל לתרשים, לא רק תקציר. שני שדות חדשים, `horizon_years` ו-`distribution` (רשימת `{bucket_min, bucket_max, count}`), נוספו לפלט של שתי הפונקציות. נוצר קובץ חדש `routers/simulation.py` עם שני endpoints תחת `/api/simulation`: (1) `GET /portfolio?iterations=&horizon_years=&seed=` — קורא ל-`simulation.run_portfolio_simulation`, עם ולידציית טווח ב-FastAPI `Query` (`iterations` עד 100,000, `horizon_years` עד 50, שניהם `gt=0`) כדי למנוע הרצה כבדה/חסרת משמעות בטעות. (2) `GET /properties/{property_id}?iterations=&horizon_years=&seed=` — קורא ל-`simulation.simulate_property`, מחזיר `404` אם הנכס לא קיים או שאין לו פרופיל סיכון (כפי שכבר תיעדה הפונקציה המקורית). נוספו שלוש סכמות חדשות ל-`schemas.py`: `HistogramBucket`, `PortfolioSimulationResult`, `PropertySimulationResult`. נרשם ב-`main.py`. נבדק בפועל מול `RiskDB` המקומי דרך שרת ה-preview (ללא שינוי סכמת DB): `GET /portfolio?iterations=2000&seed=42&horizon_years=1` החזיר נזק צפוי ₪11.49M, VaR95 ₪29.88M, VaR99 ₪39.91M והיסטוגרמה של 20 דליים — עקבי עם המספרים שתועדו במשימת בניית השירות המקורית; `horizon_years=3` עם אותו seed החזיר נזק צפוי ₪34.58M (~פי 3, כצפוי); `GET /properties/1?iterations=2000&seed=42` החזיר הסתברות אירוע 12.4%, MFL ₪18M ונזק צפוי ₪981K — תואם למסמך המקור; `GET /properties/999999` החזיר `404` כמצופה. וייבוא `app.main` תקין.

- [x] **Endpoint לאופטימיזציית השתתפות עצמית**: קלט אומדן נזק ופוליסה, פלט המלצה (לספוג / לתבוע).
  📁 קובץ חדש: `backend/app/routers/retention.py`
  ✅ בוצע ב-branch `feature/retention-optimizer-endpoint`: שכבת השירות (`services/retention.py`, ראו שלב 2) כבר כללה את הלוגיקה המלאה (`calculate_retention_recommendation`, `suggest_for_incident`) אך ללא endpoint חושף — נוצר קובץ חדש `routers/retention.py` עם שני נתיבים תחת `/api/retention`: (1) `GET /recommendation?policy_id=&property_id=&estimated_loss=` — מקבל אומדן נזק ידני מול פוליסה/נכס ספציפיים, מוודא קיום שניהם (`404` אחרת) לפני קריאה לשירות (השירות עצמו זורק `ValueError` על פוליסה חסרה, לא מתאים ל-HTTP ישירות). (2) `GET /incidents/{incident_id}` — עטיפה נוחה שמפעילה את `suggest_for_incident` על אירוע קיים (אומדן הנזק והפוליסה הפעילה נגזרים אוטומטית מהאירוע/הנכס שלו), `404` אם האירוע לא קיים או שאין לנכס שלו כיסוי פוליסה פעיל. נוספה סכמת תשובה `RetentionRecommendation` ב-`schemas.py` (תואמת למבנה המילון שכבר מוחזר מהשירות, עם `incident_id` אופציונלי). נרשם ב-`main.py`. נבדק בפועל מול `RiskDB` המקומי דרך שרת ה-preview: `GET /recommendation?policy_id=1&property_id=1&estimated_loss=450000` החזיר `200` עם המלצת `CLAIM` תקינה (השתתפות עצמית ₪100,000, חיסכון צפוי ₪297,500); `GET /incidents/1` החזיר את אותה תוצאה עם `incident_id=1` מצורף; פוליסה לא קיימת ואירוע לא קיים החזירו `404` עם הודעות ברורות. ייבוא `app.main` תקין.

- [x] **Endpoints לניהול מסמכים (DMS)**: העלאה ושליפה של פוליסות, דוחות שמאי ותכתובות לפי ישות.
  📁 קובץ חדש: `backend/app/routers/documents.py`
  ✅ בוצע ב-branch `feature/documents-endpoint`: בניגוד לרוב המשימות הקודמות בשלב זה, לא הייתה שכבת שירות ייעודית ל-`Documents` — אבל שכבת האחסון הכללית `services/storage.py` (upload/delete/signed-URL, ראו `routers/media.py`) כבר קיימת ומטבעה גנרית (`entity_type`/`entity_id`), כך שנדרשה רק חשיפה דרך endpoints חדשים בסגנון כמעט-זהה ל-`media.py`, לא מימוש לוגיקה חדשה. נוצר קובץ חדש `routers/documents.py` עם חמישה נתיבים תחת `/api/documents`: (1) `POST /entity/{entity_type}/{entity_id}?doc_type=&uploaded_by=` — מעלה קובץ (Multipart) ומצרף אותו לישות (`INCIDENT`/`CLAIM`/`PROPERTY`/`POLICY`, מאומת מול `schemas.DocumentEntityType`), עם `404` אם הישות לא קיימת (נבדק מול `_ENTITY_MODELS` — מיפוי entity_type ↔ מודל ORM). (2) `GET /entity/{entity_type}/{entity_id}` — רשימת מסמכים לישות, ממוינת יורד לפי `uploaded_at`. (3) `DELETE /{document_id}` — מוחק שורה + קובץ באחסון. (4) `GET /{document_id}/signed-url` — מנפיק קישור הורדה חתום (זהה בעקרונו ל-`/api/media/{media_id}/signed-url`). (5) `GET /download?key=&expires=&token=` — משרת את הבייטים בפועל לאחר אימות החתימה, זהה ל-`/api/media/download`. שים לב: נתיבי הישות תחת קידומת `/entity/...` ולא ישירות `/{entity_type}/{entity_id}` — כפי שהתגלה בבדיקה בפועל, מכיוון ש-`entity_type` מוקלד כ-`Literal` (הממומש ב-Starlette כממיר `str` רגיל), בקשה כמו `GET /api/documents/9999/signed-url` הייתה מותאמת מבנית לנתיב `/{entity_type}/{entity_id}` (`entity_type="9999"`, `entity_id="signed-url"` נכשל בהמרת `int`... אך מכיוון ש-Starlette כבר "התחייב" לנתיב הזה לפי המרת str, ה-422 שהתקבל היה על ולידציית ה-`Literal` ולא נפילה חזרה ל-`/{document_id}/signed-url`) — הוספת הקידומת `/entity/` מבטלת את הדו-משמעות לחלוטין במקום להסתמך על סדר רישום הנתיבים. הוספה סכמה חדשה `DocumentOut` (וה-`Literal` `DocumentEntityType`) ב-`schemas.py`, תואמת ל-`models.Document`. נרשם ב-`main.py`. נבדק בפועל מול `RiskDB` המקומי דרך שרת ה-preview (כולל restart של השרת בעקבות "wedging" של ה-reloader לאחר עריכות רצופות — ראו CLAUDE.md): העלאת קובץ ל-`PROPERTY/1` החזירה `201` עם רשומה תקינה; `GET /entity/PROPERTY/1` החזיר גם את הרשומה החדשה וגם רשומת seed קיימת; `GET /entity/PROPERTY/99999` החזיר `404`; `GET /{document_id}/signed-url` על מסמך קיים ועל מסמך לא קיים (`9999`) החזירו `200`/`404` בהתאמה (ללא 422 — מאמת את תיקון הדו-משמעות); `GET /download` עם טוקן תקין החזיר את תוכן הקובץ, וטוקן שגוי החזיר `403`; `DELETE /{document_id}` מחק גם את הרשומה וגם את הקובץ מהדיסק (אומת ידנית), והחזיר `404` על מסמך לא קיים; העלאה עם `entity_type=BOGUS` החזירה `422` על ולידציית ה-`Literal`. ייבוא `app.main` תקין.

- [x] **Endpoint לתיק אירוע מאוחד (Drill-down)**: החזרת אירוע + מדיה + תביעה + תשלומים + מסמכים בקריאה אחת.
  📁 `backend/app/routers/incidents.py`
  ✅ בוצע ב-branch `feature/incident-drilldown-endpoint`: נוסף `GET /api/incidents/{incident_id}/full` שמחזיר בקריאה אחת את כל "תיק האירוע": האירוע עצמו, כל רשומות המדיה שלו (`Incident_Media`, ממוין יורד לפי `captured_at`), כל התביעות שנפתחו עליו (`Claims`, ממוין יורד לפי `created_at`) — כל תביעה כוללת מקוננת את רשימת התשלומים שלה (`Claim_Payments`, נטענת ב-`selectinload` כדי למנוע N+1), וכל המסמכים המצורפים ישירות לאירוע (`Documents` שבהם `entity_type="INCIDENT"` ו-`entity_id=incident_id`, ממוין יורד לפי `uploaded_at` — משתמש ב-endpoint ה-DMS שנבנה במשימה הקודמת). נוספו שתי סכמות חדשות ל-`schemas.py`: `ClaimWithPaymentsOut` (יורשת מ-`ClaimOut` ומוסיפה `payments: list[ClaimPaymentOut]`) ו-`IncidentDrillDown` (`incident`, `media`, `claims`, `documents`). הנתיב `/{incident_id}/full` אינו יוצר דו-משמעות עם `/{incident_id}` הקיים (הצורה המבנית שונה — קטע נתיב נוסף קבוע `full`, לא פרמטר), כך שלא נדרש תיקון דומה לזה שהתגלה במשימת ה-DMS. נבדק בפועל מול `RiskDB` המקומי דרך שרת ה-preview: `GET /api/incidents/1/full` החזיר `200` עם האירוע, תביעה אחת עם שני תשלומים (מקדמה + סילוק סופי) ומערכי `media`/`documents` ריקים (אין רשומות seed מתאימות לאירוע זה); `GET /api/incidents/4/full` החזיר תביעה עם `payments: []` (טרם שולם) ומסמך `PHOTO` אחד מסוג `INCIDENT` שהתאים בדיוק לרשומת ה-seed (`INC-2025-004-photo1.jpg`); `GET /api/incidents/999999/full` החזיר `404`. ייבוא `app.main` תקין.

- [x] **תמיכה בשמירת אירוע כטיוטה** ובשליחה מאוחרת (Draft → Submitted).
  📁 `backend/app/routers/incidents.py` + `backend/app/schemas.py`
  ✅ בוצע ב-branch `feature/incident-draft-submit`: `IncidentCreate` נחשף כעת גם על `is_draft`, `business_interruption_requested`, `area_or_building`, `reported_coordinates` — עמודות שכבר קיימות ב-`models.Incident`/`schema.sql` מהמשימה הקודמת (הרחבת טבלת האירועים) אך לא היו חשופות בשכבת ה-API עד כה; `IncidentOut` הורחב אותו הדבר להחזרתן. נוספה `IncidentUpdate` (כל השדות אופציונליים) לעריכת תוכן טיוטה. שני נתיבים חדשים ב-`incidents.py`: `PATCH /{incident_id}` — עורך שדות של טיוטה קיימת, מחזיר `400` אם `is_draft=False` (האירוע כבר הוגש) ו-`404` אם לא קיים; מוודא ש-`property_id` חדש (אם נשלח) קיים בפועל. `PATCH /{incident_id}/submit` — הופך `is_draft` ל-`False` (Draft → Submitted), מחזיר `400` אם כבר הוגש בעבר ו-`404` אם לא קיים. אין דו-משמעות ניתוב: `PATCH /{incident_id}` הוא מתודה שונה מ-`GET /{incident_id}` הקיים, ו-`/{incident_id}/submit` הוא קטע נתיב קבוע נוסף בדיוק כמו `/{incident_id}/status` ו-`/{incident_id}/full` הקיימים. נבדק בפועל מול `RiskDB` המקומי דרך שרת ה-preview: יצירת טיוטה (`POST` עם `is_draft=true` + שאר השדות החדשים) הצליחה ב-`201`; `PATCH /{incident_id}` עדכן `description`/`initial_estimated_loss` בהצלחה (`200`); `PATCH /{incident_id}/submit` הפך את הטיוטה להגשה (`is_draft: false`, `200`); ניסיון עריכה נוספת אחרי ההגשה החזיר `400`; ניסיון הגשה כפולה החזיר `400`; ניסיון הגשה של אירוע לא-טיוטה קיים (incident 1) החזיר `400`; ניסיונות מול `incident_id=999999` (גם עריכה וגם הגשה) החזירו `404`.

- [x] **רישום כל הנתיבים החדשים באפליקציה**.
  📁 `backend/app/main.py`
  ✅ נבדק ב-branch `feature/verify-route-registration` (ללא שינוי קוד — משימת אימות סגירה): `main.py` כבר ייבא וכלל את כל 11 קובצי ה-routers הקיימים (`properties`, `incidents`, `policies`, `claims`, `mitigation`, `media`, `analytics`, `simulation`, `retention`, `documents`, `ai`) — נבנה בהדרגה לאורך המשימות הקודמות בסשן זה, ולא נותר אף router שנוצר ולא נרשם. אומת בפועל מול `GET /openapi.json` דרך שרת ה-preview הרץ: כל 43 הנתיבים מופיעים ברשימה, כולל אלו שנוספו במשימות האחרונות של הסשן — `/api/incidents/{incident_id}/full`, `/api/incidents/{incident_id}/submit`, `/api/documents/*`, `/api/retention/*`, `/api/simulation/*`, `/api/analytics/geographic-exposure-clusters`, `/api/analytics/exposure-by-region`, `/api/analytics/cashflow`. לא נדרש שינוי ב-`main.py`.

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

- [x] **הגבלת קצב ו-API Key מסודר לשירותי AI**: חיזוק המנגנון הקיים והסרת מפתחות מהקוד.
  📁 `backend/app/routers/ai.py` + `backend/app/config.py`
  ✅ בוצע ב-branch `feature/ai-rate-limiting`. הערת scope: שאר `שלב 4` (מודול אימות/JWT, RBAC, SSO/AD, Audit Log middleware, הצפנה במנוחה) הושאר פתוח בכוונה — `CLAUDE.md` §"Deliberately out of scope" מגדיר במפורש RBAC/audit-log enforcement והצפנה במנוחה כמחוץ לתחום הפרויקט הזה; רק פריט זה (rate limiting + ניהול מפתחות) לא מנוגד לרשימה ההיא ולכן טופל.
  ניהול המפתח: `services/llm.py` כבר קרא ל-`Anthropic(api_key=settings.anthropic_api_key)` מ-`backend/.env` (gitignored) — אין ולא היה מפתח קשיח בקוד; לא נדרש שינוי בהיבט הזה.
  חיזוק ה-rate limiting: קובץ חדש `backend/app/services/rate_limit.py` — מגביל בזיכרון תהליך (fixed-window per client-IP, `defaultdict`), ללא תלות חיצונית (Redis וכו') כי RMIS רץ כתהליך uvicorn יחיד להדגמה. שני settings חדשים ב-`config.py`: `ai_rate_limit_per_window` (ברירת מחדל 10) ו-`ai_rate_limit_window_seconds` (ברירת מחדל 60). הופעל כ-`dependencies=[Depends(enforce_ai_rate_limit)]` ברמת ה-`APIRouter` של `routers/ai.py` כך שהוא חל אוטומטית על כל שלושת נתיבי ה-AI (`/classify-incident`, `/executive-summary`, `/ask`) בלי לגעת בכל endpoint בנפרד. חריגה ממכסה מחזירה `429` עם הודעה בעברית וכותרת `Retry-After`. נבדק בפועל דרך שרת ה-preview: 11 קריאות רצופות ל-`POST /api/ai/ask` — 10 הראשונות החזירו `503` (כצפוי, אין `ANTHROPIC_API_KEY` מוגדר בסביבת הפיתוח המקומית — הבדיקה של ה-rate limit רצה כ-dependency *לפני* בדיקת המפתח, כך שהיא נבדקת ללא תלות בקיום מפתח), הקריאה ה-11 החזירה `429` עם `Retry-After: 59` והודעה "חריגה ממכסת הבקשות ל-AI (10 בקשות ל-60 שניות)"; `GET /api/incidents` (נתיב שאינו AI) המשיך לפעול כרגיל (`200`) — מוודא שה-dependency לא דלף לנתיבים אחרים.

---

## שלב 5 — Frontend: טפסים ודיווח שטח

- [x] **שדרוג מסך דיווח אירוע לאשף שלבים (Wizard)**: 4 שלבים — זיהוי נכס, פרטי נזק, אומדן ותיאור, תיעוד מצולם.
  📁 `frontend/src/pages/IncidentReport.tsx`
  ✅ נבדק ב-branch `feature/incident-report-wizard` (ללא שינוי קוד — משימת אימות סגירה): `IncidentReport.tsx` כבר מימש אשף מלא ב-MUI `Stepper`/`Step`/`StepLabel` עם ארבעת השלבים המדויקים שהמפרט מבקש — `STEPS = ["מיקום וזיהוי הנכס", "פרטי הנזק והחומרה", "אומדן כספי ותיאור", "תיעוד ושליחה"]` — כולל באנר חירום קבוע ("במקרה של סכנת חיים חייג 102/100 מיד"), כפתורי בחירת חומרה עם קידוד צבע (ירוק/כתום-אדום/אדום כהה לפי `SEVERITY_OPTIONS`), ניתוח AI אופציונלי בשלב 3, ומסך "נשלח בהצלחה" מסכם. ולידציית מעבר שלב (`canNext`) חוסמת "המשך" עד שמולאו שדות החובה של השלב הנוכחי. נבדק בפועל דרך שרת ה-preview: ניווט ל-`/report-incident` הציג את הבאנר והסטפר עם 4 השלבים בשמות הנכונים; `Autocomplete` של הנכס נטען בהצלחה מול ה-API החי (10 נכסים מ-`RiskDB` המקומי, כולל תעתיק עברי תקין עם גרשיים ב-"מרלו״ג"/"ראשל״צ"); בחירת נכס ולחיצה על "המשך" עברה כהלכה לשלב 2, שהציג נכון את שלוש קבוצות הבחירה (סוג נזק/חומרה/סטטוס פעילות) עם התוויות העבריות המלאות. לא בוצע שינוי קוד — שאר פריטי שלב 5 (הוק GPS, רכיב העלאת מדיה אמיתי, שמירה כטיוטה ב-UI, שדה בקשת כיסוי אובדן רווחים, הרחבת טופס הפוליסה) הם סעיפים נפרדים ברשימה ונותרים פתוחים.

- [x] **זיהוי נכס לפי GPS**: קבלת מיקום המכשיר והצעת הנכסים הקרובים ברדיוס מוגדר.
  📁 קובץ חדש: `frontend/src/hooks/useGeolocation.ts` + שימוש ב-`IncidentReport.tsx`
  ✅ בוצע ונבדק ב-branch `feature/incident-geolocation`: נוסף הוק `useGeolocation` (עוטף את ה-Geolocation API של הדפדפן; לא מבקש הרשאה אוטומטית בטעינת העמוד — רק בלחיצה על כפתור "אתר את מיקומי", כדי לא להפתיע משתמש שדה) ופונקציית עזר `distanceKm` (נוסחת Haversine). ב-`IncidentReport.tsx` שלב 1 נוסף כפתור מיקום; עם קבלת קואורדינטות, כל הנכסים מסוננים לרדיוס `NEARBY_RADIUS_KM=15` ק"מ, ממוינים לפי מרחק, ומוצגים כ-Chips לבחירה מהירה (מעדכנים את שדה ה-`Autocomplete` הקיים בלחיצה). טופלו גם מצב סירוב הרשאה ומצב "אין נכסים ברדיוס" עם הודעות מתאימות. בנוסף, הקואורדינטות שהתקבלו (אם קיימות) נשלחות כעת לשרת בשדה `reported_coordinates` (שדה שכבר קיים בסכמת ה-backend, `IncidentCreate`/`IncidentOut` — רק לא נשלח מה-frontend עד כה; נוסף התאמה מקבילה ל-`IncidentCreate` ב-`frontend/src/api/client.ts`). נבדק בפועל דרך שרת ה-preview: לחיצה על הכפתור ללא הרשאת דפדפן הציגה נכון את הודעת "הגישה למיקום נדחתה — ניתן לבחור נכס ידנית"; לאחר mock של `navigator.geolocation.getCurrentPosition` לנקודת ייחוס בתל אביב, הוצגו 5 הנכסים הקרובים ממוינים נכון לפי מרחק (2.2 עד 13.9 ק"מ, כולל תעתיק עברי תקין עם גרשיים ב-"ראשל״צ"), ולחיצה על ה-chip הראשון מילאה נכון את שדה ה-`Autocomplete` ("מגדל משרדים תל אביב (PRP-002)"). `npx tsc -b` לא הראה שגיאות חדשות בקבצים שנערכו (שגיאת `stylis` הקיימת ב-`rtlCache.ts` היא קיימת מראש ואינה קשורה).

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
