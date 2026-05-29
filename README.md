# 🏫 Kalinabiri Secondary School — Backend API

<p align="center">
  <img src="https://img.shields.io/badge/Backend-API-00ff88?style=for-the-badge&logo=python&logoColor=black" alt="API"/>
  <img src="https://img.shields.io/badge/School-Management-00ff88?style=for-the-badge&logo=university&logoColor=black" alt="Education"/>
  <img src="https://img.shields.io/badge/Open-Source-00ff88?style=for-the-badge&logo=github&logoColor=black" alt="Open Source"/>
</p>

> **Backend API for Kalinabiri Secondary School — student management, academic records, and administrative operations.**

---

## ⚡ What It Does

RESTful API powering the Kalinabiri SS digital infrastructure — manages student records, grades, staff accounts, and school administrative workflows.

## 🚀 Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
python app.py

# Run with Docker
docker build -t kalinabiri-backend .
docker run -p 5000:5000 kalinabiri-backend
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/students` | List all students |
| `POST` | `/api/students` | Add new student |
| `GET` | `/api/students/:id` | Get student details |
| `PUT` | `/api/students/:id` | Update student |
| `DELETE` | `/api/students/:id` | Remove student |
| `GET` | `/api/grades` | Get grade records |
| `POST` | `/api/auth/login` | Staff login |

## 🏗 Stack

- **Language:** Python (Flask/FastAPI)
- **Database:** PostgreSQL/SQLite
- **Auth:** JWT tokens
- **Deployment:** Railway, Docker

---

## 🌌 Live Instance

- **Backend:** https://grateful-transformation-production-f792.up.railway.app/api
- **Admin:** admin@kalinabiriss.ac.ug

---

## 💼 Structure

```
backend/
├── app.py           # Main application
├── routes/          # API endpoints
├── models/          # Database models
├── auth/            # Authentication
└── requirements.txt # Dependencies
```

---

## 💼 Contact

**Address:** Ntinda, Kampala, Uganda  
**Phone:** +256 700 123 456  
**Email:** admin@kalinabiriss.ac.ug

---

## 🠷 License

MIT License — [ScottsTechX](https://github.com/fredscottsbulls) © 2026
