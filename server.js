// server.js
// Install dependencies: npm install express multer cors ws
// Run: node server.js

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const WebSocket = require('ws');

// ---------- HTTP APP ----------
const app = express();
app.use(cors());
app.use(express.json());

// Create uploads directory
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname || '');
    cb(null, `${uniqueName}${ext}`);
  }
});

const upload = multer({ storage });

// Serve uploaded files publicly
app.use('/uploads', express.static(UPLOAD_DIR));

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filename = req.file.filename;
  const url = `http://localhost:8080/uploads/${filename}`;
  res.json({ url, filename });
});

// Health check
app.get('/', (req, res) => {
  res.send('Chat server is running');
});

// ---------- WEBSOCKET ----------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

let rooms = {};       // { roomCode: [clients] }
let roomOwners = {};  // { roomCode: creatorUserId }

console.log("✅ WebSocket server running on ws://localhost:8080/ws");
console.log("✅ HTTP server running on http://localhost:8080");

wss.on("connection", (ws) => {
  console.log("👤 New client connected");
  let currentRoom = null;
  let currentUser = null;

  ws.on("message", (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());
      const { action, userId, room, text, type, url, filename } = msg;

      if (action === "create") {
        // Generate random room code
        currentRoom = Math.floor(10000 + Math.random() * 90000).toString();
        rooms[currentRoom] = [ws];
        roomOwners[currentRoom] = userId; // mark creator
        currentUser = userId;

        console.log(`✅ ${userId} created room ${currentRoom}`);
        ws.send(JSON.stringify({ action: "roomCreated", room: currentRoom }));
      }
      else if (action === "join") {
        currentRoom = room;
        currentUser = userId;

        if (!rooms[currentRoom]) {
          rooms[currentRoom] = [];
        }
        rooms[currentRoom].push(ws);
        console.log(`✅ ${userId} joined room ${currentRoom}`);

        // Notify others
        const joinMsg = JSON.stringify({
          action: "system",
          room: currentRoom,
          text: `${userId} has joined the chat`
        });
        rooms[currentRoom].forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(joinMsg);
          }
        });
      }
      else if (action === "message" && currentRoom) {
        if (type === 'file') {
          console.log(`[${currentRoom}] ${userId} sent file: ${filename || url}`);
        } else {
          console.log(`[${currentRoom}] ${userId}: ${text}`);
        }

        rooms[currentRoom].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(rawMsg.toString());
          }
        });
      }
      else if (action === "deleteFile" && currentRoom) {
        console.log(`[${currentRoom}] ${userId} deleted file: ${filename}`);

        const deleteMsg = JSON.stringify({
          action: 'deleteFile',
          room: currentRoom,
          userId,
          url,
          filename
        });

        rooms[currentRoom].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(deleteMsg);
          }
        });
      }
      else if (action === "clearChat" && currentRoom) {
        console.log(`[${currentRoom}] ${userId} cleared chat using shortcut (${text})`);

        const clearMsg = JSON.stringify({
          action: "clearChat",
          room: currentRoom,
          userId,
          text: `Chat cleared by ${userId} using shortcut (${text})`
        });

        rooms[currentRoom].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(clearMsg);
          }
        });
      }
      else if (action === "destroyRoom" && currentRoom) {
        if (roomOwners[currentRoom] === userId) {
          console.log(`🗑️ Room ${currentRoom} destroyed by ${userId}`);

          const destroyMsg = JSON.stringify({
            action: "roomDestroyed",
            room: currentRoom,
            text: `Room ${currentRoom} has been destroyed by ${userId}`
          });

          // notify & disconnect all
          rooms[currentRoom].forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(destroyMsg);
              client.close();
            }
          });

          delete rooms[currentRoom];
          delete roomOwners[currentRoom];
        }
      }
    } catch (err) {
      console.error("❌ Error parsing message", err);
    }
  });

  ws.on("close", () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom] = rooms[currentRoom].filter((c) => c !== ws);

      // Notify others
      if (currentUser) {
        const leftMsg = JSON.stringify({
          action: "system",
          room: currentRoom,
          text: `${currentUser} has left the chat`
        });
        rooms[currentRoom].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(leftMsg);
          }
        });
      }
    }
    console.log("⚠️ Client disconnected");
  });
});

// Start server
server.listen(8080, () => {
  console.log("🚀 Server started on port 8080");
  console.log("📁 Upload endpoint: http://localhost:8080/upload");
  console.log("🔗 WebSocket endpoint: ws://localhost:8080/ws");
});