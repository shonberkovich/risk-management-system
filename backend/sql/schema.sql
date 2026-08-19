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
IF OBJECT_ID('dbo.Claim_Payments', 'U') IS NOT NULL DROP TABLE dbo.Claim_Payments;
IF OBJECT_ID('dbo.Claims', 'U') IS NOT NULL DROP TABLE dbo.Claims;
IF OBJECT_ID('dbo.Incident_Media', 'U') IS NOT NULL DROP TABLE dbo.Incident_Media;
IF OBJECT_ID('dbo.Incidents', 'U') IS NOT NULL DROP TABLE dbo.Incidents;
IF OBJECT_ID('dbo.Policy_Assets', 'U') IS NOT NULL DROP TABLE dbo.Policy_Assets;
IF OBJECT_ID('dbo.Mitigation_Tasks', 'U') IS NOT NULL DROP TABLE dbo.Mitigation_Tasks;
IF OBJECT_ID('dbo.Asset_Risk_Profiles', 'U') IS NOT NULL DROP TABLE dbo.Asset_Risk_Profiles;
IF OBJECT_ID('dbo.Insurance_Policies', 'U') IS NOT NULL DROP TABLE dbo.Insurance_Policies;
IF OBJECT_ID('dbo.Properties', 'U') IS NOT NULL DROP TABLE dbo.Properties;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;
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
        CHECK (role IN ('RISK_MANAGER','CFO','PROPERTY_MANAGER','FIELD_WORKER','ADMIN')),
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
CREATE INDEX IX_Properties_Coordinates ON dbo.Properties(latitude, longitude);
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
    notes                     NVARCHAR(MAX) NULL
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
    per_event_limit             DECIMAL(18,2) NULL,          -- גבול אחריות לאירוע בודד
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
    specific_deductible     DECIMAL(18,2) NULL,
    PRIMARY KEY (policy_id, property_id)
);
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
    created_at                                   DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
CREATE INDEX IX_Incidents_Property ON dbo.Incidents(property_id);
CREATE INDEX IX_Incidents_StatusHazard ON dbo.Incidents(status, hazard_type);
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
    captured_at                 DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
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
    adjuster_name                         NVARCHAR(100) NULL,
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
    reference_number                NVARCHAR(50) NULL,
    payment_type                      NVARCHAR(20) NOT NULL
        CHECK (payment_type IN ('ADVANCE','FINAL_SETTLEMENT'))
);
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
