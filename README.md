# RMIS — מערכת מידע לניהול סיכונים משולבת AI

מערכת RMIS (Risk Management Information System) פנימית לחברת נכסים, המחברת בין נתונים גיאוגרפיים-פיזיים (נכסים, מפגעים, אירועי נזק) לניתוח פיננסי-ביטוחי (פוליסות, תביעות, תזרים), עם שכבת AI מבוססת Claude לסיווג אירועים, הפקת דוחות הנהלה, ומענה על שאלות בשפה טבעית.

פרויקט לקורס ניהול סיכונים, תואר שני במדעי המחשב.

## סטאק טכנולוגי

- **Frontend:** React 18 + TypeScript + Vite, MUI (RTL), React Query, Leaflet, Recharts
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0
- **Database:** SQL Server (LocalDB)
- **AI:** Anthropic Claude (`claude-opus-5`) — Structured Outputs, Streaming, Tool Use

## תיעוד מלא

ראו [`docs/README.md`](./docs/README.md) לארכיטקטורה מפורטת, מודל נתונים, שכבת ה-AI, הוראות הרצה, והיקף הפרויקט. ERD מלא ב-[`docs/erd.md`](./docs/erd.md).

## הרצה מהירה

```bash
# Backend — http://localhost:8000/docs
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
sqlcmd -S "(localdb)\MSSQLLocalDB" -C -i sql\schema.sql
python -m app.seed
uvicorn app.main:app --reload

# Frontend — http://localhost:5173
cd frontend
npm install && npm run dev
```

יש להוסיף `ANTHROPIC_API_KEY` לקובץ `backend/.env` (ראו `.env.example`) כדי להפעיל את יכולות ה-AI.
