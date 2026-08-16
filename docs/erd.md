# ERD — תרשים ישויות וקשרים

```mermaid
erDiagram
    Users ||--o{ Properties : "מנהל"
    Users ||--o{ Incidents : "מדווח"
    Users ||--o{ Mitigation_Tasks : "אחראי"

    Properties ||--o| Asset_Risk_Profiles : "פרופיל סיכון"
    Properties ||--o{ Incidents : "אירועים"
    Properties ||--o{ Mitigation_Tasks : "משימות מיטיגציה"
    Properties }o--o{ Insurance_Policies : "Policy_Assets"

    Insurance_Policies ||--o{ Claims : "תביעות"
    Incidents ||--o{ Claims : "תביעות"
    Incidents ||--o{ Incident_Media : "מדיה"
    Claims ||--o{ Claim_Payments : "תקבולים"

    Properties {
        bigint property_id PK
        nvarchar property_code UK
        nvarchar name
        nvarchar address
        nvarchar region
        decimal latitude
        decimal longitude
        nvarchar asset_type
        decimal replacement_value
        decimal book_value
        bigint primary_manager_id FK
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
    }

    Policy_Assets {
        bigint policy_id PK_FK
        bigint property_id PK_FK
        decimal specific_deductible
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
    }

    Incident_Media {
        bigint media_id PK
        bigint incident_id FK
        nvarchar file_path
        nvarchar file_type
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
        nvarchar adjuster_name
        date expected_payment_date
    }

    Claim_Payments {
        bigint payment_id PK
        bigint claim_id FK
        date payment_date
        decimal amount
        nvarchar reference_number
        nvarchar payment_type
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
    }

    Users {
        bigint user_id PK
        nvarchar full_name
        nvarchar email UK
        nvarchar role
    }
```

## שרשרת הערך המרכזית

```
נכס פיזי (Properties)
   → פרופיל סיכון (Asset_Risk_Profiles)
      → אירוע נזק (Incidents)  ←  AI מסווג אוטומטית
         → תביעת ביטוח (Claims)  ←  משוייכת ל-Insurance_Policies
            → תקבולים (Claim_Payments)
```

מקביל, ומחוץ לשרשרת הליניארית: `Mitigation_Tasks` מקשר `Properties` להמלצות תחזוקה מונעת עם חישוב ROI, ו-`Policy_Assets` הוא טבלת קישור many-to-many בין `Properties` ל-`Insurance_Policies` (נכס יכול להיות מכוסה במספר פוליסות; פוליסה מכסה מספר נכסים).
