# Conductor Web Commercial Setup Notes

This clean repo package has been prepared for GitHub/commercial use. It intentionally excludes local-only folders and secrets from the original zip, including `.git`, `node_modules`, `venv`, `__pycache__`, and the real frontend `.env` file.

## Local setup

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
# Add your restricted MapTiler key to .env
npm run dev
```

Backend:

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Licensing position

Conductor Web is packaged as proprietary commercial software owned by Paul Walker / Mav3r1ckmediastudio. Use the included EULA template as a starting point for customer agreements, but have it legally reviewed before relying on it for paid sales.
