# תוכנית עבודה מקיפה: ארכיטקטורת סוכני AI (AI Agents Architecture)

מסמך זה מכיל את כל המשימות הנדרשות לפיתוח ושילוב מערך סוכני ה-AI במערכת, מקצה לקצה (מסד נתונים, צד שרת וצד לקוח).

**הפרומפט להעתקה לפיתוח כל משימה (יש להדביק לפני כל סעיף שמעבירים ל-AI):**
> "עליך לממש את המשימה הבאה במערכת ה-RMIS. קרא היטב את תבנית המשימה וודא שאתה פועל בדיוק לפי השלבים המפורטים. אל תשנה קוד בקבצים שאינם מופיעים תחת 'תיקיות וקבצים רלוונטיים להסתכל בהם' אלא אם זה נדרש אדריכלית על מנת למנוע שבירת קוד, ובמקרה כזה הסבר מדוע השינוי חיוני. בסיום, וודא שכל סעיף מסומן ב-'[x]' לאחר שהושלם ונבדק."

---

### [x] משימה 1: תשתיות מסד נתונים וזיכרון לסוכנים (Database & Context Memory)
* **מהות המשימה (איזה חלק עושים)**: יצירת טבלאות מודלים לשמירת היסטוריית השיחות עם הסוכנים (Sessions) ולוג פעולות שהסוכנים ביצעו, כדי לאפשר זיכרון לטווח קצר וארוך (Long/Short-term Context).
* **מיקום במערכת**: Backend (Models & Database).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `backend/app/models.py`
  - `backend/app/schemas.py`
  - `backend/alembic/` (יצירת מיגרציה)
  - `backend/sql/schema.sql` (סנכרון סכמה למאגר חדש)
* **שלבי ביצוע (Checklist)**:
  - [x] שלב 1: הוספת מודל `Agent_Sessions` ב-`models.py` שיכלול `session_id`, `user_id`, `context_data` (JSON), ו-`created_at/updated_at`.
  - [x] שלב 2: הוספת מודל `Agent_Actions_Log` לתיעוד פעולות עצמאיות של הסוכן (למשל פתיחת טיוטת אירוע), מקושר ל-`Agent_Sessions`.
  - [x] שלב 3: הוספת Pydantic Schemas מתאימים ב-`schemas.py` עבור המודלים החדשים.
  - [x] שלב 4: הפקת מיגרציית Alembic (`alembic revision --autogenerate`) ועדכון ידני של `schema.sql`.
* **קריטריוני הצלחה (Acceptance Criteria)**: המסד עולה בהצלחה, ניתן לשמור ולשלוף היסטוריית שיחות והקשר (Context) עבור משתמש ספציפי, ומיגרציית Alembic עוברת ללא שגיאות.
  - ✅ בוצע ב-branch feature/agent-sessions-memory-models: נוספו מודלים `AgentSession`/`AgentActionLog` ב-`backend/app/models.py` (טבלאות `Agent_Sessions`/`Agent_Actions_Log`, `context_data`/`payload` כ-NVARCHAR(MAX) בהתאם למוסכמת ה-JSON-כטקסט הקיימת בקובץ), Pydantic Schemas תואמים ב-`backend/app/schemas.py`, מיגרציית Alembic ידנית `b7e4d1a930c8` (אין DB חי ל-autogenerate, כמו המיגרציות הקודמות), וסנכרון `backend/sql/schema.sql` (כולל DROP TABLE בסדר FK-safe).

---

### [x] משימה 2: הנתב הראשי - Agent Orchestrator
* **מהות המשימה (איזה חלק עושים)**: בניית מנגנון הניתוב הלוגי שיקבל בקשות ממשתמשים או מטריגרים במערכת, יבין את הכוונה (Intent) וינתב לסוכן הרלוונטי (Orchestration).
* **מיקום במערכת**: Backend (Services).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `backend/app/services/llm.py`
  - יצירת קובץ חדש: `backend/app/services/ai_orchestrator.py`
  - `backend/app/routers/ai.py`
* **שלבי ביצוע (Checklist)**:
  - [x] שלב 1: יצירת מחלקת `AgentOrchestrator` ב-`ai_orchestrator.py` המנהלת את ה-State של הבקשה.
  - [x] שלב 2: שילוב Anthropic Structured Outputs כדי לנתח את הבקשה ולהחזיר JSON שמגדיר איזה סוכן צריך לפעול (למשל: `DATA_AGENT`, `COMPLIANCE_AGENT`).
  - [x] שלב 3: הרחבת התקשורת ב-`routers/ai.py` שתעבוד מול ה-Orchestrator במקום ישירות מול פונקציות בודדות.
* **קריטריוני הצלחה (Acceptance Criteria)**: שליחת פקודה טקסטואלית דרך ה-API מחזירה החלטת ניתוב נכונה (לדוגמה, השאלה "מה הסטטוס של תקן ISO בנכס 1?" תנותב לסוכן ה-Compliance).
  - ✅ בוצע ב-branch feature/ai-agent-orchestrator: נוסף `backend/app/services/ai_orchestrator.py` עם מחלקת `AgentOrchestrator` (טוענת/יוצרת `Agent_Sessions`, שומרת היסטוריה מתגלגלת ב-`context_data`, רושמת `Agent_Actions_Log`), `classify_intent()` המשתמש ב-`client.messages.parse` (Structured Outputs) להחזרת `RoutingDecision{agent, reasoning}` מתוך `AgentType = DATA_AGENT|COMPLIANCE_AGENT|EXTERNAL_DATA_AGENT`, ו-`AGENT_REGISTRY`/`register_agent()` להרחבה עתידית ע"י סוכני משימה 4/5. נוסף `POST /api/ai/agent-chat` ב-`routers/ai.py` שמפעיל את ה-Orchestrator (עם session_id אופציונלי להמשך שיחה). כוסה בבדיקות `tests/test_ai_orchestrator.py` (עם classify_intent מדומה) ו-`tests/test_api_ai_auth.py`.

---

### [x] משימה 4: פיתוח סוכן נתונים חיצוניים (External Data Agent)
* **מהות המשימה (איזה חלק עושים)**: סוכן מיוחד שיודע לגשת לאינטגרציות חיצוניות ולנתח נתוני מאקרו (מזג אוויר, רעידות אדמה, סביבה, מדדים).
* **מיקום במערכת**: Backend (Services).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `backend/app/integrations/*` (קריאה בלבד)
  - יצירת קובץ חדש: `backend/app/services/agents/data_agent.py`
* **שלבי ביצוע (Checklist)**:
  - [x] שלב 1: רישום הכלים (Tools) מתוך מודולי האינטגרציות עבור סוכן זה (Govmap, BOI, GSI וכו').
  - [x] שלב 2: הגדרת System Prompt לסוכן כאנליסט סיכוני מאקרו.
  - [x] שלב 3: כתיבת הפונקציה המבצעת שתקבל הוראה מה-Orchestrator, תפעיל כלים, ותחזיר סיכום מילולי מעובד.
* **קריטריוני הצלחה (Acceptance Criteria)**: הסוכן מסוגל לאסוף נתוני מזג אוויר וסייסמולוגיה עדכניים, להבין אותם, ולתת תחזית סיכונים קריאה וברורה בטקסט.
  - ✅ בוצע ב-branch feature/external-data-agent: נוסף `backend/app/services/agents/data_agent.py` עם כלים (`@beta_tool`) שעוטפים את `app/integrations/{weather,seismology,gis,economics}.py` הקיימים (התרעות מזג אוויר, בולטין רעידות אדמה של GSI + חשיפת נכסים לאפיצנטר, שכבת אזורי הצפה/אקלים, מדדי מאקרו של בנק ישראל), System Prompt של אנליסט סיכוני מאקרו, ופונקציית `run_external_data_agent()` המפעילה `client.beta.messages.tool_runner`. הסוכן נרשם אוטומטית כ-`EXTERNAL_DATA_AGENT` ב-`ai_orchestrator.AGENT_REGISTRY` (דרך `register_agent()`, מיובא ב-`routers/ai.py`).

---

### [ ] משימה 5: פיתוח סוכן אופרטיבי ותאימות (Action & Compliance Agent)
* **מהות המשימה (איזה חלק עושים)**: סוכן בעל הרשאות לביצוע פעולות (פתיחת טיוטות) וניתוח תאימות מול התקנים והדוחות הקיימים. Human-in-the-loop.
* **מיקום במערכת**: Backend (Services).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `backend/app/services/compliance.py`
  - יצירת קובץ חדש: `backend/app/services/agents/action_agent.py`
* **שלבי ביצוע (Checklist)**:
  - [ ] שלב 1: הנגשת כלי המערכת הפנימיים (Tools) כמו יצירת טיוטת `Incident`, יצירת משימת `Mitigation_Task` וקריאת דוחות `compliance`.
  - [ ] שלב 2: הגדרת System Prompt לסוכן כקצין ציות וסיכונים (Risk Officer).
  - [ ] שלב 3: כתיבת מנגנון בו הסוכן ממליץ על פעולה (ומחזיר אותה כ-JSON), אך אינו מבצע קומיט סופי עד לאישור משתמש (פרט ליצירת "טיוטות").
* **קריטריוני הצלחה (Acceptance Criteria)**: כאשר המערכת מזהה נכס שחורג מתאימות, הסוכן מפיק המלצה ליצירת משימת מיטיגציה ובונה את ה-Payload המתאים להכנה לאישור משתמש.

---

### [ ] משימה 6: צד לקוח - ממשק תקשורת וצ'אט סוכנים (Frontend Chat UI)
* **מהות המשימה (איזה חלק עושים)**: פיתוח ממשק משתמש (UI) מתקדם ורספונסיבי המאפשר למשתמשים לשוחח עם ה-Orchestrator ולקבל תוצרים ב-Streaming.
* **מיקום במערכת**: Frontend (Components & Pages).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `frontend/src/api/client.ts` (חיבור ל-Endpoints החדשים)
  - יצירת קובץ חדש: `frontend/src/components/AIAssistant/AIAssistant.tsx`
  - `frontend/src/layouts/MainLayout.tsx` (הוספת ה-Widget / Sidebar)
* **שלבי ביצוע (Checklist)**:
  - [ ] שלב 1: יצירת פונקציות קריאה לשרת ב-`client.ts` לתמיכה בצ'אט רב-שלבי (העברת `session_id`).
  - [ ] שלב 2: עיצוב ובניית הקומפוננטה `AIAssistant.tsx` (תיבת טקסט, הצגת הודעות, אינדיקציה לכך שהסוכן "חושב" או "מפעיל כלים").
  - [ ] שלב 3: תמיכה ב-Server-Sent Events (SSE) או קריאת זרם (Stream) כדי שהתשובה תופיע באופן הדרגתי (כמו ב-ChatGPT).
  - [ ] שלב 4: שילוב ה-AI Assistant לתוך ה-Layout הראשי כך שיהיה נגיש מכל מסך במערכת.
* **קריטריוני הצלחה (Acceptance Criteria)**: משתמש יכול לפתוח צ'אט, להקליד שאלה, ולראות את התשובה נכתבת בזמן אמת, כולל חיווי ויזואלי כאשר הסוכן משתמש בכלים (למשל: "מחפש נתוני מזג אוויר...").

---

### [ ] משימה 7: צד לקוח - מנגנון Human-in-the-loop ו"כפתורי קסם" (Contextual AI)
* **מהות המשימה (איזה חלק עושים)**: הוספת UI לאישור פעולות שהסוכן הציע (כמו פתיחת טיוטה), והוספת פעולות AI מהירות במסכים ספציפיים.
* **מיקום במערכת**: Frontend (Components).
* **תיקיות וקבצים רלוונטיים להסתכל בהם**:
  - `frontend/src/components/AIAssistant/AIAssistant.tsx` (הרחבה לכרטיסיות פעולה)
  - `frontend/src/pages/PropertyDetails.tsx` (או מסכי נכסים אחרים)
* **שלבי ביצוע (Checklist)**:
  - [ ] שלב 1: פיתוח "כרטיס פעולה" (Action Card) בתוך ממשק הצ'אט שמופיע כאשר הסוכן מציע פעולה (לדוגמה: "האם ליצור משימת הפחתת סיכונים? [אשר] / [בטל]").
  - [ ] שלב 2: כפתור אישור שמפעיל את בקשת ה-Mutation ב-React Query שמבצעת את הפעולה בפועל.
  - [ ] שלב 3: במסך פרטי נכס, הוספת כפתור "נתח סיכונים באמצעות AI" שיפתח את הצ'אט ויזריק באופן אוטומטי את ההקשר (Context) של מזהה הנכס הנוכחי.
* **קריטריוני הצלחה (Acceptance Criteria)**: הסוכן שולח הצעה לפתיחת משימה; מוצג למשתמש כרטיס עם כפתור אישור; הלחיצה יוצרת משימה בפועל ומרעננת את מסך המשימות. לחיצה מתוך תיק נכס מעבירה לסוכן את הקשר הנכס המדויק מבלי שהמשתמש יצטרך לציין את מזהה הנכס.
