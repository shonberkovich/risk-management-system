# ARCHITECTURE — תיעוד ארכיטקטורה טכני מפורט

מסמך זה הוא רפרנס ארכיטקטורה מפורט ל-RMIS, משלים ל-[docs/README.md](./README.md) (שנשאר מבוא/רציונל) ול-[docs/erd.md](./erd.md) (שנשאר ה-ERD העצמאי). כאן הדגש הוא: שכבות המערכת, שרשרת הערך של מודל הנתונים, שכבת ה-AI, ארכיטקטורת האבטחה, סנכרון offline, ושכבת האינטגרציות — עם תרשימי Mermaid. נבנה ע"י קריאה ישירה של `backend/app/models.py`, `backend/app/dependencies/permissions.py`, ו-`backend/app/routers/*.py` (לא הועתק מ-erd.md/README.md בלי אימות — ראו הערת "סטיות שהתגלו" בסוף כל סעיף רלוונטי).

## 1. שכבות המערכת (System Layers)

```mermaid
flowchart TB
    subgraph Client["דפדפן (PWA, RTL)"]
        UI["React 18 + TypeScript + Vite<br/>MUI v6 · React Query · React Router · Leaflet · Recharts"]
        IDB[("IndexedDB<br/>rmis-offline")]
        SW["syncQueue.ts<br/>(תור סנכרון offline)"]
        UI --> SW
        SW <--> IDB
    end

    subgraph Backend["Backend — Python 3.12 / FastAPI"]
        MW["Middleware:<br/>CORS → HTTPS-redirect (force_https) → AuditLogMiddleware"]
        R["20 Routers<br/>(routers/*.py)"]
        DEP["dependencies/permissions.py<br/>get_current_user · require_roles(...)"]
        SVC["Services<br/>kpi · cashflow · retention · simulation ·<br/>financials · compliance · notifications ·<br/>storage · auth · encryption · llm"]
        INT["integrations/<br/>erp · gis · weather · economics<br/>(מסומלות, simulate=True)"]
        MW --> R
        R --> DEP
        R --> SVC
        SVC --> INT
    end

    subgraph DB["SQL Server LocalDB — RiskDB"]
        ORM["SQLAlchemy 2.0 ORM<br/>models.py"]
        TBL[("20 טבלאות<br/>NVARCHAR/Unicode · FK מלא · שדות מוצפנים")]
        ORM --> TBL
    end

    subgraph AI["Anthropic Claude API"]
        Claude["claude-opus-5<br/>(settings.anthropic_model)"]
    end

    UI -- "axios, REST/JSON<br/>Authorization: Bearer JWT<br/>proxy /api → :8000" --> MW
    R -- "pyodbc (ODBC Driver 17)" --> ORM
    SVC -- "client.messages.parse() / .stream()<br/>client.beta.messages.tool_runner()" --> Claude

    style Client fill:#eef,stroke:#557
    style Backend fill:#efe,stroke:#575
    style DB fill:#fee,stroke:#755
    style AI fill:#ffe,stroke:#775
```

**זרימת בקשה טיפוסית** (למשל שמירת פרופיל סיכון לנכס):
`React component` → `frontend/src/api/client.ts` (axios, טיפוסי TS שמראים את `schemas.py`) → `PUT /api/properties/{id}/risk-profile` (`routers/risk_profiles.py`) → `Depends(require_roles(*_RISK_PROFILE_WRITE_ROLES))` בודק JWT+תפקיד → SQLAlchemy ORM (`models.AssetRiskProfile`) → `UPDATE` ב-`RiskDB` דרך pyodbc → `AuditLogMiddleware` רושם שורת ביקורת מוצפנת ל-`Audit_Log` → תשובת JSON חוזרת ל-React, מעדכנת את ה-cache של React Query.

## 2. שרשרת הערך של מודל הנתונים (Value-Chain Schema)

השרשרת המרכזית שסביבה בנוי הסכימה כולה:

```
Properties → Asset_Risk_Profiles → Incidents → Claims → Claim_Payments (+ Claim_Reserves)
```

בצירוף שני מסלולים לא-ליניאריים: `Insurance_Policies ↔ Properties` דרך טבלת קישור many-to-many `Policy_Assets`, ו-`Mitigation_Tasks` כענף עצמאי היוצא מ-`Properties` (ניהול תחזוקה מונעת + חישוב ROI).

### ERD מלא (מאומת מול `backend/app/models.py`, 2026-08-21)

> **הערת עדכניות:** תרשים זה נבדק שדה-שדה מול `models.py` בעת כתיבת מסמך זה ונמצא **תואם במלואו** ל-20 הטבלאות והעמודות הקיימות בפועל (כולל `Notification_Recipients`/`Notification_Log` שנוספו לאחרונה) — [docs/erd.md](./erd.md) כבר עודכן נכון וללא סטיות ב-schema עצמו. ההעתק כאן הוא כדי שמסמך הארכיטקטורה יהיה עצמאי (לא תלוי בקריאת קובץ נוסף); erd.md נשאר מקור ה-ERD הרשמי אם השניים ייסטו בעתיד.

```mermaid
erDiagram
    Users ||--o{ Properties : "מנהל אחראי"
    Users ||--o{ Incidents : "מדווח"
    Users ||--o{ Mitigation_Tasks : "אחראי"
    Users ||--o{ Audit_Log : "ביצע פעולה"
    Users ||--o{ Documents : "העלה"

    Regions ||--o{ Properties : "אזור"

    Properties ||--o| Asset_Risk_Profiles : "פרופיל סיכון"
    Properties ||--o{ Incidents : "אירועים"
    Properties ||--o{ Mitigation_Tasks : "משימות מיטיגציה"
    Properties }o--o{ Insurance_Policies : "Policy_Assets"

    Insurance_Policies ||--o{ Claims : "תביעות"
    Incidents ||--o{ Claims : "תביעות"
    Incidents ||--o{ Incident_Media : "מדיה"
    Claims ||--o{ Claim_Payments : "תקבולים"
    Claims ||--o{ Claim_Reserves : "רזרבות"

    Properties {
        bigint property_id PK
        nvarchar property_code UK
        nvarchar name
        nvarchar address
        nvarchar region "מחרוזת חופשית, היסטורי"
        bigint region_id FK
        decimal latitude
        decimal longitude
        nvarchar asset_type
        decimal replacement_value
        decimal book_value
        bigint primary_manager_id FK
        bit is_active
        datetime created_at
        datetime updated_at
    }

    Regions {
        bigint region_id PK
        nvarchar region_code UK
        nvarchar name
    }

    Asset_Risk_Profiles {
        bigint profile_id PK
        bigint property_id FK
        date survey_date
        tinyint flood_risk_score
        tinyint fire_risk_score
        tinyint earthquake_risk_score
        decimal mfl_amount
        bit has_sprinklers
        nvarchar notes
    }

    Insurance_Policies {
        bigint policy_id PK
        nvarchar policy_number UK
        nvarchar insurer_name
        date start_date
        date end_date
        decimal total_limit
        decimal deductible_default
        decimal annual_premium
        nvarchar status
        nvarchar per_event_limit "מוצפן at-rest"
        smallint bi_waiting_period_hours
        nvarchar exclusions
    }

    Policy_Assets {
        bigint policy_id PK_FK
        bigint property_id PK_FK
        nvarchar specific_deductible "מוצפן at-rest"
    }

    Incidents {
        bigint incident_id PK
        nvarchar incident_code UK
        bigint property_id FK
        bigint reported_by_user_id FK
        datetime incident_timestamp
        nvarchar hazard_type
        nvarchar severity_level
        nvarchar operational_impact
        decimal initial_estimated_loss
        nvarchar description
        nvarchar status
        bit ai_classified
        decimal ai_confidence
        datetime created_at
        bit is_draft
        bit business_interruption_requested
        nvarchar area_or_building
        nvarchar reported_coordinates
    }

    Incident_Media {
        bigint media_id PK
        bigint incident_id FK
        nvarchar file_path
        nvarchar file_type
        datetime captured_at
        float gps_latitude
        float gps_longitude
    }

    Claims {
        bigint claim_id PK
        nvarchar claim_number UK
        bigint incident_id FK
        bigint policy_id FK
        decimal claimed_amount
        decimal deductible_applied
        decimal approved_amount
        nvarchar claim_status
        nvarchar adjuster_name "מוצפן at-rest"
        date expected_payment_date
        datetime created_at
    }

    Claim_Payments {
        bigint payment_id PK
        bigint claim_id FK
        date payment_date
        decimal amount
        nvarchar reference_number "מוצפן at-rest"
        nvarchar payment_type
    }

    Claim_Reserves {
        bigint reserve_id PK
        bigint claim_id FK
        decimal reserve_amount
        date expected_payment_date
        datetime updated_at
    }

    Mitigation_Tasks {
        bigint task_id PK
        bigint property_id FK
        nvarchar title
        decimal cost_estimate
        decimal expected_annual_savings
        date due_date
        nvarchar status
        bigint assigned_to_user_id FK
        datetime created_at
    }

    Users {
        bigint user_id PK
        nvarchar full_name
        nvarchar email UK
        nvarchar role "RISK_MANAGER/RISK_OFFICER/PROPERTY_MANAGER/CFO/ADJUSTER/ADMIN/FIELD_WORKER"
        nvarchar password_hash
        bit is_active
        datetime created_at
    }

    Audit_Log {
        bigint log_id PK
        bigint user_id FK "nullable"
        nvarchar entity_type
        bigint entity_id
        nvarchar action "CREATE/UPDATE/DELETE"
        nvarchar old_value "מוצפן at-rest"
        nvarchar new_value "מוצפן at-rest"
        datetime timestamp
        nvarchar ip_address
    }

    Role_Permissions {
        bigint role_permission_id PK
        nvarchar role
        nvarchar permission_key
        nvarchar description
    }

    Documents {
        bigint document_id PK
        nvarchar entity_type "policy/claim/property/incident"
        bigint entity_id "פוליארפי"
        nvarchar s3_url
        nvarchar doc_type
        bigint uploaded_by FK
        datetime uploaded_at
    }

    Financial_Statements {
        bigint statement_id PK
        smallint year UK
        decimal total_assets
        decimal revenue
        decimal net_income
        decimal insurance_expense
        decimal total_liabilities "nullable"
        decimal total_equity "nullable"
        decimal gross_profit "nullable"
        decimal operating_profit "nullable"
    }

    Notification_Recipients {
        bigint recipient_id PK
        nvarchar role
        nvarchar display_name
        nvarchar email
        nvarchar phone
        nvarchar channels "CSV: EMAIL/SMS/PUSH"
        nvarchar min_severity
        bit is_active
    }

    Notification_Log {
        bigint log_id PK
        nvarchar alert_type
        nvarchar severity
        nvarchar recipient_role
        nvarchar recipient_name
        nvarchar channel
        nvarchar contact
        nvarchar title
        nvarchar message
        nvarchar property_ids "CSV"
        decimal value
        decimal threshold
        nvarchar status "simulated"
        datetime sent_at
    }
```

### הערות מפתח לגבי הסכימה

- **`Policy_Assets`** היא טבלת קישור many-to-many אמיתית (PK מורכב `policy_id`+`property_id`) עם עמודת `specific_deductible` מוצפנת משלה, הדורסת את `deductible_default` של הפוליסה לנכס ספציפי.
- **`region` מול `region_id`**: `Properties.region` הוא שדה טקסט חופשי היסטורי; `region_id` (FK ל-`Regions`) הוא מבנה חדש יותר לדוח `GET /api/analytics/exposure-by-region`. שני שדות "אזור" שונים במכוון, ראו erd.md.
- שלוש טבלאות עצמאיות ללא FK כלל: `Financial_Statements`, `Notification_Recipients`, `Notification_Log` — כולן טבלאות תומכות/עצמאיות שאינן חלק משרשרת הערך הפיזית.
- **התראות סף** (`GET /api/analytics/alerts`, `services/kpi.py::calculate_alerts`) ו-**VaR/Monte Carlo** (`services/simulation.py`) ו-**מחשבון השתתפות עצמית** (`services/retention.py`) מחושבים "on the fly" מנתונים קיימים — אין להם טבלת תוצאות/ישות ב-ERD.

## 3. שכבת ה-AI (`routers/ai.py` + `services/llm.py`)

```mermaid
flowchart LR
    U["משתמש (UI)"] -->|"POST /api/ai/classify-incident"| C1["classify_incident()"]
    U -->|"GET /api/ai/executive-summary"| C2["stream_executive_summary()"]
    U -->|"POST /api/ai/ask"| C3["ask_question()"]

    RL["enforce_ai_rate_limit<br/>(rate_limit.py, IP-keyed, in-memory)"]
    U -.-> RL
    RL -.-> C1
    RL -.-> C2
    RL -.-> C3

    C1 -->|"client.messages.parse()<br/>Structured Outputs, Pydantic schema"| Claude1["claude-opus-5"]
    C2 -->|"client.messages.stream()<br/>KPIs נשלפים חיים מ-kpi.py"| Claude2["claude-opus-5"]
    C3 -->|"client.beta.messages.tool_runner()"| Claude3["claude-opus-5"]

    Claude3 -.->|"בוחר כלי + פרמטרים בלבד<br/>(לעולם לא SQL חופשי)"| T["5 כלים קבועים:<br/>get_kpis · query_properties ·<br/>query_claims · query_incidents ·<br/>query_mitigation_tasks"]
    T --> DB[("RiskDB")]

    Claude1 --> Out1["IncidentClassification<br/>(hazard_type, severity_level,<br/>operational_impact, אומדן נזק, הסבר, ביטחון)"]
    Claude2 --> Out2["טקסט מוזרם (streaming)<br/>תקציב מנהלים בעברית"]
    Claude3 --> Out3["תשובה בשפה טבעית<br/>מבוססת נתוני RiskDB בלבד"]
```

- **סיווג אירוע** (`POST /api/ai/classify-incident`) — `client.messages.parse()` מבטיח JSON תקין תמיד מול סכימת Pydantic (`llm.IncidentClassification`); ה-UI מציג את התוצאה כברת-עריכה, לא כופה.
- **דוח הנהלה** (`GET /api/ai/executive-summary`) — `client.messages.stream()`, מוגש כ-`StreamingResponse` בטקסט; שולף KPIs חיים לפני הפנייה למודל.
- **שאלות בשפה טבעית** (`POST /api/ai/ask`) — מאובטח בעיצוב: **חמישה כלים קבועים ופרמטריים בלבד** (`get_kpis`, `query_properties`, `query_claims`, `query_incidents`, `query_mitigation_tasks` — ב-`services/llm.py`), Claude בוחר כלי+פרמטרים דרך `client.beta.messages.tool_runner()`; אין נתיב שבו טקסט מהמשתמש הופך לביטוי SQL.
- **מודל:** `settings.anthropic_model` (ברירת מחדל `claude-opus-5`, ניתן לשינוי ב-`.env`).
- **Graceful degradation:** כל שלושת ה-endpoints קוראים ל-`_require_api_key()` בתחילת הפונקציה — ללא `ANTHROPIC_API_KEY` ב-`backend/.env` מוחזר `503` נקי במקום קריסה.
- **Rate limiting:** `router = APIRouter(..., dependencies=[Depends(enforce_ai_rate_limit), Depends(require_roles())])` — מגביל לפי IP (חלון-זמן קבוע, מונה בזיכרון תהליך, `services/rate_limit.py`) וגם מחייב התחברות (כל תפקיד), כדי להגן על מפתח ה-API מפני הצפה ומפני קוראים לא-מזוהים.

> **תוקן (branch `feature/ai-endpoints-require-auth`):** README תיעד מאז ומתמיד את `ai.py` כ"authenticated" ב-RBAC, אך עד לאחרונה בפועל **לא היה כלל `Depends(require_roles(...))` או `Depends(get_current_user)`** על אף אחד משלושת ה-endpoints — הבדיקה היחידה הייתה rate-limit לפי IP, כך ששלושת ה-endpoints היו פתוחים לכל קורא (גם לא-מחובר), בכפוף למכסת הקצב. נוסף `Depends(require_roles())` (כל תפקיד, לא מוגבל) ל-`router` כולו — עכשיו תואם בפועל למה שתמיד תועד ב-README ובמטריצת ההרשאות (ROLES_MATRIX.md).

## 4. ארכיטקטורת אבטחה (Security)

```mermaid
flowchart TB
    Login["POST /api/auth/login<br/>(email + password)"] -->|"verify_password()<br/>PBKDF2-HMAC-SHA256, 260K iterations,<br/>salt אקראי per-user"| Check{"תקין?"}
    Check -->|כן| Issue["create_access_token() + create_refresh_token()<br/>JWT HS256, settings.jwt_secret_key"]
    Check -->|לא| Fail["401"]
    Issue --> Access["Access token (קצר-טווח)<br/>Authorization: Bearer"]
    Issue --> Refresh["Refresh token (ארוך-טווח)<br/>POST /api/auth/refresh להחלפה"]

    Access --> GCU["get_current_user()<br/>decode_token() → מנסה jwt_secret_key<br/>ואז כל jwt_previous_secret_keys_list בתור"]
    GCU --> Active{"user.is_active?"}
    Active -->|לא| Reject["401 — נאכף גם על טוקן שכבר הונפק,<br/>לא רק בהתחברות הבאה"]
    Active -->|כן| RR["require_roles(*roles)<br/>403 אם role לא ברשימה<br/>() ריק = כל מחובר"]

    subgraph Encryption["הצפנת שדות at-rest (services/encryption.py)"]
        Fernet["MultiFernet([current_key, *previous_keys])<br/>AES-128-CBC + HMAC"]
        Cols["Insurance_Policies.per_event_limit<br/>Policy_Assets.specific_deductible<br/>Claims.adjuster_name<br/>Claim_Payments.reference_number<br/>Audit_Log.old_value / new_value"]
        Fernet --> Cols
    end

    HTTPS["https_redirect middleware<br/>force_https (כבוי כברירת מחדל, מיועד ל-reverse proxy)"]
    CORS["CORSMiddleware<br/>allow_origins מוגבל (לעולם לא '*' עם allow_credentials)"]
    Audit["AuditLogMiddleware<br/>רושם כל POST/PUT/PATCH/DELETE ל-/api/*<br/>(old_value/new_value מוצפנים)"]
```

### 4.1 JWT + סבב מפתחות (rotation)
`services/auth.py`: סיסמאות נשמרות כ-`PBKDF2-HMAC-SHA256` (260,000 איטרציות, salt אקראי 16 בייט לכל משתמש) — לא bcrypt, כדי להימנע מ-toolchain C בסביבת קורס/Windows. JWT חתום ב-HS256. שני סוגי טוקן: `access` (קצר-טווח, נשלח בכל בקשה) ו-`refresh` (ארוך-טווח, מוחלף דרך `POST /api/auth/refresh`). **סבב מפתחות:** `decode_token` מנסה את `settings.jwt_secret_key` הנוכחי, ואם נכשל — עובר על `settings.jwt_previous_secret_keys_list` בתור; `_create_token` תמיד חותם עם המפתח הנוכחי בלבד. כך סבב מפתח לא מנתק מיידית משתמשים מחוברים — טוקנים שהונפקו לפני הסבב ממשיכים להיות מאומתים עד שפגים באופן טבעי. אין רשימת ביטול (revocation list) בצד השרת — `logout` הוא no-op לוגי בלבד, טרייד-אוף מקובל לדמו קורס עם JWT חסר-מצב (stateless).

### 4.2 הצפנת שדות at-rest + סבב מפתחות
`services/encryption.py`: `Fernet`/`MultiFernet` (מ-`cryptography`, AES-128-CBC+HMAC) מוחל **רק** על עמודות שאף פעם לא מסוכמות/ממוצעות ב-SQL (בניגוד ל-`Claim_Payments.amount`, `annual_premium` וכו', שנשארים לא-מוצפנים כי `services/kpi.py`/`financials.py` מבצעים עליהם `SUM`/`AVG` ישירות ב-SQL Server). חמש עמודות מוצפנות כיום: `Insurance_Policies.per_event_limit`, `Policy_Assets.specific_deductible`, `Claims.adjuster_name`, `Claim_Payments.reference_number`, `Audit_Log.old_value`/`new_value`. מומש כ-`TypeDecorator` (`EncryptedString`/`EncryptedText`) — קוד היישום קורא/כותב מחרוזות רגילות, ההצפנה/פענוח שקופים. **סבב מפתחות:** אותו דפוס כמו JWT — `MultiFernet([current_key, *previous_keys])`, כתיבה תמיד עם המפתח הנוכחי (הראשון), קריאה מנסה כל מפתח ברשימה. שורות שנכתבו לפני הכנסת ההצפנה (טקסט גלוי) נסבלות בקריאה: כישלון פענוח (`InvalidToken`) מחזיר את הערך הגולמי כמות שהוא, ללא שגיאה.

### 4.3 RBAC — `require_roles`
`dependencies/permissions.py`: `require_roles()` ללא ארגומנטים = "מחייב התחברות בלבד, כל תפקיד"; עם ארגומנטים = בדיקת השתייכות ל-`roles` (403 אחרת). נאכף ברמת endpoint בודד (`Depends(...)`) ברוב ה-routers על כל בקשת כתיבה (POST/PUT/PATCH/DELETE), וכן על קבוצת GET שמחשיפה מידע פיננסי (KPIs, cashflow, exposure, policies — ראו ROLES_MATRIX.md לפירוט המלא לפי router). endpoint ללא `Depends(require_roles(...))` כלל = פתוח לחלוטין, גם ללא התחברות — עדיין נכון עבור `simulation.py`, `retention.py`, ורוב ה-GET-ים של `analytics.py` (map/risk-matrix/alerts/hazard-distribution) שנשארים פתוחים במכוון (ר' ROLES_MATRIX.md). `ai.py` (ר' §3) **כבר אינו** ברשימה הזו — תוקן להשתמש ב-`Depends(require_roles())`.

### 4.4 force_https
`main.py`: middleware מותנה-קונפיגורציה (`settings.force_https`, כבוי כברירת מחדל) — מפנה `http`→`https` (308) לפי `X-Forwarded-Proto`, מיועד לפריסה מאחורי reverse proxy שמסיים TLS (אין תעודת TLS מקומית ב-`uvicorn --reload`).

### 4.5 Audit Log
`middleware/audit.py::AuditLogMiddleware` רושמת אוטומטית כל `POST`/`PUT`/`PATCH`/`DELETE` ל-`/api/*` לטבלת `Audit_Log` (כולל `old_value`/`new_value` מוצפנים — ה-payload יכול לכלול בעצמו שדות רגישים, למשל יצירת משתמש). נקראת רק דרך `GET /api/audit-log`, המוגבל ל-`ADMIN` בלבד גם לקריאה (היוצא-מן-הכלל המכוון ברשימת ה-GET הפתוחים).

## 5. ארכיטקטורת סנכרון Offline (`frontend/src/offline/syncQueue.ts`)

```mermaid
flowchart LR
    Form["טופס דיווח שטח<br/>IncidentReport.tsx"] -->|"אין רשת"| Q["syncQueue.ts::enqueue*"]
    Q -->|"IndexedDB<br/>DB: rmis-offline, store: incident-queue"| IDB[("IndexedDB")]

    Online["window 'online' event<br/>/ טעינת אפליקציה"] --> Try["trySync()"]
    Try -->|"FIFO, פעולה אחת בכל פעם<br/>עוצר בכשלון ראשון"| Run["runOperation()"]
    Run --> API["axios → REST API"]
    API -->|"הצלחה"| Remove["removeFromQueue()"]
    API -->|"כשלון"| Stop["עצירה + recordFailure()<br/>נסיון חוזר בטריגר הבא"]

    IDB --> Try
```

ארבעה סוגי פעולה מכסים את מחזור החיים המלא של דיווח אירוע offline: `create` (הגשה חדשה או שמירת טיוטה ראשונה — שתיהן צריכות את מלוא ה-payload כי אין עוד `id` בצד השרת), `draft-update` (עריכת טיוטה שכבר נוצרה online), `draft-submit` (סופי-מסירה של טיוטה קיימת — נמנע מיצירת אירוע כפול), `media` (צירוף תמונות לאירוע קיים שהעלאתו נכשלה). `registerAutoSync()` (נקרא פעם אחת מ-`main.tsx`) מפעיל סנכרון גם באירוע `online` וגם בטעינת האפליקציה אם כבר מחוברים. הסנכרון סדרתי-מכוון (FIFO, פעולה אחת בכל פעם, עוצר בכשלון ראשון) כדי לא "לשרוף" ניסיונות מחוץ לסדר במכשיר עדיין-offline/לא-יציב.

## 6. שכבת אינטגרציות (`backend/app/integrations/`)

ארבעה מודולים, **כולם מסומלים** (`simulate=True`) — אין credentials/API keys אמיתיים לספקים חיצוניים בסביבת הדמו:

| מודול | תפקיד | נחשף דרך |
|---|---|---|
| `erp.py` | שווי ספרים (book values) מדומה + רישום קבלות תביעה (posting) ל-ERP מדומה | `GET /api/integrations/erp/book-values`, `POST /api/integrations/erp/post-claim-receipts` |
| `gis.py` | שכבות סיכון גיאוגרפיות מדומות (הצפה/אקלים) | `GET /api/integrations/gis/risk-layers` |
| `weather.py` | התראות מזג-אוויר מדומות | `GET /api/integrations/weather/alerts` (פתוח לכל מחובר) |
| `economics.py` | מדדים כלכליים + עדכוני שווי החלפה מדומים | `GET /api/integrations/economics/index-series`, `/economics/replacement-value-updates` |

כל מודול נכתב כך שקל להחליף בקריאת HTTP אמיתית ביום שיהיו פרטי חיבור אמיתיים (ראו docs/README.md §9 לרשימת "מה מחוץ להיקף" המלאה — כולל שליחת Email/SMS/Push אמיתית, אחסון S3/Blob אמיתי, SSO/OAuth2 אמיתי).

## 7. הפניות

- [docs/README.md](./README.md) — רקע, רציונל, קטלוג endpoints ברמת router, הרצה מקומית, מלכודות פיתוח.
- [docs/erd.md](./erd.md) — ה-ERD הרשמי (מקור אמת לתרשים בפני עצמו) + הרחבות טקסטואליות לכל טבלה.
- [ROLES_MATRIX.md](./ROLES_MATRIX.md) — מטריצת הרשאות read/write לכל תפקיד מול כל router, נגזרת ישירות מ-`require_roles(...)` בקוד.
- [backend/app/models.py](../backend/app/models.py) — מקור האמת למודל ה-ORM.
- [backend/sql/schema.sql](../backend/sql/schema.sql) — מקור האמת ל-DDL על DB חדש.
