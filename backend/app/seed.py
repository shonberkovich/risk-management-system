"""Seed the RiskDB database with demo data.

Run directly: python -m app.seed
Uses parameterized pyodbc inserts so Hebrew (Unicode) text round-trips
correctly regardless of console/file codepage issues that affect sqlcmd.

Exception: rows with an encrypted column (`Insurance_Policies.per_event_limit`,
`Policy_Assets.specific_deductible`, `Claims.adjuster_name`,
`Claim_Payments.reference_number` — see `services/encryption.py`) are inserted via the
SQLAlchemy ORM session instead of raw pyodbc. `EncryptedString`'s encryption only runs
through SQLAlchemy's `process_bind_param` hook; a raw pyodbc INSERT bypasses the ORM
entirely and would silently write those columns as plaintext. ORM instances are built
with plain Python values (e.g. `adjuster_name="רון גבע"`) exactly as application code
would, and the encryption happens transparently on flush/commit.
"""
from datetime import date

import pyodbc

from app.database import SessionLocal, get_connection_string
from app.models import Claim, ClaimPayment, InsurancePolicy, PolicyAsset
from app.services.auth import hash_password


def _d(iso: str | None) -> date | None:
    """Parse an ISO 'YYYY-MM-DD' string into a `date` for ORM assignment (pyodbc accepts
    those strings directly for a DATE column; the ORM needs an actual `date`)."""
    return date.fromisoformat(iso) if iso else None

# Demo login password for every seeded user (see routers/auth.py POST /api/auth/login).
# A course-demo convenience, not a security posture — real deployments provision
# passwords per-user, never a shared constant.
DEMO_PASSWORD = "Demo1234!"


def run():
    conn = pyodbc.connect(get_connection_string())
    conn.autocommit = False
    cur = conn.cursor()

    # --- clean slate (children first) ---
    for table in [
        "Notification_Log", "Claim_Reserves", "Claim_Payments", "Claims", "Incident_Media", "Incidents",
        "Documents", "Audit_Log", "Policy_Assets", "Mitigation_Tasks", "Asset_Risk_Profiles",
        "Insurance_Policies", "Properties", "Regions", "Role_Permissions",
        "Financial_Statements", "Notification_Recipients", "Users",
    ]:
        cur.execute(f"DELETE FROM {table}")
    for table in [
        "Regions", "Properties", "Asset_Risk_Profiles", "Insurance_Policies",
        "Incidents", "Claims", "Claim_Payments", "Claim_Reserves", "Mitigation_Tasks",
        "Audit_Log", "Role_Permissions", "Documents", "Financial_Statements",
        "Notification_Recipients", "Notification_Log", "Users",
    ]:
        cur.execute(f"DBCC CHECKIDENT ('{table}', RESEED, 1)")

    # --- Users ---
    users = [
        ("דנה כהן", "dana.cohen@company.co.il", "RISK_MANAGER"),
        ("אבי לוי", "avi.levi@company.co.il", "CFO"),
        ("מיכל אזולאי", "michal.azoulay@company.co.il", "PROPERTY_MANAGER"),
        ("יוסי מזרחי", "yossi.mizrahi@company.co.il", "PROPERTY_MANAGER"),
        ("רונית שמעוני", "ronit.shimoni@company.co.il", "FIELD_WORKER"),
        ("עומר בר", "omer.bar@company.co.il", "FIELD_WORKER"),
        ("אדמין מערכת", "admin@company.co.il", "ADMIN"),
        ("נעם פרידמן", "noam.friedman@company.co.il", "RISK_OFFICER"),
        ("שרה כהן", "sara.cohen@adjusters.co.il", "ADJUSTER"),
    ]
    password_hash = hash_password(DEMO_PASSWORD)
    cur.executemany(
        "INSERT INTO Users (full_name, email, role, password_hash) VALUES (?, ?, ?, ?)",
        [(*u, password_hash) for u in users],
    )

    # --- Regions ---
    regions = [
        ("CENTER", "מרכז"),
        ("NORTH", "צפון"),
        ("SOUTH", "דרום"),
    ]
    cur.executemany(
        "INSERT INTO Regions (region_code, name) VALUES (?, ?)", regions
    )
    region_id_by_name = {"מרכז": 1, "צפון": 2, "דרום": 3}

    # --- Properties ---
    properties = [
        ("PRP-001", 'מרלו"ג מודיעין', "איזור תעשייה מודיעין, כניסה 3", "מרכז", 31.9034, 35.0136, "LOGISTICS_CENTER", 45000000, 32000000, 3),
        ("PRP-002", "מגדל משרדים תל אביב", "רוטשילד 45, תל אביב", "מרכז", 32.0662, 34.7767, "OFFICE_BUILDING", 120000000, 98000000, 3),
        ("PRP-003", "מרכז מסחרי נשר", "שדרות הנשיא, נשר", "צפון", 32.7699, 35.0446, "RETAIL", 28000000, 21000000, 4),
        ("PRP-004", "מרכז לוגיסטי אשדוד", "איזור תעשייה צפוני, אשדוד", "דרום", 31.8380, 34.6560, "LOGISTICS_CENTER", 38000000, 27000000, 4),
        ("PRP-005", "מתחם משרדים חיפה", "שדרות פל-ים 2, חיפה", "צפון", 32.7940, 34.9896, "OFFICE_BUILDING", 65000000, 51000000, 4),
        ("PRP-006", "מחסן ריכוז באר שבע", "איזור תעשייה עמק שרה, באר שבע", "דרום", 31.2181, 34.7913, "LOGISTICS_CENTER", 22000000, 16000000, 3),
        ("PRP-007", "קניון רעננה", "אחוזה 90, רעננה", "מרכז", 32.1848, 34.8713, "RETAIL", 54000000, 43000000, 3),
        ("PRP-008", "מגדל היי-טק הרצליה", "מדינת היהודים 89, הרצליה", "מרכז", 32.1656, 34.8195, "OFFICE_BUILDING", 95000000, 77000000, 4),
        ("PRP-009", "תחנת חלוקה נתניה", "איזור תעשייה פולג, נתניה", "מרכז", 32.2846, 34.8664, "INFRASTRUCTURE", 31000000, 24000000, 3),
        ("PRP-010", 'מרכז לוגיסטי ראשל"צ', "איזור תעשייה קריית משה, ראשון לציון", "מרכז", 31.9838, 34.7736, "LOGISTICS_CENTER", 41000000, 29000000, 4),
        ("PRP-011", "מרכז מסחרי אילת", "שדרות התמרים, אילת", "דרום", 29.5581, 34.9482, "RETAIL", 19000000, 14000000, 3),
        ("PRP-012", "מתחם משרדים ירושלים", "כנפי נשרים 15, ירושלים", "מרכז", 31.7857, 35.2007, "OFFICE_BUILDING", 72000000, 58000000, 4),
        ("PRP-013", "מחסן קירור טבריה", "איזור תעשייה, טבריה", "צפון", 32.7959, 35.5399, "LOGISTICS_CENTER", 26000000, 18000000, 3),
        ("PRP-014", "תחנת שנע כרמיאל", "איזור תעשייה צפוני, כרמיאל", "צפון", 32.9186, 35.2952, "INFRASTRUCTURE", 17000000, 12000000, 4),
        ("PRP-015", "מגדל משרדים פתח תקווה", "העצמאות 15, פתח תקווה", "מרכז", 32.0917, 34.8850, "OFFICE_BUILDING", 58000000, 46000000, 3),
    ]
    cur.executemany(
        """INSERT INTO Properties
           (property_code, name, address, region, region_id, latitude, longitude, asset_type,
            replacement_value, book_value, primary_manager_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        [
            (code, name, address, region, region_id_by_name[region], lat, lng, asset_type, repl, book, mgr)
            for (code, name, address, region, lat, lng, asset_type, repl, book, mgr) in properties
        ],
    )
    # property_id -> (latitude, longitude), for deriving realistic reported_coordinates on incidents
    property_coords = {i + 1: (p[4], p[5]) for i, p in enumerate(properties)}

    # --- Asset_Risk_Profiles ---
    # Trailing column is near_hazmat_site (TODO_SPEC.md §11 item 1) — 1 for the two
    # industrial/logistics properties whose notes already describe an industrial-site
    # context (9: old distribution-station wiring; 13: refrigerated warehouse), 0
    # elsewhere; demo data only, not derived from the real environmental.py lookup.
    profiles = [
        (1, "2025-11-15", 4, 3, 2, 18000000, 1, "מבנה סמוך לנחל, נצפה סיכון הצפה בחורף", 0),
        (2, "2025-10-02", 2, 2, 3, 25000000, 1, "מגדל חדש, מערכות מיגון עדכניות", 0),
        (3, "2025-09-20", 3, 4, 2, 12000000, 0, "אין מתזים - המלצה להתקנה", 0),
        (4, "2025-12-01", 4, 3, 2, 16000000, 1, "קרבה לים - סיכון הצפה בגאות גבוהה", 0),
        (5, "2025-08-14", 2, 2, 3, 20000000, 1, "תקין", 0),
        (6, "2025-11-01", 1, 3, 3, 9000000, 0, "אזור מדברי - סיכון הצפה נמוך", 0),
        (7, "2025-07-22", 2, 4, 2, 22000000, 1, "עומס גבוה של מבקרים - סיכון אש מוגבר", 0),
        (8, "2025-10-18", 2, 2, 3, 28000000, 1, "מבנה חדיש עם גילוי עשן מתקדם", 0),
        (9, "2025-09-05", 3, 3, 2, 11000000, 0, "תחנת חלוקה - חשמל עתיק", 1),
        (10, "2025-12-10", 3, 3, 2, 15000000, 1, "תקין", 0),
        (11, "2025-06-30", 1, 4, 4, 8000000, 0, "אזור סיכון רעידות אדמה מוגבר (בקע סורי-אפריקני)", 0),
        (12, "2025-11-20", 2, 3, 4, 21000000, 1, "סמוך לקו תפר - רעידות אדמה", 0),
        (13, "2025-08-01", 4, 2, 2, 10000000, 1, "מחסן קירור - סיכון תקלה חשמלית", 1),
        (14, "2025-10-25", 2, 3, 2, 7000000, 0, "תחנת שנע - אין כיסוי מתזים", 0),
        (15, "2025-09-12", 2, 2, 3, 19000000, 1, "תקין", 0),
    ]
    cur.executemany(
        """INSERT INTO Asset_Risk_Profiles
           (property_id, survey_date, flood_risk_score, fire_risk_score, earthquake_risk_score,
            mfl_amount, has_sprinklers, notes, near_hazmat_site)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        profiles,
    )

    # --- Insurance_Policies / Policy_Assets ---
    # per_event_limit / specific_deductible are encrypted at rest (EncryptedString —
    # see services/encryption.py). Encryption only happens via SQLAlchemy's
    # process_bind_param, so these two tables are inserted through the ORM session
    # (see module docstring) rather than the raw pyodbc cursor used everywhere else.
    # Commit and flush the pyodbc work so far first — Policy_Assets needs the just-
    # inserted Properties to already be visible.
    conn.commit()

    policies = [
        ("POL-2026-CENTRAL", "הפניקס ביטוח", "2026-01-01", "2026-12-31", 200000000, 100000, 1850000, "ACTIVE",
         50000000, 72, "נזקי מלחמה ופעולות איבה; נזק גרעיני; בלאי טבעי ותחזוקה לקויה"),
        ("POL-2026-NORTH", "כלל ביטוח", "2026-01-01", "2026-12-31", 90000000, 75000, 720000, "ACTIVE",
         30000000, 72, "נזקי מלחמה ופעולות איבה; רעידת אדמה מעל 7 בסולם ריכטר"),
        ("POL-2026-SOUTH", "מגדל ביטוח", "2026-01-01", "2026-12-31", 80000000, 75000, 610000, "ACTIVE",
         25000000, 96, "נזקי מלחמה ופעולות איבה; שיטפונות באזורים מוצהרים כאזורי סיכון"),
        ("POL-2026-BI", "הראל ביטוח - אובדן רווחים", "2026-01-01", "2026-12-31", 50000000, 50000, 380000, "ACTIVE",
         20000000, 168, "אובדן רווחים עקב שביתה או השבתה יזומה; נזק עקיף שאינו תוצאה ישירה מאירוע מבוטח"),
    ]
    policy_assets = [
        (1, 1, None), (1, 2, None), (1, 7, None), (1, 8, None), (1, 9, None),
        (1, 10, None), (1, 12, None), (1, 15, None),
        (2, 3, None), (2, 5, None), (2, 13, None), (2, 14, None),
        (3, 4, None), (3, 6, None), (3, 11, 100000),
        (4, 1, None), (4, 2, None), (4, 7, None),
    ]
    session = SessionLocal()
    try:
        for (policy_number, insurer_name, start_date, end_date, total_limit, deductible_default,
             annual_premium, status, per_event_limit, bi_waiting_period_hours, exclusions) in policies:
            session.add(InsurancePolicy(
                policy_number=policy_number, insurer_name=insurer_name,
                start_date=_d(start_date), end_date=_d(end_date), total_limit=total_limit,
                deductible_default=deductible_default, annual_premium=annual_premium, status=status,
                per_event_limit=per_event_limit, bi_waiting_period_hours=bi_waiting_period_hours,
                exclusions=exclusions,
            ))
        for policy_id, property_id, specific_deductible in policy_assets:
            session.add(PolicyAsset(
                policy_id=policy_id, property_id=property_id, specific_deductible=specific_deductible,
            ))
        session.commit()
    finally:
        session.close()

    # --- Incidents ---
    # Base tuples: (code, property_id, reporter_id, timestamp, hazard, severity, impact,
    #               est_loss, description, status, ai_classified, ai_confidence,
    #               is_draft, business_interruption_requested, area_or_building, gps_offset)
    # gps_offset is a small (lat, lng) delta applied to the property's own coordinates to
    # simulate the field reporter's device GPS reading; None means no GPS was captured.
    incidents_base = [
        ("INC-2025-001", 1, 5, "2025-01-12 07:00", "FLOOD", "HIGH", "PARTIAL_SHUTDOWN", 450000,
         "פיצוץ בצינור מים ראשי בקומה 1 שגרם להצפה באזור האריזה. החשמל נותק באופן יזום.", "CLAIM_FILED", 1, 0.920,
         0, 1, "קומת קרקע - אזור אריזה", (0.0006, -0.0004)),
        ("INC-2025-002", 3, 6, "2025-03-05 14:20", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 120000,
         'קצר חשמלי בלוח ראשי, עשן זוהה ע"י מערכת גילוי, כובה מיידית ע"י צוות אבטחה.', "UNDER_INVESTIGATION", 1, 0.870,
         0, 1, "חדר לוח חשמל ראשי", (-0.0003, 0.0005)),
        ("INC-2025-003", 2, 5, "2025-04-18 09:15", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 85000,
         "סדק בתקרת קומה 12 התגלה בבדיקה שגרתית, נדרש תיקון.", "CLOSED", 0, None,
         0, 0, "קומה 12", None),
        ("INC-2025-004", 7, 6, "2025-05-02 22:40", "FIRE", "CRITICAL", "FULL_SHUTDOWN", 1200000,
         "שריפה פרצה בחנות בקומת הקרקע, התפשטה לחנויות סמוכות. כיבוי אש הגיע תוך 12 דקות.", "CLAIM_FILED", 1, 0.950,
         0, 1, "קומת קרקע - אגף חנויות", (0.0009, 0.0002)),
        ("INC-2025-005", 4, 5, "2025-06-14 06:30", "THEFT", "MEDIUM", "PARTIAL_SHUTDOWN", 65000,
         "פריצה למחסן בשעות הלילה, נגנב ציוד אלקטרוני.", "CLOSED", 0, None,
         0, 0, "מחסן לילה - אגף B", (-0.0005, -0.0002)),
        ("INC-2025-006", 9, 6, "2025-07-01 11:00", "ELECTRICAL", "LOW", "FULL_OPERATION", 18000,
         "תקלה בלוח חשמל משני, לא נגרם נזק משמעותי.", "CLOSED", 0, None,
         0, 0, "לוח חשמל משני", None),
        ("INC-2025-007", 6, 5, "2025-07-20 15:45", "FIRE", "MEDIUM", "PARTIAL_SHUTDOWN", 210000,
         'שריפה קטנה במחסן חומרי אריזה, כובתה ע"י צוות פנימי.', "UNDER_INVESTIGATION", 1, 0.810,
         0, 1, "מחסן חומרי אריזה", (0.0002, 0.0007)),
        ("INC-2025-008", 1, 6, "2025-08-09 03:20", "FLOOD", "CRITICAL", "FULL_SHUTDOWN", 980000,
         "הצפה חמורה בעקבות סופה, מים חדרו לקומת הקרקע ופגעו במלאי.", "CLAIM_FILED", 1, 0.930,
         0, 1, "קומת קרקע - מחסן מלאי", (-0.0007, 0.0003)),
        ("INC-2025-009", 12, 5, "2025-08-22 10:10", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 42000,
         "סדקים קלים בקירות חוץ בעקבות רעידת אדמה קלה.", "CLOSED", 0, None,
         0, 0, "קירות חוץ - חזית מערבית", None),
        ("INC-2025-010", 5, 6, "2025-09-03 13:30", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 95000,
         'עלייה בטמפרטורת לוח חשמל ראשי, זוהה ע"י חיישן טמפרטורה.', "UNDER_INVESTIGATION", 1, 0.760,
         0, 1, "לוח חשמל ראשי - קומת מרתף", (0.0004, -0.0006)),
        ("INC-2025-011", 11, 5, "2025-09-15 04:50", "STRUCTURAL_FAILURE", "HIGH", "PARTIAL_SHUTDOWN", 310000,
         "רעידת אדמה בעוצמה בינונית גרמה לסדקים במבנה.", "CLAIM_FILED", 0, None,
         0, 1, "מבנה כללי", (-0.0002, -0.0008)),
        ("INC-2025-012", 10, 6, "2025-10-01 08:00", "THEFT", "LOW", "FULL_OPERATION", 28000,
         "ניסיון פריצה נכשל, אזעקה הרתיעה את הפורצים.", "CLOSED", 0, None,
         0, 0, "כניסה ראשית", None),
        ("INC-2025-013", 3, 5, "2025-10-14 19:20", "FIRE", "HIGH", "PARTIAL_SHUTDOWN", 340000,
         "שריפה במטבח מסעדה בקניון, התפשטה לתקרה.", "CLAIM_FILED", 1, 0.890,
         0, 1, "מטבח מסעדה - קומה 1", (0.0005, 0.0004)),
        ("INC-2025-014", 13, 6, "2025-11-02 05:15", "ELECTRICAL", "CRITICAL", "FULL_SHUTDOWN", 560000,
         "כשל במערכת קירור עקב תקלה חשמלית, מלאי מזון קפוא ניזוק.", "CLAIM_FILED", 1, 0.900,
         0, 1, "מערכת קירור - חדר מכונות", (-0.0004, 0.0006)),
        ("INC-2025-015", 8, 5, "2025-11-20 16:40", "FLOOD", "LOW", "FULL_OPERATION", 22000,
         "נזילה קלה ממערכת מיזוג, נזק מינימלי לריצוף.", "CLOSED", 0, None,
         0, 0, "מערכת מיזוג - קומה 4", None),
        ("INC-2025-016", 2, 6, "2025-12-05 12:00", "OTHER", "LOW", "FULL_OPERATION", 15000,
         "נזק קל למעלית עקב תקלה טכנית.", "CLOSED", 0, None,
         0, 0, "פיר מעלית - מגדל B", None),
        ("INC-2026-001", 1, 5, "2026-01-12 07:00", "FLOOD", "HIGH", "PARTIAL_SHUTDOWN", 450000,
         "פיצוץ נוסף בצנרת מים בקומה 1, אזור דומה לאירוע קודם - נדרשת בדיקת תשתית.", "CLAIM_FILED", 1, 0.940,
         0, 1, "קומת קרקע - צנרת ראשית", (0.0003, -0.0005)),
        ("INC-2026-002", 9, 6, "2026-01-25 09:30", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 78000,
         "קצר בלוח חשמל ראשי בתחנת החלוקה.", "UNDER_INVESTIGATION", 1, 0.820,
         0, 1, "לוח חשמל ראשי", (-0.0006, 0.0001)),
        ("INC-2026-003", 4, 5, "2026-02-10 21:00", "THEFT", "HIGH", "PARTIAL_SHUTDOWN", 110000,
         "פריצה מאורגנת למחסן, נגנבו טובין בהיקף משמעותי.", "CLAIM_FILED", 1, 0.870,
         0, 1, "מחסן טובין - אגף C", (0.0007, 0.0003)),
        ("INC-2026-004", 7, 6, "2026-03-05 11:15", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 38000,
         "התמוטטות חלקית של תקרה דקורטיבית, אין נפגעים.", "UNDER_INVESTIGATION", 0, None,
         0, 0, "תקרה דקורטיבית - אטריום", None),
        ("INC-2026-005", 14, 5, "2026-03-22 06:00", "FIRE", "CRITICAL", "FULL_SHUTDOWN", 680000,
         "שריפה בתחנת שנע פגעה במלוא המבנה, נדרש שיקום מלא.", "CLAIM_FILED", 1, 0.960,
         0, 1, "מבנה מלא", (-0.0008, -0.0003)),
        ("INC-2026-006", 6, 6, "2026-04-08 14:00", "FLOOD", "MEDIUM", "PARTIAL_SHUTDOWN", 145000,
         "הצפה עקב גשמים כבדים, מים חדרו למחסן התחתון.", "UNDER_INVESTIGATION", 1, 0.850,
         0, 1, "מחסן תחתון", (0.0002, 0.0008)),
        ("INC-2026-007", 15, 5, "2026-05-01 08:45", "ELECTRICAL", "LOW", "FULL_OPERATION", 31000,
         "תקלה קלה בגנרטור גיבוי, טופלה במקום.", "CLOSED", 0, None,
         0, 0, "חדר גנרטור", None),
        ("INC-2026-008", 5, 6, "2026-05-19 17:30", "OTHER", "LOW", "FULL_OPERATION", 12000,
         "נזק קל לחזית הבניין עקב סופת רוחות.", "CLOSED", 0, None,
         0, 0, "חזית מבנה", None),
        ("INC-2026-009", 12, 5, "2026-06-02 10:00", "STRUCTURAL_FAILURE", "MEDIUM", "PARTIAL_SHUTDOWN", 195000,
         "סדקים משמעותיים בעמודי תמך התגלו בבדיקה תקופתית.", "UNDER_INVESTIGATION", 0, None,
         0, 1, "עמודי תמך - קומת מרתף", (-0.0001, 0.0004)),
        # --- draft incidents: demonstrate save-as-draft / submit-later workflow ---
        ("INC-2026-010", 3, 6, "2026-06-20 09:00", "OTHER", "LOW", "FULL_OPERATION", 5000,
         "טיוטת דיווח ראשונית - נזק קל שזוהה בסיור שגרתי, טרם אושר לשליחה.", "NEW", 0, None,
         1, 0, "חניון תת-קרקעי", (0.0003, 0.0002)),
        ("INC-2026-011", 10, 5, "2026-07-02 16:20", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 40000,
         "טיוטה - חשד לתקלה בלוח חשמל, ממתין להשלמת פרטים ותמונות לפני שליחה.", "NEW", 0, None,
         1, 0, "לוח חשמל - קומת מרתף", None),
    ]
    incidents = []
    for (code, prop_id, reporter, ts, hazard, sev, impact, loss, desc, status, ai_cls, ai_conf,
         is_draft, bi_requested, area, gps_offset) in incidents_base:
        if gps_offset is not None:
            base_lat, base_lng = property_coords[prop_id]
            d_lat, d_lng = gps_offset
            coords = f"{float(base_lat) + d_lat:.6f},{float(base_lng) + d_lng:.6f}"
        else:
            coords = None
        incidents.append((
            code, prop_id, reporter, ts, hazard, sev, impact, loss, desc, status, ai_cls, ai_conf,
            is_draft, bi_requested, area, coords,
        ))
    cur.executemany(
        """INSERT INTO Incidents
           (incident_code, property_id, reported_by_user_id, incident_timestamp, hazard_type,
            severity_level, operational_impact, initial_estimated_loss, description, status,
            ai_classified, ai_confidence, is_draft, business_interruption_requested,
            area_or_building, reported_coordinates)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        incidents,
    )
    conn.commit()

    # --- Claims (incident_id 1,4,8,11,13,14,17,19,21 map to CLAIM_FILED rows above) ---
    # adjuster_name / reference_number are encrypted at rest, so Claims and
    # Claim_Payments are inserted via the ORM session too (see module docstring).
    claims = [
        ("CLM-2025-01", 1, 1, 400000, 50000, 380000, "APPROVED", "רון גבע", "2026-08-15"),
        ("CLM-2025-04", 4, 1, 1100000, 100000, 950000, "IN_ADJUSTMENT", "שרה כהן", None),
        ("CLM-2025-08", 8, 1, 900000, 100000, 850000, "APPROVED", "רון גבע", "2026-09-01"),
        ("CLM-2025-11", 11, 3, 280000, 75000, 0, "IN_ADJUSTMENT", "דוד לוי", None),
        ("CLM-2025-13", 13, 2, 320000, 75000, 300000, "APPROVED", "מירב שני", "2026-08-20"),
        ("CLM-2025-14", 14, 2, 540000, 75000, 0, "SUBMITTED", "מירב שני", None),
        ("CLM-2026-01", 17, 1, 400000, 50000, 0, "SUBMITTED", "רון גבע", None),
        ("CLM-2026-03", 19, 3, 100000, 75000, 95000, "APPROVED", "דוד לוי", "2026-09-10"),
        ("CLM-2026-05", 21, 2, 650000, 75000, 0, "IN_ADJUSTMENT", "שרה כהן", None),
    ]
    payments = [
        (1, "2026-07-20", 200000, "PMT-10021", "ADVANCE"),
        (1, "2026-08-15", 180000, "PMT-10088", "FINAL_SETTLEMENT"),
        (3, "2026-07-10", 400000, "PMT-10015", "ADVANCE"),
        (5, "2026-08-01", 300000, "PMT-10077", "FINAL_SETTLEMENT"),
        (8, "2026-08-25", 95000, "PMT-10099", "FINAL_SETTLEMENT"),
    ]
    session = SessionLocal()
    try:
        for (claim_number, incident_id, policy_id, claimed_amount, deductible_applied,
             approved_amount, claim_status, adjuster_name, expected_payment_date) in claims:
            session.add(Claim(
                claim_number=claim_number, incident_id=incident_id, policy_id=policy_id,
                claimed_amount=claimed_amount, deductible_applied=deductible_applied,
                approved_amount=approved_amount, claim_status=claim_status, adjuster_name=adjuster_name,
                expected_payment_date=_d(expected_payment_date),
            ))
        for claim_id, payment_date, amount, reference_number, payment_type in payments:
            session.add(ClaimPayment(
                claim_id=claim_id, payment_date=_d(payment_date), amount=amount,
                reference_number=reference_number, payment_type=payment_type,
            ))
        session.commit()
    finally:
        session.close()

    # --- Claim_Reserves: open balance on claims still owed money ---
    # claim 3 (CLM-2025-08) has an ADVANCE of 400000 against an approved 850000 -> 450000 still reserved.
    # claims 2/4/6/7/9 have no payments yet; reserve their approved amount (or, if not yet approved,
    # the claimed amount net of the deductible as a working estimate pending adjustment).
    reserves = [
        (2, 950000, "2026-10-01", "2026-08-05"),   # CLM-2025-04, IN_ADJUSTMENT, approved but unpaid
        (3, 450000, "2026-09-01", "2026-08-10"),   # CLM-2025-08, partially paid, remaining balance
        (4, 200000, None, "2026-08-01"),           # CLM-2025-11, IN_ADJUSTMENT, working estimate
        (6, 465000, None, "2026-07-25"),           # CLM-2025-14, SUBMITTED, working estimate
        (7, 350000, None, "2026-08-12"),           # CLM-2026-01, SUBMITTED, working estimate
        (9, 575000, None, "2026-08-14"),           # CLM-2026-05, IN_ADJUSTMENT, working estimate
    ]
    cur.executemany(
        """INSERT INTO Claim_Reserves (claim_id, reserve_amount, expected_payment_date, updated_at)
           VALUES (?, ?, ?, ?)""",
        reserves,
    )

    tasks = [
        (1, "התקנת שסתומים אל-חוזרים למניעת הצפה חוזרת", 85000, 120000, "2026-10-01", "IN_PROGRESS", 3),
        (3, "התקנת מערכת מתזים אוטומטית", 220000, 95000, "2026-11-15", "OPEN", 4),
        (9, "שדרוג לוח חשמל ראשי לתחנת החלוקה", 65000, 40000, "2026-09-20", "OPEN", 3),
        (11, "חיזוק קונסטרוקטיבי נגד רעידות אדמה", 450000, 60000, "2027-01-31", "OPEN", 3),
        (4, "שדרוג מערכת אבטחה והתראה מפני פריצה", 55000, 35000, "2026-09-05", "COMPLETED", 4),
        (14, "התקנת מערכת גילוי וכיבוי אש", 180000, 75000, "2026-10-30", "IN_PROGRESS", 3),
        (13, "בדיקה ושדרוג מערכת חשמל למחסן קירור", 95000, 55000, "2026-09-15", "OVERDUE", 4),
        (6, "התקנת מערכת ניקוז למניעת הצפות", 70000, 30000, "2026-11-01", "OPEN", 3),
        (7, "עדכון תקני בטיחות אש בקומת מסעדות", 40000, 50000, "2026-08-25", "OVERDUE", 4),
        (12, "בדיקת יציבות מבנית ותיקון עמודי תמך", 310000, 45000, "2026-12-15", "OPEN", 3),
        (2, "שדרוג מערכת מעליות", 60000, 20000, "2026-10-10", "COMPLETED", 3),
        (15, "התקנת גנרטור גיבוי משודרג", 75000, 25000, "2026-11-20", "OPEN", 4),
    ]
    cur.executemany(
        """INSERT INTO Mitigation_Tasks
           (property_id, title, cost_estimate, expected_annual_savings, due_date, status, assigned_to_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        tasks,
    )

    # --- Role_Permissions ---
    role_permissions = [
        ("RISK_MANAGER", "incidents:view", "צפייה בכל האירועים"),
        ("RISK_MANAGER", "incidents:edit", "עריכת אירועים וסטטוסים"),
        ("RISK_MANAGER", "claims:view", "צפייה בתביעות"),
        ("RISK_MANAGER", "mitigation:manage", "ניהול משימות מיטיגציה"),
        ("RISK_MANAGER", "reports:view", "צפייה בדוחות הנהלה"),
        ("CFO", "claims:view", "צפייה בתביעות"),
        ("CFO", "claims:approve", "אישור תביעות"),
        ("CFO", "financials:view", "צפייה בנתונים פיננסיים"),
        ("CFO", "reports:view", "צפייה בדוחות הנהלה"),
        ("PROPERTY_MANAGER", "incidents:view", "צפייה באירועים בנכסים באחריותו"),
        ("PROPERTY_MANAGER", "incidents:create", "דיווח אירוע חדש"),
        ("PROPERTY_MANAGER", "mitigation:view", "צפייה במשימות מיטיגציה"),
        ("PROPERTY_MANAGER", "mitigation:update_status", "עדכון סטטוס משימת מיטיגציה"),
        ("FIELD_WORKER", "incidents:create", "דיווח אירוע חדש מהשטח"),
        ("FIELD_WORKER", "incidents:view_own", "צפייה באירועים שדווחו על ידו"),
        ("FIELD_WORKER", "media:upload", "העלאת תמונות/וידאו לאירוע"),
        ("ADMIN", "users:manage", "ניהול משתמשים והרשאות"),
        ("ADMIN", "audit_log:view", "צפייה ביומן הביקורת"),
        ("ADMIN", "roles:manage", "ניהול תפקידים והרשאות"),
        ("RISK_OFFICER", "incidents:view", "צפייה בכל האירועים"),
        ("RISK_OFFICER", "incidents:classify", "סיווג אירוע (AI/ידני)"),
        ("RISK_OFFICER", "risk_profiles:edit", "עריכת פרופיל סיכון נכס"),
        ("ADJUSTER", "claims:view", "צפייה בתביעות משויכות"),
        ("ADJUSTER", "claims:edit", "עדכון פרטי תביעה"),
        ("ADJUSTER", "documents:upload", "העלאת דוחות שמאי ומסמכים"),
    ]
    cur.executemany(
        "INSERT INTO Role_Permissions (role, permission_key, description) VALUES (?, ?, ?)",
        role_permissions,
    )

    # --- Audit_Log ---
    audit_log = [
        (1, "Incident", 1, "CREATE", None, '{"status":"NEW"}', "10.0.0.15"),
        (1, "Incident", 1, "UPDATE", '{"status":"NEW"}', '{"status":"CLAIM_FILED"}', "10.0.0.15"),
        (2, "Claim", 1, "UPDATE", '{"claim_status":"SUBMITTED"}', '{"claim_status":"APPROVED"}', "10.0.0.22"),
        (7, "Insurance_Policy", 1, "UPDATE", '{"status":"PENDING_RENEWAL"}', '{"status":"ACTIVE"}', "10.0.0.5"),
        (3, "Mitigation_Task", 1, "CREATE", None, '{"status":"OPEN"}', "10.0.0.31"),
        (9, "Claim", 3, "UPDATE", '{"claim_status":"IN_ADJUSTMENT"}', '{"claim_status":"APPROVED"}', "10.0.0.44"),
        (7, "User", 8, "CREATE", None, '{"role":"RISK_OFFICER"}', "10.0.0.5"),
        (6, "Incident", 26, "CREATE", None, '{"status":"NEW","is_draft":true}', "10.0.0.61"),
    ]
    cur.executemany(
        """INSERT INTO Audit_Log (user_id, entity_type, entity_id, action, old_value, new_value, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        audit_log,
    )

    # --- Documents ---
    documents = [
        ("POLICY", 1, "https://storage.rmis-demo.local/policies/POL-2026-CENTRAL.pdf", "POLICY_DOCUMENT", 1),
        ("POLICY", 2, "https://storage.rmis-demo.local/policies/POL-2026-NORTH.pdf", "POLICY_DOCUMENT", 1),
        ("POLICY", 4, "https://storage.rmis-demo.local/policies/POL-2026-BI.pdf", "POLICY_DOCUMENT", 1),
        ("CLAIM", 1, "https://storage.rmis-demo.local/claims/CLM-2025-01-report.pdf", "ADJUSTER_REPORT", 9),
        ("CLAIM", 3, "https://storage.rmis-demo.local/claims/CLM-2025-08-report.pdf", "ADJUSTER_REPORT", 9),
        ("CLAIM", 2, "https://storage.rmis-demo.local/claims/CLM-2025-04-correspondence.pdf", "CORRESPONDENCE", 1),
        ("INCIDENT", 4, "https://storage.rmis-demo.local/incidents/INC-2025-004-photo1.jpg", "PHOTO", 6),
        ("INCIDENT", 8, "https://storage.rmis-demo.local/incidents/INC-2025-008-photo1.jpg", "PHOTO", 6),
        ("PROPERTY", 1, "https://storage.rmis-demo.local/properties/PRP-001-survey.pdf", "SURVEY_REPORT", 8),
        ("PROPERTY", 7, "https://storage.rmis-demo.local/properties/PRP-007-survey.pdf", "SURVEY_REPORT", 8),
    ]
    cur.executemany(
        """INSERT INTO Documents (entity_type, entity_id, s3_url, doc_type, uploaded_by)
           VALUES (?, ?, ?, ?, ?)""",
        documents,
    )

    # --- Financial_Statements ---
    # Columns: year, total_assets, revenue, net_income, insurance_expense,
    #          total_liabilities, total_equity, gross_profit, operating_profit
    # total_equity = total_assets - total_liabilities (kept consistent so the
    # balance sheet actually balances); gross/operating profit sit between
    # revenue and net_income (gross > operating > net, per the usual P&L waterfall).
    financial_statements = [
        (2022, 620000000, 210000000, 18000000, 2400000, 380000000, 240000000, 92000000, 28000000),
        (2023, 680000000, 235000000, 21000000, 2650000, 410000000, 270000000, 103000000, 32000000),
        (2024, 730000000, 258000000, 19500000, 2900000, 440000000, 290000000, 112000000, 30500000),
        (2025, 790000000, 279000000, 23800000, 3150000, 465000000, 325000000, 122000000, 37000000),
        (2026, 845000000, 298000000, 26200000, 3560000, 490000000, 355000000, 131000000, 41000000),
    ]
    cur.executemany(
        """INSERT INTO Financial_Statements
           (year, total_assets, revenue, net_income, insurance_expense,
            total_liabilities, total_equity, gross_profit, operating_profit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        financial_statements,
    )

    # --- Notification_Recipients ---
    # Migrates the previous hardcoded services/notifications.DEFAULT_RECIPIENTS list
    # into the DB (same routing behavior: risk manager sees every alert on EMAIL+PUSH,
    # CFO only critical ones on EMAIL+SMS).
    notification_recipients = [
        ("risk_manager", "מנהל הסיכונים", "risk.manager@example-rmis.local", "+972-50-000-0001", "EMAIL,PUSH", "warning", 1),
        ("cfo", "סמנכ\"ל הכספים (CFO)", "cfo@example-rmis.local", "+972-50-000-0002", "EMAIL,SMS", "critical", 1),
    ]
    cur.executemany(
        """INSERT INTO Notification_Recipients
           (role, display_name, email, phone, channels, min_severity, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        notification_recipients,
    )

    conn.commit()
    print("Seed data loaded successfully.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    run()
