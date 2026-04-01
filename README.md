# 🤖 Chatbot Application — Full Stack

A complete customer support chatbot with FAQ matching, AI fallback (OpenAI/Groq), human escalation, admin dashboard, and analytics.

---

## 📁 Folder Structure

```
chatbot-app/
│
├── backend/                        # Node.js + Express API Server
│   ├── data/
│   │   └── faqs.json               # ✅ FAQ knowledge base (edit this!)
│   ├── routes/
│   │   ├── chat.js                 # POST /api/chat + GET /api/chat/faqs
│   │   ├── escalation.js           # POST/GET /api/escalate
│   │   └── admin.js                # Admin analytics + FAQ management
│   ├── utils/
│   │   ├── faqMatcher.js           # Keyword-based FAQ search logic
│   │   └── store.js                # In-memory analytics + escalation store
│   ├── server.js                   # Express app entry point
│   ├── package.json
│   └── .env.example                # ← Copy to .env and fill in API key
│
├── frontend/                       # React Application
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   │   ├── ChatWidget.jsx        # Floating launcher button
│   │   │   │   ├── ChatWindow.jsx        # Full chat window UI
│   │   │   │   ├── MessageBubble.jsx     # Individual message component
│   │   │   │   ├── QuickReplies.jsx      # FAQ quick-reply buttons
│   │   │   │   ├── ChatInput.jsx         # Message input bar
│   │   │   │   └── EscalationModal.jsx   # "Talk to Human" modal
│   │   │   └── Admin/
│   │   │       └── AdminDashboard.jsx    # Admin panel (analytics + FAQ)
│   │   ├── hooks/
│   │   │   └── useChat.js               # Custom hook for chat logic
│   │   ├── utils/
│   │   │   └── api.js                   # All API fetch functions
│   │   ├── styles/                      # Separate CSS files per component
│   │   │   ├── global.css               # CSS variables, reset, animations
│   │   │   ├── ChatWidget.css           # Launcher + chat window + header
│   │   │   ├── ChatBody.css             # Messages, bubbles, input bar
│   │   │   ├── EscalationModal.css      # Escalation form modal
│   │   │   └── AdminDashboard.css       # Admin panel styles
│   │   ├── App.jsx                      # Root component + routing
│   │   └── index.js                     # React entry point
│   └── package.json
│
├── package.json                    # Root scripts to run both servers
├── .gitignore
└── README.md
```

---

## ⚙️ Prerequisites

- **Node.js** v18 or higher → https://nodejs.org
- **npm** v9+ (comes with Node.js)
- An **API key** from:
  - **Groq** (free, fast): https://console.groq.com
  - **OpenAI** (paid): https://platform.openai.com

---

## 🚀 Setup & Run

### Step 1 — Clone / Download the project

```bash
# If using git:
git clone <your-repo-url>
cd chatbot-app

# Or just cd into the folder you've downloaded:
cd chatbot-app
```

### Step 2 — Install dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Go back to root
cd ..
```

### Step 3 — Configure environment variables

```bash
# Copy the example file
cp backend/.env.example backend/.env

# Now open backend/.env and fill in your values:
nano backend/.env   # or open in VS Code
```

Your `.env` file should look like this:

```env
PORT=5000
NODE_ENV=development

# For Groq (recommended - free tier available):
OPENAI_API_KEY=gsk_your_groq_key_here
OPENAI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama3-70b-8192

# For OpenAI (remove the BASE_URL line):
# OPENAI_API_KEY=sk-your-openai-key-here
# AI_MODEL=gpt-3.5-turbo

FRONTEND_URL=http://localhost:3000
```

### Step 4 — Start the servers

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# ✅ Server starts at http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm start
# ✅ React app opens at http://localhost:3000
```

### Step 5 — Open the app

| URL | What you'll see |
|-----|----------------|
| `http://localhost:3000` | Main website + floating chat widget |
| `http://localhost:3000/#/admin` | Admin dashboard |
| `http://localhost:5000/health` | Backend health check |

---

## 🔌 API Endpoints Reference

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send a message. Body: `{ message, conversationHistory }` |
| `GET` | `/api/chat/faqs` | Get all FAQs (for quick-reply buttons) |

### Escalation
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/escalate` | Submit human support request. Body: `{ name, email, issue }` |
| `GET` | `/api/escalate` | List all escalation requests |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/analytics` | View analytics data |
| `GET` | `/api/admin/faqs` | View all FAQs with full details |
| `POST` | `/api/admin/faqs/upload` | Upload new FAQ JSON (replaces existing) |
| `PUT` | `/api/admin/faqs/:id` | Update a specific FAQ |
| `DELETE` | `/api/admin/faqs/:id` | Delete a specific FAQ |

---

## 📚 How the FAQ System Works

1. User sends a message → backend receives it
2. `faqMatcher.js` normalizes the message and checks every FAQ's keywords
3. If a keyword match is found (score ≥ 1) → returns the FAQ answer instantly (no AI cost)
4. If no match → calls OpenAI/Groq API with full conversation history
5. Response is returned with a `source` field (`"faq"` or `"ai"`)

**To add/edit FAQs:**
- Edit `backend/data/faqs.json` directly
- Or upload a new JSON file via the Admin Dashboard at `/#/admin`

Each FAQ entry needs:
```json
{
  "id": 1,
  "keywords": ["price", "cost", "how much"],
  "question": "What is the pricing?",
  "answer": "Our plans start at $9/month..."
}
```

---

## 🎨 Customization

### Change the bot name/avatar
Edit the header in `frontend/src/components/Chat/ChatWindow.jsx`

### Change colors/theme
Edit CSS variables in `frontend/src/styles/global.css` — all colors flow from the `:root` block

### Change AI behavior
Edit the system prompt in `backend/routes/chat.js` (look for `systemPrompt`)

### Add to your existing website
Just copy the `Chat/` folder into your project and add `<ChatWidget />` to your root component

---

## 🔄 Upgrading to a Real Database

The backend uses in-memory storage by default. To persist data across restarts:

1. Install Supabase client: `npm install @supabase/supabase-js`
2. In `backend/utils/store.js`, replace the arrays with Supabase table queries
3. Tables needed: `escalations`, `analytics`

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, functional components + hooks |
| Styling | Pure CSS with CSS custom properties (no framework) |
| Backend | Node.js + Express |
| AI | OpenAI API / Groq API (OpenAI-compatible) |
| Storage | In-memory (swap for Supabase/MongoDB) |
| File Upload | Multer |

---

## 📝 Notes for Your Manager

- **Separate CSS files**: Each component has its own `.css` file in `src/styles/`
- **No CSS framework**: Pure CSS with custom properties for full control
- **Beginner-friendly**: Every file is commented explaining what it does
- **Production-ready structure**: Proper error handling, validation, and separation of concerns
- **Easy to extend**: Add routes in `backend/routes/`, components in `frontend/src/components/`
