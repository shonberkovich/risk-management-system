-- ============================================================================
-- RMIS - Risk Management Information System
-- SQL Server schema (LocalDB compatible)
-- ============================================================================

IF DB_ID('RiskDB') IS NULL
BEGIN
    CREATE DATABASE RiskDB;
END
GO

USE RiskDB;
GO

-- ============================================================================
-- Drop all tables up front, in dependency order (children before parents),
-- so re-running this script is always safe regardless of FK constraints.
-- ============================================================================
IF OBJECT_ID('dbo.Email_Templates', 'U') IS NOT NULL DROP TABLE dbo.Email_Templates;
IF OBJECT_ID('dbo.Entity_Emails', 'U') IS NOT NULL DROP TABLE dbo.Entity_Emails;
IF OBJECT_ID('dbo.Email_Attachments', 'U') IS NOT NULL DROP TABLE dbo.Email_Attachments;
IF OBJECT_ID('dbo.Email_Recipients', 'U') IS NOT NULL DROP TABLE dbo.Email_Recipients;
IF OBJECT_ID('dbo.Emails', 'U') IS NOT NULL DROP TABLE dbo.Emails;
IF OBJECT_ID('dbo.Agent_Actions_Log', 'U') IS NOT NULL DROP TABLE dbo.Agent_Actions_Log;
IF OBJECT_ID('dbo.Agent_Sessions', 'U') IS NOT NULL DROP TABLE dbo.Agent_Sessions;
IF OBJECT_ID('dbo.Audit_Log', 'U') IS NOT NULL DROP TABLE dbo.Audit_Log;
IF OBJECT_ID('dbo.Role_Permissions', 'U') IS NOT NULL DROP TABLE dbo.Role_Permissions;
IF OBJECT_ID('dbo.Documents', 'U') IS NOT NULL DROP TABLE dbo.Documents;
IF OBJECT_ID('dbo.Financial_Statements', 'U') IS NOT NULL DROP TABLE dbo.Financial_Statements;
IF OBJECT_ID('dbo.Notification_Log', 'U') IS NOT NULL DROP TABLE dbo.Notification_Log;
IF OBJECT_ID('dbo.Notification_Recipients', 'U') IS NOT NULL DROP TABLE dbo.Notification_Recipients;
IF OBJECT_ID('dbo.Claim_Payments', 'U') IS NOT NULL DROP TABLE dbo.Claim_Payments;
IF OBJECT_ID('dbo.Claim_Reserves', 'U') IS NOT NULL DROP TABLE dbo.Claim_Reserves;
IF OBJECT_ID('dbo.Claims', 'U') IS NOT NULL DROP TABLE dbo.Claims;
IF OBJECT_ID('dbo.Incident_Media', 'U') IS NOT NULL DROP TABLE dbo.Incident_Media;
IF OBJECT_ID('dbo.Incidents', 'U') IS NOT NULL DROP TABLE dbo.Incidents;
IF OBJECT_ID('dbo.Policy_Assets', 'U') IS NOT NULL DROP TABLE dbo.Policy_Assets;
IF OBJECT_ID('dbo.Mitigation_Tasks', 'U') IS NOT NULL DROP TABLE dbo.Mitigation_Tasks;
IF OBJECT_ID('dbo.Asset_Risk_Profiles', 'U') IS NOT NULL DROP TABLE dbo.Asset_Risk_Profiles;
IF OBJECT_ID('dbo.Insurance_Policies', 'U') IS NOT NULL DROP TABLE dbo.Insurance_Policies;
IF OBJECT_ID('dbo.Properties', 'U') IS NOT NULL DROP TABLE dbo.Properties;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;
IF OBJECT_ID('dbo.Regions', 'U') IS NOT NULL DROP TABLE dbo.Regions;
GO

-- ============================================================================
-- Regions
-- ============================================================================
IF OBJECT_ID('dbo.Regions', 'U') IS NOT NULL DROP TABLE dbo.Regions;
GO
CREATE TABLE dbo.Regions (
    region_id       BIGINT IDENTITY(1,1) PRIMARY KEY,
    region_code     NVARCHAR(20) NOT NULL UNIQUE,
    name            NVARCHAR(100) NOT NULL
);
GO

-- ============================================================================
-- Users (minimal - for reported_by / assigned_to references)
-- ============================================================================
GO
CREATE TABLE dbo.Users (
    user_id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    full_name       NVARCHAR(100) NOT NULL,
    email           NVARCHAR(200) NOT NULL UNIQUE,
    role            NVARCHAR(30) NOT NULL
        CHECK (role IN ('RISK_MANAGER','CFO','PROPERTY_MANAGER','FIELD_WORKER','ADMIN','RISK_OFFICER','ADJUSTER')),
    password_hash   NVARCHAR(255) NULL,   -- pbkdf2_hmac "salt$hash" hex; NULL = no local password (SSO-only / not provisioned)
    is_active       BIT NOT NULL DEFAULT 1,   -- disabled users are rejected at login and on every existing token, see dependencies/permissions.get_current_user
    created_at      DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

-- ============================================================================
-- Properties
-- ============================================================================
IF OBJECT_ID('dbo.Properties', 'U') IS NOT NULL DROP TABLE dbo.Properties;
GO
CREATE TABLE dbo.Properties (
    property_id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    property_code        NVARCHAR(30) NOT NULL UNIQUE,
    name                 NVARCHAR(200) NOT NULL,
    address              NVARCHAR(300) NOT NULL,
    region               NVARCHAR(50) NOT NULL,           -- e.g. center/north/south
    region_id            BIGINT NULL REFERENCES dbo.Regions(region_id),
    latitude             DECIMAL(9,6) NOT NULL,
    longitude            DECIMAL(9,6) NOT NULL,
    asset_type           NVARCHAR(30) NOT NULL
        CHECK (asset_type IN ('LOGISTICS_CENTER','OFFICE_BUILDING','RETAIL','INFRASTRUCTURE')),
    replacement_value    DECIMAL(18,2) NOT NULL,
    book_value           DECIMAL(18,2) NOT NULL,
    primary_manager_id   BIGINT NULL REFERENCES dbo.Users(user_id),
    is_active            BIT NOT NULL DEFAULT 1,
    created_at           DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at           DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
-- TODO_SPEC.md "אינדקסים לביצועים" calls for a "spatial index (GIST)" on property
-- coordinates. GIST is a PostgreSQL/PostGIS index type; SQL Server's equivalent is a
-- SPATIAL INDEX, but that requires a geometry/geography-typed column, not the separate
-- latitude/longitude DECIMAL columns used here. Introducing a geography column would be
-- a materially bigger data-model change (ORM mapping, map/KPI services that currently
-- read lat/lng directly) than this task's scope. This composite B-tree index over
-- (latitude, longitude) already supports the actual query pattern in this codebase —
-- bounding-box/range lookups for the map and MFL geographic-clustering calc (see
-- services/kpi.py) — so it's kept as the practical equivalent instead.
CREATE INDEX IX_Properties_Coordinates ON dbo.Properties(latitude, longitude);
GO
CREATE INDEX IX_Properties_RegionId ON dbo.Properties(region_id);
GO
CREATE INDEX IX_Properties_PrimaryManager ON dbo.Properties(primary_manager_id);
GO

-- ============================================================================
-- Asset_Risk_Profiles
-- ============================================================================
IF OBJECT_ID('dbo.Asset_Risk_Profiles', 'U') IS NOT NULL DROP TABLE dbo.Asset_Risk_Profiles;
GO
CREATE TABLE dbo.Asset_Risk_Profiles (
    profile_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    property_id           BIGINT NOT NULL REFERENCES dbo.Properties(property_id),
    survey_date            DATE NOT NULL,
    flood_risk_score       TINYINT NOT NULL CHECK (flood_risk_score BETWEEN 1 AND 5),
    fire_risk_score         TINYINT NOT NULL CHECK (fire_risk_score BETWEEN 1 AND 5),
    earthquake_risk_score   TINYINT NOT NULL CHECK (earthquake_risk_score BETWEEN 1 AND 5),
    mfl_amount               DECIMAL(18,2) NOT NULL,
    has_sprinklers            BIT NOT NULL DEFAULT 0,
    notes                     NVARCHAR(MAX) NULL,
    near_hazmat_site          BIT NOT NULL DEFAULT 0    -- קרבה למפעל חומרים מסוכנים (ר' app/integrations/environmental.py)
);
GO
CREATE INDEX IX_RiskProfiles_Property ON dbo.Asset_Risk_Profiles(property_id);
GO

-- ============================================================================
-- Insurance_Policies
-- ============================================================================
IF OBJECT_ID('dbo.Insurance_Policies', 'U') IS NOT NULL DROP TABLE dbo.Insurance_Policies;
GO
CREATE TABLE dbo.Insurance_Policies (
    policy_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    policy_number         NVARCHAR(50) NOT NULL UNIQUE,
    insurer_name           NVARCHAR(150) NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,
    total_limit              DECIMAL(18,2) NOT NULL,
    deductible_default        DECIMAL(18,2) NOT NULL,
    annual_premium             DECIMAL(18,2) NOT NULL,
    status                      NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','EXPIRED','PENDING_RENEWAL')),
    per_event_limit             NVARCHAR(64) NULL,           -- גבול אחריות לאירוע בודד; מוצפן at-rest (Fernet, ר' app/services/encryption.py) — היה DECIMAL(18,2)
    bi_waiting_period_hours     SMALLINT NULL,                -- תקופת המתנה לכיסוי אובדן רווחים (שעות)
    exclusions                  NVARCHAR(MAX) NULL           -- החרגות פוליסה (טקסט חופשי / JSON)
);
GO

-- ============================================================================
-- Policy_Assets (many-to-many)
-- ============================================================================
IF OBJECT_ID('dbo.Policy_Assets', 'U') IS NOT NULL DROP TABLE dbo.Policy_Assets;
GO
CREATE TABLE dbo.Policy_Assets (
    policy_id           BIGINT NOT NULL REFERENCES dbo.Insurance_Policies(policy_id),
    property_id           BIGINT NOT NULL REFERENCES dbo.Properties(property_id),
    specific_deductible     NVARCHAR(64) NULL,        -- מוצפן at-rest (Fernet, ר' app/services/encryption.py) — היה DECIMAL(18,2)
    PRIMARY KEY (policy_id, property_id)
);
GO
-- property_id is only the trailing column of the composite PK above, so it isn't
-- efficiently searchable on its own (e.g. "all policies covering property X") without
-- a scan; index it standalone.
CREATE INDEX IX_PolicyAssets_Property ON dbo.Policy_Assets(property_id);
GO

-- ============================================================================
-- Incidents
-- ============================================================================
IF OBJECT_ID('dbo.Incidents', 'U') IS NOT NULL DROP TABLE dbo.Incidents;
GO
CREATE TABLE dbo.Incidents (
    incident_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    incident_code           NVARCHAR(20) NOT NULL UNIQUE,     -- INC-2026-001
    property_id               BIGINT NOT NULL REFERENCES dbo.Properties(property_id),
    reported_by_user_id         BIGINT NULL REFERENCES dbo.Users(user_id),
    incident_timestamp             DATETIME2 NOT NULL,
    hazard_type                     NVARCHAR(30) NOT NULL
        CHECK (hazard_type IN ('FLOOD','FIRE','STRUCTURAL_FAILURE','THEFT','ELECTRICAL','OTHER')),
    severity_level                   NVARCHAR(20) NOT NULL
        CHECK (severity_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    operational_impact                 NVARCHAR(20) NOT NULL
        CHECK (operational_impact IN ('FULL_OPERATION','PARTIAL_SHUTDOWN','FULL_SHUTDOWN')),
    initial_estimated_loss               DECIMAL(18,2) NOT NULL,
    description                            NVARCHAR(MAX) NOT NULL,
    status                                   NVARCHAR(30) NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW','UNDER_INVESTIGATION','CLAIM_FILED','CLOSED')),
    ai_classified                             BIT NOT NULL DEFAULT 0,
    ai_confidence                              DECIMAL(4,3) NULL,
    created_at                                   DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    is_draft                                       BIT NOT NULL DEFAULT 0,
    business_interruption_requested                BIT NOT NULL DEFAULT 0,
    area_or_building                                 NVARCHAR(150) NULL,   -- אזור/מבנה בתוך הנכס
    reported_coordinates                               NVARCHAR(50) NULL,  -- מיקום GPS של המדווח, "lat,lng"
    resolved_address                                     NVARCHAR(255) NULL  -- כתובת שפוענחה אוטומטית מ-reported_coordinates (Reverse Geocoding, ר' app/integrations/gis.py)
);
GO
CREATE INDEX IX_Incidents_Property ON dbo.Incidents(property_id);
CREATE INDEX IX_Incidents_StatusHazard ON dbo.Incidents(status, hazard_type);
CREATE INDEX IX_Incidents_ReportedBy ON dbo.Incidents(reported_by_user_id);
GO

-- ============================================================================
-- Incident_Media
-- ============================================================================
IF OBJECT_ID('dbo.Incident_Media', 'U') IS NOT NULL DROP TABLE dbo.Incident_Media;
GO
CREATE TABLE dbo.Incident_Media (
    media_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    incident_id           BIGINT NOT NULL REFERENCES dbo.Incidents(incident_id),
    file_path               NVARCHAR(500) NOT NULL,
    file_type                 NVARCHAR(50) NOT NULL,
    captured_at                 DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    gps_latitude                       FLOAT NULL,
    gps_longitude                      FLOAT NULL
);
GO
CREATE INDEX IX_IncidentMedia_Incident ON dbo.Incident_Media(incident_id);
GO

-- ============================================================================
-- Claims
-- ============================================================================
IF OBJECT_ID('dbo.Claims', 'U') IS NOT NULL DROP TABLE dbo.Claims;
GO
CREATE TABLE dbo.Claims (
    claim_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    claim_number          NVARCHAR(30) NOT NULL UNIQUE,
    incident_id             BIGINT NOT NULL REFERENCES dbo.Incidents(incident_id),
    policy_id                 BIGINT NOT NULL REFERENCES dbo.Insurance_Policies(policy_id),
    claimed_amount               DECIMAL(18,2) NOT NULL,
    deductible_applied              DECIMAL(18,2) NOT NULL DEFAULT 0,
    approved_amount                   DECIMAL(18,2) NOT NULL DEFAULT 0,
    claim_status                        NVARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (claim_status IN ('DRAFT','SUBMITTED','IN_ADJUSTMENT','APPROVED','REJECTED','SETTLED')),
    adjuster_name                         NVARCHAR(255) NULL,   -- מוצפן at-rest (Fernet, ר' app/services/encryption.py) — הורחב מ-100 כדי להכיל טקסט מוצפן
    expected_payment_date                   DATE NULL,
    created_at                                DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
CREATE INDEX IX_Claims_Incident ON dbo.Claims(incident_id);
CREATE INDEX IX_Claims_Policy ON dbo.Claims(policy_id);
CREATE INDEX IX_Claims_StatusDate ON dbo.Claims(claim_status, expected_payment_date);
GO

-- ============================================================================
-- Claim_Payments
-- ============================================================================
IF OBJECT_ID('dbo.Claim_Payments', 'U') IS NOT NULL DROP TABLE dbo.Claim_Payments;
GO
CREATE TABLE dbo.Claim_Payments (
    payment_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    claim_id                BIGINT NOT NULL REFERENCES dbo.Claims(claim_id),
    payment_date               DATE NOT NULL,
    amount                        DECIMAL(18,2) NOT NULL,
    reference_number                NVARCHAR(255) NULL,   -- stored encrypted at rest (Fernet, see app/services/encryption.py) — widened from 50 to fit ciphertext
    payment_type                      NVARCHAR(20) NOT NULL
        CHECK (payment_type IN ('ADVANCE','FINAL_SETTLEMENT'))
);
GO
-- Composite index for "payments by date, per claim" reporting (the practical equivalent of a
-- Claims(claim_status, payment_date) index — payment_date lives here, not on Claims; see note
-- in TODO_SPEC.md "אינדקסים לביצועים" for the full explanation).
CREATE INDEX IX_ClaimPayments_ClaimDate ON dbo.Claim_Payments(claim_id, payment_date);
GO

-- ============================================================================
-- Claim_Reserves
-- ============================================================================
IF OBJECT_ID('dbo.Claim_Reserves', 'U') IS NOT NULL DROP TABLE dbo.Claim_Reserves;
GO
CREATE TABLE dbo.Claim_Reserves (
    reserve_id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    claim_id                 BIGINT NOT NULL REFERENCES dbo.Claims(claim_id),
    reserve_amount              DECIMAL(18,2) NOT NULL,
    expected_payment_date          DATE NULL,
    updated_at                        DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
CREATE INDEX IX_ClaimReserves_Claim ON dbo.Claim_Reserves(claim_id);
GO

-- ============================================================================
-- Mitigation_Tasks
-- ============================================================================
IF OBJECT_ID('dbo.Mitigation_Tasks', 'U') IS NOT NULL DROP TABLE dbo.Mitigation_Tasks;
GO
CREATE TABLE dbo.Mitigation_Tasks (
    task_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    property_id          BIGINT NOT NULL REFERENCES dbo.Properties(property_id),
    title                   NVARCHAR(200) NOT NULL,
    cost_estimate             DECIMAL(18,2) NOT NULL,
    expected_annual_savings    DECIMAL(18,2) NOT NULL DEFAULT 0,
    due_date                     DATE NOT NULL,
    status                          NVARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','OVERDUE')),
    assigned_to_user_id              BIGINT NULL REFERENCES dbo.Users(user_id),
    created_at                         DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
CREATE INDEX IX_Mitigation_Property ON dbo.Mitigation_Tasks(property_id);
GO
CREATE INDEX IX_Mitigation_AssignedTo ON dbo.Mitigation_Tasks(assigned_to_user_id);
GO

-- ============================================================================
-- Audit_Log
-- ============================================================================
IF OBJECT_ID('dbo.Audit_Log', 'U') IS NOT NULL DROP TABLE dbo.Audit_Log;
GO
CREATE TABLE dbo.Audit_Log (
    log_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id             BIGINT NULL REFERENCES dbo.Users(user_id),
    entity_type            NVARCHAR(50) NOT NULL,     -- e.g. 'Incident', 'Claim', 'Policy'
    entity_id                 BIGINT NOT NULL,
    action                       NVARCHAR(20) NOT NULL
        CHECK (action IN ('CREATE','UPDATE','DELETE')),
    old_value                     NVARCHAR(MAX) NULL,   -- JSON snapshot before change; מוצפן at-rest (Fernet, ר' app/services/encryption.py)
    new_value                       NVARCHAR(MAX) NULL, -- JSON snapshot after change; מוצפן at-rest (Fernet, ר' app/services/encryption.py)
    timestamp                         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    ip_address                          NVARCHAR(45) NULL  -- IPv4/IPv6
);
GO
CREATE INDEX IX_AuditLog_Entity ON dbo.Audit_Log(entity_type, entity_id);
CREATE INDEX IX_AuditLog_User ON dbo.Audit_Log(user_id);
GO

-- ============================================================================
-- Role_Permissions
-- ============================================================================
IF OBJECT_ID('dbo.Role_Permissions', 'U') IS NOT NULL DROP TABLE dbo.Role_Permissions;
GO
CREATE TABLE dbo.Role_Permissions (
    role_permission_id     BIGINT IDENTITY(1,1) PRIMARY KEY,
    role                       NVARCHAR(30) NOT NULL
        CHECK (role IN ('RISK_MANAGER','CFO','PROPERTY_MANAGER','FIELD_WORKER','ADMIN','RISK_OFFICER','ADJUSTER')),
    permission_key                NVARCHAR(100) NOT NULL,   -- e.g. 'incidents:create', 'claims:approve'
    description                       NVARCHAR(200) NULL,
    CONSTRAINT UQ_RolePermissions_RoleKey UNIQUE (role, permission_key)
);
GO
CREATE INDEX IX_RolePermissions_Role ON dbo.Role_Permissions(role);
GO

-- ============================================================================
-- Documents
-- ============================================================================
IF OBJECT_ID('dbo.Documents', 'U') IS NOT NULL DROP TABLE dbo.Documents;
GO
CREATE TABLE dbo.Documents (
    document_id     BIGINT IDENTITY(1,1) PRIMARY KEY,
    entity_type     NVARCHAR(20) NOT NULL
        CHECK (entity_type IN ('POLICY','CLAIM','PROPERTY','INCIDENT')),
    entity_id       BIGINT NOT NULL,
    s3_url          NVARCHAR(500) NOT NULL,
    doc_type        NVARCHAR(30) NOT NULL,
    uploaded_by     BIGINT NULL REFERENCES dbo.Users(user_id),
    uploaded_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_Documents_Entity ON dbo.Documents(entity_type, entity_id);
GO
CREATE INDEX IX_Documents_UploadedBy ON dbo.Documents(uploaded_by);
GO

-- ============================================================================
-- Financial_Statements
-- ============================================================================
IF OBJECT_ID('dbo.Financial_Statements', 'U') IS NOT NULL DROP TABLE dbo.Financial_Statements;
GO
CREATE TABLE dbo.Financial_Statements (
    statement_id        BIGINT IDENTITY(1,1) PRIMARY KEY,
    year                 SMALLINT NOT NULL UNIQUE,
    total_assets          DECIMAL(18,2) NOT NULL,
    revenue                DECIMAL(18,2) NOT NULL,
    net_income               DECIMAL(18,2) NOT NULL,
    insurance_expense           DECIMAL(18,2) NOT NULL,
    total_liabilities            DECIMAL(18,2) NULL,
    total_equity                  DECIMAL(18,2) NULL,
    gross_profit                   DECIMAL(18,2) NULL,
    operating_profit                 DECIMAL(18,2) NULL
);
GO

-- ============================================================================
-- Notification_Recipients — who services/notifications.py routes threshold
-- alerts to, and over which channels. Replaces the previous hardcoded
-- DEFAULT_RECIPIENTS list with a DB-backed table (TODO_SPEC.md §1) so
-- recipients can eventually be managed through the UI.
-- ============================================================================
IF OBJECT_ID('dbo.Notification_Recipients', 'U') IS NOT NULL DROP TABLE dbo.Notification_Recipients;
GO
CREATE TABLE dbo.Notification_Recipients (
    recipient_id    BIGINT IDENTITY(1,1) PRIMARY KEY,
    role            NVARCHAR(30) NOT NULL,
    display_name    NVARCHAR(100) NOT NULL,
    email           NVARCHAR(200) NOT NULL,
    phone           NVARCHAR(30) NOT NULL,
    channels        NVARCHAR(30) NOT NULL,   -- comma-separated subset of EMAIL/SMS/PUSH
    min_severity    NVARCHAR(20) NOT NULL DEFAULT 'warning',
    is_active       BIT NOT NULL DEFAULT 1
);
GO

-- ============================================================================
-- Notification_Log — audit trail of notifications actually dispatched by
-- services/notifications.dispatch_notifications (one row per alert/recipient/
-- channel combination "sent"). TODO_SPEC.md §1, "טבלת Notification_Log".
-- ============================================================================
IF OBJECT_ID('dbo.Notification_Log', 'U') IS NOT NULL DROP TABLE dbo.Notification_Log;
GO
CREATE TABLE dbo.Notification_Log (
    log_id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    alert_type      NVARCHAR(50) NOT NULL,
    severity        NVARCHAR(20) NOT NULL,
    recipient_role  NVARCHAR(30) NOT NULL,
    recipient_name  NVARCHAR(100) NOT NULL,
    channel         NVARCHAR(10) NOT NULL,
    contact         NVARCHAR(200) NOT NULL,
    title           NVARCHAR(200) NOT NULL,
    message         NVARCHAR(MAX) NOT NULL,
    property_ids    NVARCHAR(500) NOT NULL,   -- comma-separated bigint list
    value           DECIMAL(18,4) NOT NULL,
    threshold       DECIMAL(18,4) NOT NULL,
    status          NVARCHAR(20) NOT NULL,
    sent_at         DATETIME2 NOT NULL
);
GO
CREATE INDEX IX_Notification_Log_sent_at ON dbo.Notification_Log(sent_at);
GO

-- ============================================================================
-- Agent_Sessions / Agent_Actions_Log — short/long-term context memory and
-- action audit trail for the AI agent orchestrator (TODO_SPEC.md §1).
-- session_id is a client-minted UUID string (not IDENTITY) so the frontend can
-- mint it before the first message is persisted. context_data/payload are
-- stored as NVARCHAR(MAX) (no native JSON column type in SQL Server LocalDB),
-- same convention as Notification_Log.property_ids.
-- ============================================================================
IF OBJECT_ID('dbo.Agent_Actions_Log', 'U') IS NOT NULL DROP TABLE dbo.Agent_Actions_Log;
GO
IF OBJECT_ID('dbo.Agent_Sessions', 'U') IS NOT NULL DROP TABLE dbo.Agent_Sessions;
GO
CREATE TABLE dbo.Agent_Sessions (
    session_id      NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id         BIGINT NULL REFERENCES dbo.Users(user_id),
    context_data    NVARCHAR(MAX) NULL,
    created_at      DATETIME2 NOT NULL,
    updated_at      DATETIME2 NOT NULL
);
GO
CREATE TABLE dbo.Agent_Actions_Log (
    action_id       BIGINT IDENTITY(1,1) PRIMARY KEY,
    session_id      NVARCHAR(64) NOT NULL REFERENCES dbo.Agent_Sessions(session_id) ON DELETE CASCADE,
    action_type     NVARCHAR(50) NOT NULL,
    payload         NVARCHAR(MAX) NULL,
    status          NVARCHAR(20) NOT NULL DEFAULT 'proposed',
    created_at      DATETIME2 NOT NULL
);
GO
CREATE INDEX IX_Agent_Actions_Log_session_id ON dbo.Agent_Actions_Log(session_id);
GO

-- ============================================================================
-- Emails / Email_Recipients / Email_Attachments — internal messaging system
-- (TODO_SPEC.md, "משימה 1"). thread_id is a self-referencing FK to
-- Emails.email_id pointing at the thread's root email (NULL on the root itself,
-- set to the root's email_id on every reply) — see the Email model's docstring
-- in app/models.py for the full rationale (flat "WHERE email_id = :root OR
-- thread_id = :root" retrieval vs. a separate parent-chain Threads table).
-- ============================================================================
IF OBJECT_ID('dbo.Emails', 'U') IS NOT NULL DROP TABLE dbo.Emails;
GO
CREATE TABLE dbo.Emails (
    email_id        BIGINT IDENTITY(1,1) PRIMARY KEY,
    sender_id       BIGINT NOT NULL REFERENCES dbo.Users(user_id),
    subject         NVARCHAR(500) NOT NULL,
    body_html       NVARCHAR(MAX) NOT NULL,
    thread_id       BIGINT NULL REFERENCES dbo.Emails(email_id),
    created_at      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    status          NVARCHAR(20) NOT NULL DEFAULT 'SENT'   -- e.g. SENT/DRAFT; more statuses land in later tasks (see TODO_SPEC.md §13)
);
GO
CREATE INDEX IX_Emails_Sender ON dbo.Emails(sender_id);
GO
CREATE INDEX IX_Emails_ThreadId ON dbo.Emails(thread_id);
GO

IF OBJECT_ID('dbo.Email_Recipients', 'U') IS NOT NULL DROP TABLE dbo.Email_Recipients;
GO
CREATE TABLE dbo.Email_Recipients (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    email_id        BIGINT NOT NULL REFERENCES dbo.Emails(email_id),
    user_id         BIGINT NOT NULL REFERENCES dbo.Users(user_id),
    recipient_type  NVARCHAR(10) NOT NULL
        CHECK (recipient_type IN ('TO','CC','BCC')),
    is_read         BIT NOT NULL DEFAULT 0,
    folder          NVARCHAR(20) NOT NULL DEFAULT 'INBOX'
        CHECK (folder IN ('INBOX','SENT','ARCHIVE','TRASH','SPAM'))   -- SENT: sender's own copy (see task 3 step 3), not in the spec's literal folder list
);
GO
CREATE INDEX IX_EmailRecipients_Email ON dbo.Email_Recipients(email_id);
GO
CREATE INDEX IX_EmailRecipients_UserFolder ON dbo.Email_Recipients(user_id, folder);
GO

IF OBJECT_ID('dbo.Email_Attachments', 'U') IS NOT NULL DROP TABLE dbo.Email_Attachments;
GO
CREATE TABLE dbo.Email_Attachments (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    email_id        BIGINT NOT NULL REFERENCES dbo.Emails(email_id),
    file_path       NVARCHAR(500) NOT NULL,
    file_name       NVARCHAR(255) NOT NULL,
    file_size       BIGINT NOT NULL,
    content_type    NVARCHAR(100) NOT NULL
);
GO
CREATE INDEX IX_EmailAttachments_Email ON dbo.Email_Attachments(email_id);
GO

-- ============================================================================
-- Entity_Emails — contextual link between an email thread and an
-- Incident/Claim/Property (TODO_SPEC.md "משימה 11"). email_id always stores
-- the THREAD ROOT's email_id (never an individual reply's id) — see the
-- EntityEmail model's docstring in app/models.py for the full rationale.
-- auto_linked distinguishes a link created by the optional subject-line
-- auto-detector (step 5) from one a user created via POST
-- /api/emails/{id}/link.
-- ============================================================================
IF OBJECT_ID('dbo.Entity_Emails', 'U') IS NOT NULL DROP TABLE dbo.Entity_Emails;
GO
CREATE TABLE dbo.Entity_Emails (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    email_id        BIGINT NOT NULL REFERENCES dbo.Emails(email_id),
    entity_type     NVARCHAR(20) NOT NULL
        CHECK (entity_type IN ('INCIDENT','CLAIM','PROPERTY')),
    entity_id       BIGINT NOT NULL,
    linked_by       BIGINT NOT NULL REFERENCES dbo.Users(user_id),
    linked_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    auto_linked     BIT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_EntityEmails_EmailEntity UNIQUE (email_id, entity_type, entity_id)
);
GO
CREATE INDEX IX_EntityEmails_Entity ON dbo.Entity_Emails(entity_type, entity_id);
GO

-- ============================================================================
-- Email_Templates — reusable canned messages for the Compose modal
-- (TODO_SPEC.md "משימה 12", "תמיכה בתבניות מייל מוגדרות מראש"). subject_template
-- / body_template may contain {{variable}} placeholders (e.g. {{claim_number}},
-- {{client_name}}); substitution happens client-side when a template is loaded
-- into Compose — see app/routers/email_templates.py's module docstring.
-- ============================================================================
IF OBJECT_ID('dbo.Email_Templates', 'U') IS NOT NULL DROP TABLE dbo.Email_Templates;
GO
CREATE TABLE dbo.Email_Templates (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200) NOT NULL,
    subject_template    NVARCHAR(500) NOT NULL,
    body_template       NVARCHAR(MAX) NOT NULL,
    created_by          BIGINT NULL REFERENCES dbo.Users(user_id),
    created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
