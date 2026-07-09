# Project Setup & Run Guide

Welcome to the project! Follow these instructions to get both the frontend and backend running locally on your machine.

## 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v20+ recommended)
- **Python** (v3.12+ or 3.13+)
- **Git**

## 2. Clone the Repository
Clone the latest version of the repository:
```bash
git clone https://github.com/SagarMensch/j.git
cd j
```

## 3. Backend Setup (Python)

1. **Create a virtual environment** in the repository root:
```bash
python -m venv .venv
```

2. **Activate the virtual environment**:
- On Windows:
  ```bash
  .venv\Scripts\activate
  ```
- On Mac/Linux:
  ```bash
  source .venv/bin/activate
  ```

3. **Install the dependencies**:
```bash
pip install -r backend\requirements.txt
```

4. **Environment Variables**:
- Create a `.env` file in the `backend` folder by copying the example template:
  ```bash
  cp backend\.env.example backend\.env
  ```
- Fill in the required API keys (e.g., Supabase, Neo4j, Groq, Sarvam, NVIDIA, etc.) in the `backend\.env` file. Obtain these credentials from your team lead or the secure handoff channel.

## 4. Frontend Setup (Next.js)

1. **Open a second terminal window** and navigate to the frontend folder:
```bash
cd frontend-nextjs
```

2. **Install the node packages**:
```bash
npm install
```

3. **Environment Variables**:
- Create a `.env.local` file in the `frontend-nextjs` folder:
  ```bash
  cp .env.local.example .env.local
  ```

## 5. Running the Application

You can use the provided batch script to run both the frontend and backend simultaneously (on Windows).

1. Ensure you are in the root directory (`j`).
2. Run the demo script:
```bash
start_demo.bat
```

This will automatically launch:
- **Backend API:** running at `http://localhost:8000`
- **Frontend App:** running at `http://localhost:3000`

### Running them manually (Alternative)
If you prefer not to use the batch script or are on Mac/Linux:

- **Start Backend:**
  ```bash
  .venv\Scripts\activate  # or source .venv/bin/activate
  python run_server.py
  ```
- **Start Frontend:**
  In a new terminal:
  ```bash
  cd frontend-nextjs
  npm run dev
  ```

## Important Notes & Troubleshooting
- **Ports in use:** Ensure that ports `8000` and `3000` are not currently in use by other applications. If you see a `404` or connection error, an old process might still be running. Close old terminals or kill the processes.
- **Demo Users:** You can use "Admin User" for the admin workspace and "Aarav Sharma" for the operator demo.
- **Demo Assets:** Demo source PDFs and assets are packaged under the `demo-assets/documents/` directory.

---
*Happy coding!*
