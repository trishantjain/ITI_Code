require("dotenv").config();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Device = require("./models/Device");
const net = require("net");
const mongoose = require("mongoose");
const express = require("express");
const bodyParser = require("body-parser");
const SensorReading = require("./models/SensorReading");
const thresholds = require("./thresholds");
const fs = require("fs");
const path = require("path");
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const connectedDevices = new Map();
app.use(bodyParser.json());
const cors = require("cors");
app.use(cors());

// WebSocket Server
const wss = new WebSocket.Server({ port: 8080 });
const wsClients = new Set();

// WebSocket connection handling with improved logging
wss.on('connection', (ws, req) => {
  console.log('🔌 WebSocket client connected from:', req.socket.remoteAddress);
  wsClients.add(ws);

  // Send immediate welcome message
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    message: 'WebSocket connected successfully',
    timestamp: getFormattedDateTime(),
    clientsCount: wsClients.size
  }));

  // Send current connected devices status
  ws.send(JSON.stringify({
    type: 'DEVICES_STATUS',
    data: {
      connectedDevices: Array.from(connectedDevices.keys()),
      timestamp: getFormattedDateTime()
    }
  }));

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    wsClients.delete(ws);
  });
});

wss.on('listening', () => {
  console.log('✅ WebSocket server running on port 8080');
});

// Improved WebSocket broadcast function
function broadcastToWebClients(reading) {
  const message = JSON.stringify({
    type: 'NEW_READING',
    data: reading,
    timestamp: getFormattedDateTime()
  });

  let successfulSends = 0;
  let failedSends = 0;

  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successfulSends++;
      } catch (err) {
        console.error('Failed to send to WebSocket client:', err);
        failedSends++;
        wsClients.delete(client);
      }
    }
  });

  // Log broadcasting stats occasionally
  if (Math.random() < 0.01) { // ~1% of the time
    console.log(`📊 WebSocket: ${successfulSends} sent, ${failedSends} failed, ${wsClients.size} total clients`);
  }
}

// WebSocket status monitoring
setInterval(() => {
  if (wsClients.size > 0) {
    console.log(`🔌 WebSocket Status: ${wsClients.size} active clients`);
  }
}, 30000); // Every 30 seconds

// ===================== DEBUG SYSTEM =====================
const debug = {
  enabled: true,
  lastPacketTime: null,
  packetCount: 0,
  errorCount: 0,
  bufferStats: {
    totalBytes: 0,
    discardedBytes: 0,
    malformedPackets: 0
  },

  log: (message, context = '') => {
    if (!debug.enabled) return;
    const timestamp = getFormattedDateTime();
    console.log(`🔍 [${timestamp}] ${message}`, context ? `| ${context}` : '');
  },

  error: (message, error = null) => {
    const timestamp = getFormattedDateTime();
    console.log(`❌ [${timestamp}] ${message}`, error ? `| Error: ${error.message}` : '');
    debug.errorCount++;
  },

  stats: () => {
    const now = new Date();
    const uptime = process.uptime();
    const stats = {
      serverTime: getFormattedDateTime(),
      upTime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      packetReceived: debug.packetCount,
      errors: debug.errorCount,
      lastPacket: debug.lastPacketTime ? `${Math.floor((now - debug.lastPacketTime) / 1000)}s ago` : 'Never',
      bufferStats: debug.bufferStats,
      connectedDevices: connectedDevices.size,
      readingBufferSize: readingBuffer.length,
      websocketClients: wsClients.size,
      dateFunction: "getFormattedDateTime() working ✅"
    };
    console.log('📊 DEBUG STATS:', JSON.stringify(stats, null, 2));
    return stats;
  },

  healthCheck: () => {
    const issues = [];

    if (!debug.lastPacketTime) {
      issues.push("No Packets Received yet");
    } else {
      const timeSinceLastPacket = Date.now() - debug.lastPacketTime;
      if (timeSinceLastPacket > 30000) {
        issues.push(`No Packets for ${timeSinceLastPacket / 1000}s`);
      }
    }

    if (debug.errorCount > 10) {
      issues.push("High error count");
    }

    if (debug.bufferStats.malformedPackets > debug.packetCount * 0.5) {
      issues.push("High malformed packet rate");
    }

    return {
      status: issues.length === 0 ? "HEALTHY" : "ISSUES",
      serverTime: getFormattedDateTime(),
      issues: issues
    };
  }
};

// 🔌 DB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

// ===================== HTTP API Endpoints =====================
app.get("/ping", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send("pong");
  } catch (e) {
    console.error("⚠️ /ping DB check failed:", e.message);
    res.status(500).send("MongoDB unreachable");
  }
});

// WebSocket test endpoint
app.get("/api/websocket-test", (req, res) => {
  const wsStatus = {
    websocketServer: {
      port: 8080,
      clients: wsClients.size,
      status: 'RUNNING'
    },
    httpServer: {
      port: 5000,
      status: 'RUNNING'
    },
    tcpServer: {
      port: 4000,
      status: 'RUNNING'
    },
    timestamp: getFormattedDateTime()
  };

  res.json(wsStatus);
});

// ✅ Login route (admin hardcoded via .env)
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  // Admin login
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign(
      { username: "admin", role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );
    return res.json({ role: "admin", token });
  }

  // User login from DB
  const user = await User.findOne({ username: username });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ role: user.role, token });
});

// ✅ Register new user
app.post("/api/register-user", async (req, res) => {
  const { username, password, role } = req.body;

  if (!["admin", "block", "gp", "user"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role,
    });
    await user.save();
    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: "Error creating user" });
  }
});

// API to get the list of users
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error("Failed to fetch users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.post("/api/register-device", async (req, res) => {
  const { mac, locationId, address, latitude, longitude, ipCamera } = req.body;
  try {
    const device = new Device({
      mac,
      locationId,
      address,
      latitude,
      longitude,
      ipCamera: ipCamera || "",
    });
    await device.save();
    res.json({ message: "Device registered successfully" });
  } catch (err) {
    res.status(500).json({ error: "Error registering device" });
  }
});

// ✅ Get registered device metadata
app.get("/api/devices-info", async (req, res) => {
  try {
    const devices = await Device.find();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ Delete device by MAC
app.put("/api/device/:mac", async (req, res) => {
  try {
    const { password, ...updateFields } = req.body;
    if (updateFields.locationId && updateFields.locationId.length > 17)
      return res
        .status(400)
        .json({ error: "Location ID must be 17 characters or fewer" });
    if (password !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });
    const { mac } = req.params;
    const updatedDevice = await Device.findOneAndUpdate(
      { mac },
      { $set: updateFields },
      { new: true }
    );
    if (!updatedDevice)
      return res.status(404).json({ error: "Device not found" });
    res.json(updatedDevice);
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});

app.post("/api/device/delete/:mac", async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD)
    return res
      .status(403)
      .json({ error: "Unauthorized: Invalid admin password" });
  try {
    const result = await Device.deleteOne({ mac: req.params.mac });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device deleted successfully" });
  } catch (err) {
    console.error("Error deleting device:", err);
    res.status(500).json({ error: "Error deleting device" });
  }
});

// ✅ Edit User
app.put("/api/user/:id", async (req, res) => {
  try {
    const { username, password, adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    const user = await User.findById(req.params.id);

    const updateFields = {};
    updateFields.username = username;

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.password = hashedPassword;
    }

    const updatedDevice = await User.findOneAndUpdate(
      user,
      { $set: updateFields },
      { new: true }
    );

    if (!updatedDevice)
      return res.status(404).json({ error: "User not found" });
    res.json(updatedDevice);
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});

// ✅ Delete User
app.post("/api/user/delete/:id", async (req, res) => {
  try {
    const { adminPassword, uname } = req.body;

    console.log("Admin Password: ", adminPassword);
    console.log("UserName: ", uname);

    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    const result = await User.deleteOne({ uname: req.params.username });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error updating User:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});

// ✅ Command endpoint
app.post("/command", (req, res) => {
  const { mac, command } = req.body;
  const deviceSocket = connectedDevices.get(mac);

  if (!deviceSocket || deviceSocket.destroyed) {
    connectedDevices.delete(mac);
    return res.status(404).json({ message: `Device ${mac} not connected` });
  }

  const buffer = Buffer.from(command, "utf-8");
  deviceSocket.write(buffer, (err) => {
    if (err) {
      console.error(`Failed to send command to ${mac}:`, err.message);
      return res
        .status(500)
        .json({ message: `Error sending command to ${mac}` });
    }
    console.log(`Sent command "${command}" to ${mac}`);
    res.json({ message: `Command sent to ${mac}` });
  });
});

// ✅ Get connected MACs
app.get("/api/devices", (req, res) => {
  res.json(Array.from(connectedDevices.keys()));
});

// ✅ Get only registered MACs
app.get("/api/all-devices", async (req, res) => {
  try {
    const devices = await Device.find({}, "mac");
    res.json(devices.map((d) => d.mac));
  } catch (error) {
    console.error("Error fetching registered devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get last 100 readings
app.get("/api/readings", async (req, res) => {
  try {
    const readings = await SensorReading.find()
      .sort({ timestamp: -1 })
      .limit(400);
    res.json(readings);
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Failed to fetch readings" });
  }
});

// ✅ Get latest reading by MAC
app.get("/api/device/:mac", async (req, res) => {
  try {
    const latest = await SensorReading.findOne({ mac: req.params.mac }).sort({
      timestamp: -1,
    });
    if (!latest) return res.status(404).json({ message: "No data found" });
    res.json(latest);
  } catch (err) {
    console.error("Error fetching device data:", err.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// ✅ Get logs saved in PC
app.post("/api/log-command", (req, res) => {
  console.log("Log API Called");
  const { date, mac, command, status, message } = req.body;

  console.log(date, mac, command, status, message);

  const now = new Date();
  const fileName = `${now.getDate()}_${now.getMonth() + 1
    }_${now.getHours()}.out`;
  const logDir = "C:/CommandLogs/out";

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const filePath = path.join(logDir, fileName);
  const timestamp = now.toLocaleString();
  const logEntry = `[${timestamp}] | MAC:${mac} | ${status}  | COMMAND:"${command}" | MESSAGE:"${message}"\n`;

  res.json({ message: "Log received" });

  fs.appendFile(filePath, logEntry, (err) => {
    if (err) {
      console.error("Failed to save log:", err);
    } else {
      console.log(`✅ Log saved: ${filePath}`);
    }
  });
});

app.get("/api/historical-data", async (req, res) => {
  const { mac, datetime } = req.query;
  if (!mac || !datetime)
    return res.status(400).json({ error: "Missing mac or datetime" });
  const datetimeObj = new Date(datetime);
  if (isNaN(datetimeObj.getTime()))
    return res.status(400).json({ error: "Invalid datetime format" });
  const selectedDate = new Date(datetimeObj);
  selectedDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);
  try {
    const readings = await SensorReading.find({
      mac,
      timestamp: { $gte: selectedDate, $lt: nextDate },
    }).sort({ timestamp: 1 });
    const atSelectedTime = await SensorReading.findOne({
      mac,
      timestamp: { $lte: datetimeObj },
    }).sort({ timestamp: -1 });
    res.json({ readings, atSelectedTime });
  } catch (err) {
    console.error("Historical data error:", err.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// ✅ Serve snapshot images
app.get("/api/snapshots/:imageName", (req, res) => {
  const imageName = req.params.imageName;
  const imagePath = path.join("C:/snaps", imageName);

  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: "Image not found" });
  }

  res.sendFile(imagePath);
});

// ✅ Get list of available snapshots
app.get("/api/snapshots", (req, res) => {
  const snapshotsDir = "C:/snaps";

  try {
    const files = fs
      .readdirSync(snapshotsDir)
      .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(file))
      .sort()
      .slice(-15);

    res.json(files);
  } catch (err) {
    console.error("Error reading snapshots:", err);
    res.status(500).json({ error: "Failed to read snapshots" });
  }
});

app.get("/api/thresholds", (req, res) => {
  res.json(thresholds);
});

// Debug endpoints
app.get("/api/debug/stats", (req, res) => {
  res.json(debug.stats());
});

app.get("/api/debug/health", (req, res) => {
  res.json(debug.healthCheck());
});

app.post("/api/debug/toggle", (req, res) => {
  debug.enabled = !debug.enabled;
  res.json({
    enabled: debug.enabled,
    message: `Debug ${debug.enabled ? 'enabled' : 'disabled'}`,
    timestamp: getFormattedDateTime()
  });
});

// FIXED: Corrected connected-devices endpoint
app.post("/api/debug/connected-devices", (req, res) => {
  const devices = Array.from(connectedDevices.entries()).map(([mac, socket]) => ({
    mac,
    connected: !socket.destroyed,
    remoteAddress: socket.remoteAddress,
    remotePort: socket.remotePort,
    lastSeen: getFormattedDateTime()
  }));

  res.json(devices);
});

app.post("/api/debug/reset-counters", (req, res) => {
  debug.errorCount = 0;
  debug.packetCount = 0;
  debug.bufferStats.malformedPackets = 0;
  debug.bufferStats.discardedBytes = 0;
  debug.bufferStats.totalBytes = 0;
  debug.lastPacketTime = null;

  res.json({
    message: "All counters reset",
    resetTime: getFormattedDateTime()
  });
});

app.get("/api/debug/packet-stream", (req, res) => {
  res.json({
    currentTime: getFormattedDateTime(),
    totalPackets: debug.packetCount,
    lastPacketTime: debug.lastPacketTime ? getFormattedDateTime(new Date(debug.lastPacketTime)) : "Never",
    activeConnections: connectedDevices.size,
    bufferStatus: {
      currentBufferSize: readingBuffer.length,
      maxBufferSize: BULK_SAVE_LIMIT
    }
  });
});

// 📡 TCP Server
const BULK_SAVE_LIMIT = 1000;
let readingBuffer = [];
let alreadyReplied = 0;

function getFormattedDateTime() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(today.getDate());
  const mm = pad(today.getMonth() + 1);
  const yy = String(today.getFullYear()).slice(-2);
  const HH = pad(today.getHours());
  const MM = pad(today.getMinutes());
  const SS = pad(today.getSeconds());
  return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
}

function sendX(socket) {
  const msg = `%X000${getFormattedDateTime()}$`;
  console.log(`⬅️ Sending back: ${msg}`);
  const ok = socket.write(msg);
  if (!ok) {
    console.warn("⚠️ Backpressure: socket buffer is full, write queued");
  }
}

// Database cleanup functions
async function getData() {
  try {
    const sensorRecordsCount = await SensorReading.countDocuments();

    if (sensorRecordsCount > 10000) {
      const now = new Date();

      const lastDoc = await SensorReading.findOne().sort({ timestamp: 1 });
      if (!lastDoc) {
        debug.log("No Sensor Data found", 'CLEANUP');
      }

      const dateDiffer = Math.abs(now - lastDoc.timestamp) / (1000 * 60 * 60 * 24);
      const dateDifferRounded = Math.floor(dateDiffer);

      if (dateDifferRounded > 15) {
        await SensorReading.deleteMany({ timestamp: lastDoc.timestamp });
      }
    }
  } catch (err) {
    debug.error("Error in Deleting Data: ", err);
  }
}

function hourlyDBCleanup() {
  getData();
  setInterval(getData, 60 * 60 * 1000);
}

hourlyDBCleanup();

// TCP Server
const tcpServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;

  debug.log(`New TCP Connection from`, clientInfo);

  socket.on("data", async (data) => {
    console.log(
      `Received packet (${data.length} bytes):`,
      data.toString("hex")
    );
    buffer = Buffer.concat([buffer, data]);

    try {
      debug.packetCount++;
      debug.lastPacketTime = Date.now();
      debug.bufferStats.totalBytes += data.length;

      debug.log(`Raw data received (${data.length} bytes) from`, clientInfo);
      debug.log(`Raw data hex preview:`, data.toString('hex').substring(0, 100) + '...');

      buffer = Buffer.concat([buffer, data]);
      debug.log(`Total buffer size: ${buffer.length} bytes`);

      while (buffer.length >= 58) {
        const bufStr = buffer.toString("utf-8");

        // Search for first valid MAC pattern in buffer string
        const macPattern = /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/;
        const match = bufStr.match(macPattern);

        if (!match) {
          console.warn(
            `No MAC found in buffer, discarding ${buffer.length} bytes`
          );
          buffer = Buffer.alloc(0);
          break;
        }

        const macStartIndex = bufStr.indexOf(match[0]);

        if (macStartIndex > 0) {
          console.warn(`Discarding ${macStartIndex} bytes of junk before MAC`);
          buffer = buffer.slice(macStartIndex);
          continue;
        }

        if (buffer.length < 58) {
          break;
        }

        // Extract one full packet starting at MAC
        const packet = buffer.slice(0, 58);
        console.log(packet);

        const macRaw = packet.subarray(0, 17);
        let macRawStr = macRaw.toString("utf-8");
        console.log(
          `Received MAC: [${macRawStr}], length: ${macRawStr.length}`
        );

        // Sanitize and verify MAC
        const sanitizedMac = macRawStr.replace(/[^0-9A-Fa-f:]/g, "");
        const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
        if (sanitizedMac.length !== 17 || !macRegex.test(sanitizedMac)) {
          console.warn(`⚠️ Dropping malformed MAC: INVALID_${Date.now()}`);
          buffer = buffer.slice(58);
          continue;
        }

        const mac = sanitizedMac;
        const humidity = +buffer.readFloatLE(17).toFixed(2);
        const insideTemperature = +buffer.readFloatLE(21).toFixed(2);
        const outsideTemperature = +buffer.readFloatLE(25).toFixed(2);
        const lockStatus = buffer[29] === 1 ? "OPEN" : "CLOSED";
        const doorStatus = buffer[30] === 1 ? "OPEN" : "CLOSED";
        const waterLogging = !!buffer[31];
        const waterLeakage = !!buffer[32];
        const outputVoltage = +buffer.readFloatLE(33).toFixed(2);
        const inputVoltage = +buffer.readFloatLE(37).toFixed(2);
        const batteryBackup = +buffer.readFloatLE(41).toFixed(2);
        const alarmActive = !!buffer[45];
        const fireAlarm = !!buffer[46];
        const fanLevel1Running = !!buffer[47];
        const fanLevel2Running = !!buffer[48];
        const fanLevel3Running = !!buffer[49];
        const fanLevel4Running = !!buffer[50];
        const padding = buffer[51];

        if (padding === 0x31 && !alreadyReplied) {
          sendX(socket);
          alreadyReplied = 40;
        }

        if ((padding === 0x43)) {
          sendX(socket);

          console.log("📸 Capture pictures command received");

          const now = new Date();
          const timestamp = now.toISOString()
            .replace(/[-:]/g, '')
            .replace(/T/, '_')
            .replace(/\..+/, '')
            .slice(0, 15);

          const fileName = `image_${timestamp}.jpg`;
          const outputDir = 'C:/snaps';
          const outputPath = path.join(outputDir, fileName);

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          const url = `http://192.168.0.120/CGI/command/snap?channel=01`;

          axios({
            method: 'GET',
            url: url,
            responseType: 'stream'
          })
            .then((response) => {
              const writer = fs.createWriteStream(outputPath);
              response.data.pipe(writer);

              return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
              });
            })
            .then(() => {
              console.log(`✅ Snapshot captured: ${fileName}`);
            })
            .catch((error) => {
              console.error(`❌ Error capturing snapshot: ${error.message}`);
            });
        }

        // Logging Incoming Data from Simulator
        const now = new Date();
        const fileName = `${now.getDate()}_${now.getMonth() + 1
          }_${now.getHours()}.inc`;
        const logDir = "C:/CommandLogs/inc";

        const sensorData = {
          humidity: humidity,
          insideTemperature: insideTemperature,
          outsideTemperature: outsideTemperature,
          inputVoltage: inputVoltage,
          outputVoltage: outputVoltage,
          batteryBackup: batteryBackup,
        };

        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const filePath = path.join(logDir, fileName);
        const timestamp = now.toLocaleString();
        const logEntry = `[${timestamp}] | MAC:${mac} | Data:${JSON.stringify(
          sensorData
        )}"\n`;

        fs.appendFile(filePath, logEntry, (err) => {
          if (err) {
            console.error("Failed to save log:", err);
          } else {
            console.log(`✅ Log saved: ${filePath}`);
          }
        });

        if (alreadyReplied) alreadyReplied--;
        const fanStatusBits = buffer.readUInt16LE(52);
        const fanStatus = [];
        for (let i = 0; i < 6; i++) {
          fanStatus[i] = (fanStatusBits >> (i * 2)) & 0x03;
        }
        console.log("fanStatus", fanStatus);

        const fanFailBits = buffer.readUInt32LE(54);
        const floats = [
          humidity,
          insideTemperature,
          outsideTemperature,
          outputVoltage,
          inputVoltage,
          batteryBackup,
        ];

        if (floats.some((val) => isNaN(val) || Math.abs(val) > 100000)) {
          console.warn(`⚠️ Skipping packet from ${mac}: bad float value(s)`);
          buffer = buffer.slice(58);
          continue;
        }

        if (Math.random() < 0.01) {
          console.log(
            `📡 ${mac} | Temp: ${insideTemperature}°C | Humidity: ${humidity}% | Voltage: ${inputVoltage}V | Fan stat=${fanStatusBits.toString(
              16
            )}h`
          );
        }

        // Threshold-based alarms
        const thresholdAlarms = {
          insideTemperatureAlarm:
            insideTemperature > thresholds.insideTemperature.max ||
            insideTemperature < thresholds.insideTemperature.min,
          outsideTemperatureAlarm:
            outsideTemperature > thresholds.outsideTemperature.max ||
            outsideTemperature < thresholds.outsideTemperature.min,
          humidityAlarm:
            humidity > thresholds.humidity.max ||
            humidity < thresholds.humidity.min,
          inputVoltageAlarm:
            inputVoltage > thresholds.inputVoltage.max ||
            inputVoltage < thresholds.inputVoltage.min,
          outputVoltageAlarm:
            outputVoltage > thresholds.outputVoltage.max ||
            outputVoltage < thresholds.outputVoltage.min,
          batteryBackupAlarm: batteryBackup < thresholds.batteryBackup.min,
        };

        const activeAlarms = [];

        if (thresholdAlarms.insideTemperatureAlarm) {
          activeAlarms.push(`Inside Temperature: ${insideTemperature}`);
        }
        if (thresholdAlarms.outsideTemperatureAlarm) {
          activeAlarms.push(`Outside Temperature: ${outsideTemperature}`);
        }
        if (thresholdAlarms.humidityAlarm) {
          activeAlarms.push(`Humidity: ${humidity}`);
        }
        if (thresholdAlarms.inputVoltageAlarm) {
          activeAlarms.push(`Input Voltage: ${inputVoltage}`);
        }
        if (thresholdAlarms.outputVoltageAlarm) {
          activeAlarms.push(`Output Voltage: ${outputVoltage}`);
        }
        if (thresholdAlarms.batteryBackupAlarm) {
          activeAlarms.push(`Battery Backup: ${batteryBackup}`);
        }

        if (waterLogging) {
          activeAlarms.push("Water Logging Alarm");
        }

        if (waterLeakage) {
          activeAlarms.push("Water Leakage Alarm");
        }

        if (doorStatus) {
          activeAlarms.push("Door Alarm");
        }

        if (lockStatus) {
          activeAlarms.push("Lock Alarm");
        }

        if (fireAlarm) {
          activeAlarms.push("Fire Alarm");
        }

        // Single console output
        if (activeAlarms.length > 0) {
          const alarmLogDir = "C:/CommandLogs/alarm"

          if (!fs.existsSync(alarmLogDir)) {
            fs.mkdirSync(alarmLogDir, { recursive: true });
          }

          const alarmFileName = `${now.getDate()}_${now.getMonth() + 1
            }_${now.getHours()}_Alarm.inc`;

          let logAlarm;
          if (fanStatus.includes(2)) {
            logAlarm = `[${timestamp}] | MAC: ${mac}| ${activeAlarms} | Fan Status: ${fanStatus}\n`;
          } else {
            logAlarm = `[${timestamp}] | MAC: ${mac}| ${activeAlarms}\n`;
          }

          const alarmFilePath = path.join(alarmLogDir, alarmFileName);

          fs.appendFile(alarmFilePath, logAlarm, (err) => {
            if (err) {
              console.error("Failed to save log:", err);
            } else {
              console.log(`✅ Log saved: ${alarmFilePath}`);
            }
          });
        }

        // Build and save the reading
        const reading = new SensorReading({
          mac,
          humidity,
          insideTemperature,
          outsideTemperature,
          lockStatus,
          doorStatus,
          waterLogging,
          waterLeakage,
          outputVoltage,
          inputVoltage,
          batteryBackup,
          alarmActive,
          fireAlarm,
          fanLevel1Running,
          fanLevel2Running,
          fanLevel3Running,
          fanLevel4Running,
          fanFailBits,
          fan1Status: fanStatus[0],
          fan2Status: fanStatus[1],
          fan3Status: fanStatus[2],
          fan4Status: fanStatus[3],
          fan5Status: fanStatus[4],
          fan6Status: fanStatus[5],
          ...thresholdAlarms,
        });

        connectedDevices.set(mac, socket);
        broadcastToWebClients(reading);
        readingBuffer.push(reading);

        if (readingBuffer.length >= BULK_SAVE_LIMIT) {
          const toSave = [...readingBuffer];
          readingBuffer = [];
          SensorReading.insertMany(toSave).catch((err) =>
            console.error("Bulk save error:", err.message)
          );
        }

        buffer = buffer.slice(58);
        debug.log(`✅ Packet processed successfully for MAC: ${mac}`, `Time: ${getFormattedDateTime()}`);
      }
    } catch (err) {
      debug.error(`Critical error in data handler from ${clientInfo}`, err);
      console.error("Packet parsing failed:", err.message);
      socket.destroy();
    }
  });

  socket.on("end", () => {
    for (const [mac, sock] of connectedDevices.entries()) {
      if (sock === socket) {
        connectedDevices.delete(mac);
        console.log(`Device ${mac} disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    if (err.code !== "ECONNRESET") {
      console.error("Socket error:", err.message);
    }
  });
});

// Periodic bulk save
setInterval(() => {
  if (readingBuffer.length > 0) {
    const toSave = [...readingBuffer];
    readingBuffer = [];
    SensorReading.insertMany(toSave).catch((err) =>
      console.error("Periodic bulk save error:", err.message)
    );
  }
}, 5000);

// Start servers
tcpServer.listen(4000, "0.0.0.0", () => {
  console.log("✅ TCP server listening on port 4000");
});

app.listen(5000, "0.0.0.0", () => {
  console.log("✅ HTTP server running on port 5000");
});

console.log("🚀 All servers started successfully!");
console