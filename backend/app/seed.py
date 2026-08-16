"""Seed the RiskDB database with demo data.

Run directly: python -m app.seed
Uses parameterized pyodbc inserts so Hebrew (Unicode) text round-trips
correctly regardless of console/file codepage issues that affect sqlcmd.
"""
import pyodbc

from app.database import get_connection_string


def run():
    conn = pyodbc.connect(get_connection_string())
    conn.autocommit = False
    cur = conn.cursor()

    # --- clean slate (children first) ---
    for table in [
        "Claim_Payments", "Claims", "Incident_Media", "Incidents",
        "Policy_Assets", "Mitigation_Tasks", "Asset_Risk_Profiles",
        "Insurance_Policies", "Properties", "Users",
    ]:
        cur.execute(f"DELETE FROM {table}")
    for table in [
        "Properties", "Asset_Risk_Profiles", "Insurance_Policies",
        "Incidents", "Claims", "Claim_Payments", "Mitigation_Tasks", "Users",
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
    ]
    cur.executemany(
        "INSERT INTO Users (full_name, email, role) VALUES (?, ?, ?)", users
    )

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
           (property_code, name, address, region, latitude, longitude, asset_type,
            replacement_value, book_value, primary_manager_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        properties,
    )

    # --- Asset_Risk_Profiles ---
    profiles = [
        (1, "2025-11-15", 4, 3, 2, 18000000, 1, "מבנה סמוך לנחל, נצפה סיכון הצפה בחורף"),
        (2, "2025-10-02", 2, 2, 3, 25000000, 1, "מגדל חדש, מערכות מיגון עדכניות"),
        (3, "2025-09-20", 3, 4, 2, 12000000, 0, "אין מתזים - המלצה להתקנה"),
        (4, "2025-12-01", 4, 3, 2, 16000000, 1, "קרבה לים - סיכון הצפה בגאות גבוהה"),
        (5, "2025-08-14", 2, 2, 3, 20000000, 1, "תקין"),
        (6, "2025-11-01", 1, 3, 3, 9000000, 0, "אזור מדברי - סיכון הצפה נמוך"),
        (7, "2025-07-22", 2, 4, 2, 22000000, 1, "עומס גבוה של מבקרים - סיכון אש מוגבר"),
        (8, "2025-10-18", 2, 2, 3, 28000000, 1, "מבנה חדיש עם גילוי עשן מתקדם"),
        (9, "2025-09-05", 3, 3, 2, 11000000, 0, "תחנת חלוקה - חשמל עתיק"),
        (10, "2025-12-10", 3, 3, 2, 15000000, 1, "תקין"),
        (11, "2025-06-30", 1, 4, 4, 8000000, 0, "אזור סיכון רעידות אדמה מוגבר (בקע סורי-אפריקני)"),
        (12, "2025-11-20", 2, 3, 4, 21000000, 1, "סמוך לקו תפר - רעידות אדמה"),
        (13, "2025-08-01", 4, 2, 2, 10000000, 1, "מחסן קירור - סיכון תקלה חשמלית"),
        (14, "2025-10-25", 2, 3, 2, 7000000, 0, "תחנת שנע - אין כיסוי מתזים"),
        (15, "2025-09-12", 2, 2, 3, 19000000, 1, "תקין"),
    ]
    cur.executemany(
        """INSERT INTO Asset_Risk_Profiles
           (property_id, survey_date, flood_risk_score, fire_risk_score, earthquake_risk_score,
            mfl_amount, has_sprinklers, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        profiles,
    )

    # --- Insurance_Policies ---
    policies = [
        ("POL-2026-CENTRAL", "הפניקס ביטוח", "2026-01-01", "2026-12-31", 200000000, 100000, 1850000, "ACTIVE"),
        ("POL-2026-NORTH", "כלל ביטוח", "2026-01-01", "2026-12-31", 90000000, 75000, 720000, "ACTIVE"),
        ("POL-2026-SOUTH", "מגדל ביטוח", "2026-01-01", "2026-12-31", 80000000, 75000, 610000, "ACTIVE"),
        ("POL-2026-BI", "הראל ביטוח - אובדן רווחים", "2026-01-01", "2026-12-31", 50000000, 50000, 380000, "ACTIVE"),
    ]
    cur.executemany(
        """INSERT INTO Insurance_Policies
           (policy_number, insurer_name, start_date, end_date, total_limit,
            deductible_default, annual_premium, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        policies,
    )

    policy_assets = [
        (1, 1, None), (1, 2, None), (1, 7, None), (1, 8, None), (1, 9, None),
        (1, 10, None), (1, 12, None), (1, 15, None),
        (2, 3, None), (2, 5, None), (2, 13, None), (2, 14, None),
        (3, 4, None), (3, 6, None), (3, 11, 100000),
        (4, 1, None), (4, 2, None), (4, 7, None),
    ]
    cur.executemany(
        "INSERT INTO Policy_Assets (policy_id, property_id, specific_deductible) VALUES (?, ?, ?)",
        policy_assets,
    )

    # --- Incidents ---
    incidents = [
        ("INC-2025-001", 1, 5, "2025-01-12 07:00", "FLOOD", "HIGH", "PARTIAL_SHUTDOWN", 450000,
         "פיצוץ בצינור מים ראשי בקומה 1 שגרם להצפה באזור האריזה. החשמל נותק באופן יזום.", "CLAIM_FILED", 1, 0.920),
        ("INC-2025-002", 3, 6, "2025-03-05 14:20", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 120000,
         'קצר חשמלי בלוח ראשי, עשן זוהה ע"י מערכת גילוי, כובה מיידית ע"י צוות אבטחה.', "UNDER_INVESTIGATION", 1, 0.870),
        ("INC-2025-003", 2, 5, "2025-04-18 09:15", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 85000,
         "סדק בתקרת קומה 12 התגלה בבדיקה שגרתית, נדרש תיקון.", "CLOSED", 0, None),
        ("INC-2025-004", 7, 6, "2025-05-02 22:40", "FIRE", "CRITICAL", "FULL_SHUTDOWN", 1200000,
         "שריפה פרצה בחנות בקומת הקרקע, התפשטה לחנויות סמוכות. כיבוי אש הגיע תוך 12 דקות.", "CLAIM_FILED", 1, 0.950),
        ("INC-2025-005", 4, 5, "2025-06-14 06:30", "THEFT", "MEDIUM", "PARTIAL_SHUTDOWN", 65000,
         "פריצה למחסן בשעות הלילה, נגנב ציוד אלקטרוני.", "CLOSED", 0, None),
        ("INC-2025-006", 9, 6, "2025-07-01 11:00", "ELECTRICAL", "LOW", "FULL_OPERATION", 18000,
         "תקלה בלוח חשמל משני, לא נגרם נזק משמעותי.", "CLOSED", 0, None),
        ("INC-2025-007", 6, 5, "2025-07-20 15:45", "FIRE", "MEDIUM", "PARTIAL_SHUTDOWN", 210000,
         'שריפה קטנה במחסן חומרי אריזה, כובתה ע"י צוות פנימי.', "UNDER_INVESTIGATION", 1, 0.810),
        ("INC-2025-008", 1, 6, "2025-08-09 03:20", "FLOOD", "CRITICAL", "FULL_SHUTDOWN", 980000,
         "הצפה חמורה בעקבות סופה, מים חדרו לקומת הקרקע ופגעו במלאי.", "CLAIM_FILED", 1, 0.930),
        ("INC-2025-009", 12, 5, "2025-08-22 10:10", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 42000,
         "סדקים קלים בקירות חוץ בעקבות רעידת אדמה קלה.", "CLOSED", 0, None),
        ("INC-2025-010", 5, 6, "2025-09-03 13:30", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 95000,
         'עלייה בטמפרטורת לוח חשמל ראשי, זוהה ע"י חיישן טמפרטורה.', "UNDER_INVESTIGATION", 1, 0.760),
        ("INC-2025-011", 11, 5, "2025-09-15 04:50", "STRUCTURAL_FAILURE", "HIGH", "PARTIAL_SHUTDOWN", 310000,
         "רעידת אדמה בעוצמה בינונית גרמה לסדקים במבנה.", "CLAIM_FILED", 0, None),
        ("INC-2025-012", 10, 6, "2025-10-01 08:00", "THEFT", "LOW", "FULL_OPERATION", 28000,
         "ניסיון פריצה נכשל, אזעקה הרתיעה את הפורצים.", "CLOSED", 0, None),
        ("INC-2025-013", 3, 5, "2025-10-14 19:20", "FIRE", "HIGH", "PARTIAL_SHUTDOWN", 340000,
         "שריפה במטבח מסעדה בקניון, התפשטה לתקרה.", "CLAIM_FILED", 1, 0.890),
        ("INC-2025-014", 13, 6, "2025-11-02 05:15", "ELECTRICAL", "CRITICAL", "FULL_SHUTDOWN", 560000,
         "כשל במערכת קירור עקב תקלה חשמלית, מלאי מזון קפוא ניזוק.", "CLAIM_FILED", 1, 0.900),
        ("INC-2025-015", 8, 5, "2025-11-20 16:40", "FLOOD", "LOW", "FULL_OPERATION", 22000,
         "נזילה קלה ממערכת מיזוג, נזק מינימלי לריצוף.", "CLOSED", 0, None),
        ("INC-2025-016", 2, 6, "2025-12-05 12:00", "OTHER", "LOW", "FULL_OPERATION", 15000,
         "נזק קל למעלית עקב תקלה טכנית.", "CLOSED", 0, None),
        ("INC-2026-001", 1, 5, "2026-01-12 07:00", "FLOOD", "HIGH", "PARTIAL_SHUTDOWN", 450000,
         "פיצוץ נוסף בצנרת מים בקומה 1, אזור דומה לאירוע קודם - נדרשת בדיקת תשתית.", "CLAIM_FILED", 1, 0.940),
        ("INC-2026-002", 9, 6, "2026-01-25 09:30", "ELECTRICAL", "MEDIUM", "PARTIAL_SHUTDOWN", 78000,
         "קצר בלוח חשמל ראשי בתחנת החלוקה.", "UNDER_INVESTIGATION", 1, 0.820),
        ("INC-2026-003", 4, 5, "2026-02-10 21:00", "THEFT", "HIGH", "PARTIAL_SHUTDOWN", 110000,
         "פריצה מאורגנת למחסן, נגנבו טובין בהיקף משמעותי.", "CLAIM_FILED", 1, 0.870),
        ("INC-2026-004", 7, 6, "2026-03-05 11:15", "STRUCTURAL_FAILURE", "LOW", "FULL_OPERATION", 38000,
         "התמוטטות חלקית של תקרה דקורטיבית, אין נפגעים.", "UNDER_INVESTIGATION", 0, None),
        ("INC-2026-005", 14, 5, "2026-03-22 06:00", "FIRE", "CRITICAL", "FULL_SHUTDOWN", 680000,
         "שריפה בתחנת שנע פגעה במלוא המבנה, נדרש שיקום מלא.", "CLAIM_FILED", 1, 0.960),
        ("INC-2026-006", 6, 6, "2026-04-08 14:00", "FLOOD", "MEDIUM", "PARTIAL_SHUTDOWN", 145000,
         "הצפה עקב גשמים כבדים, מים חדרו למחסן התחתון.", "UNDER_INVESTIGATION", 1, 0.850),
        ("INC-2026-007", 15, 5, "2026-05-01 08:45", "ELECTRICAL", "LOW", "FULL_OPERATION", 31000,
         "תקלה קלה בגנרטור גיבוי, טופלה במקום.", "CLOSED", 0, None),
        ("INC-2026-008", 5, 6, "2026-05-19 17:30", "OTHER", "LOW", "FULL_OPERATION", 12000,
         "נזק קל לחזית הבניין עקב סופת רוחות.", "CLOSED", 0, None),
        ("INC-2026-009", 12, 5, "2026-06-02 10:00", "STRUCTURAL_FAILURE", "MEDIUM", "PARTIAL_SHUTDOWN", 195000,
         "סדקים משמעותיים בעמודי תמך התגלו בבדיקה תקופתית.", "UNDER_INVESTIGATION", 0, None),
    ]
    cur.executemany(
        """INSERT INTO Incidents
           (incident_code, property_id, reported_by_user_id, incident_timestamp, hazard_type,
            severity_level, operational_impact, initial_estimated_loss, description, status,
            ai_classified, ai_confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        incidents,
    )

    # --- Claims (incident_id 1,4,8,11,13,14,17,19,21 map to CLAIM_FILED rows above) ---
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
    cur.executemany(
        """INSERT INTO Claims
           (claim_number, incident_id, policy_id, claimed_amount, deductible_applied,
            approved_amount, claim_status, adjuster_name, expected_payment_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        claims,
    )

    payments = [
        (1, "2026-07-20", 200000, "PMT-10021", "ADVANCE"),
        (1, "2026-08-15", 180000, "PMT-10088", "FINAL_SETTLEMENT"),
        (3, "2026-07-10", 400000, "PMT-10015", "ADVANCE"),
        (5, "2026-08-01", 300000, "PMT-10077", "FINAL_SETTLEMENT"),
        (8, "2026-08-25", 95000, "PMT-10099", "FINAL_SETTLEMENT"),
    ]
    cur.executemany(
        """INSERT INTO Claim_Payments (claim_id, payment_date, amount, reference_number, payment_type)
           VALUES (?, ?, ?, ?, ?)""",
        payments,
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

    conn.commit()
    print("Seed data loaded successfully.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    run()
