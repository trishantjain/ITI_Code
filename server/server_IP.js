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
const { spawn } = require('child_process');
const readline = require("readline");
const { connectRabbit, publishAlarm, publishSnapshot, consume, publishLog, publishAlarmResult } = require("./services/rabbit");
const getAlarmFiles = require("./alarm/fileScanner");
const parseAlarmLine = require("./alarm/alarmParser");
const parseIstLogTimestamp = require("./alarm/timestampParser");
const parseQueryDate = require("./alarm/dateParser");
const alarmHistoryCache = require("./cache/alarmHistoryCache");


const app = express();
const connectedDevices = new Map();
app.use(bodyParser.json());
const cors = require("cors");
const { authMiddleware } = require("./middleware/middleware");
app.use(cors());
const deviceCache = new Map();


// ===================== SSE: Snapshot Notifications =====================
const snapshotSseClients = new Set();

function writeSseEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastSnapshotCaptured(payload) {
  for (const client of snapshotSseClients) {
    try {
      if (client?.mac && client.mac !== String(payload.mac || "").toLowerCase()) {
        continue;
      }
      writeSseEvent(client.res, "snapshot", payload);
    } catch (e) {
      snapshotSseClients.delete(client);
      try {
        client?.res?.end();
      } catch {
        // ignore
      }
    }
  }
}

// Client subscribes to receive "snapshot" events
app.get("/api/events/snapshots", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // CORS middleware should handle headers, but SSE benefits from explicit keep-alive
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const mac = req.query.mac ? String(req.query.mac).toLowerCase() : "";
  const client = { res, mac };
  snapshotSseClients.add(client);

  // initial event so UI can confirm connection
  writeSseEvent(res, "ready", { ok: true, type: "snapshots", mac });

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    snapshotSseClients.delete(client);
  });
});


const logStreams = {};


// 🔌 DB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

(async () => {
  await connectRabbit();

  // Worker publishes completion events to this queue.
  // We translate those to SSE for the UI.
  await consume("snapshot.done", async (payload) => {
    broadcastSnapshotCaptured(payload);
  }, { prefetch: 50 });
})();

app.get("/test-alarm", (req, res) => {
  publishAlarm({
    mac: "TEST_DEVICE",
    alarms: ["Test Alarm Triggered"],
    timestamp: new Date()
  });

  res.send("Test alarm published");
});

async function loadDeviceCache() {
  try {
    const devices = await Device.find({}, { mac: 1, ipCamera: 1 }).lean();

    devices.forEach(d => {
      deviceCache.set(d.mac.toLowerCase(), {
        cameraType: d.ipCamera?.type || null,
        cameraIP: d.ipCamera?.ip || null
      });
    });

    console.log(`📦 Device cache loaded: ${deviceCache.size} devices`);
  } catch (err) {
    console.error("Failed to load device cache:", err.message);
  }
}

loadDeviceCache();



// ===================== HTTP API Endpoints (unchanged) =====================
/* When a GET request is made to "/ping", it will attempt to ping the MongoDB database using Mongoose. 
   If the ping is successful, it will respond with "pong". If the ping fails, it will log an error message and
   respond with "MongoDB unreachable" along with a status code of 500. 
*/
app.get("/api/ping", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.send("pong");
  } catch (e) {
    console.error("⚠️ /ping DB check failed:", e.message);
    res.status(500).send("MongoDB unreachable");
  }
});

// ✅ Login route (admin hardcoded via .env)
/* It is checking if the provided username and password in the request body match the admin username and password stored in the
   environment variables. If the credentials match, it generates a JSON Web Token (JWT) with the
   username "admin" and role "admin" and sends it back in the response along with the role "admin". 
*/
app.post("/api/login", async (req, res) => {
  try {

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

    res.json({ role: user.role, token }); // ✅ return role and token
  } catch (error) {
    console.error("Failed to fetch users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }

});

// *====================  USER API  ========================
// ✅ Register new user
app.post("/api/register-user", async (req, res) => {
  const { username, password, role } = req.body;

  if (!["admin", "block", "gp", "user", "field-worker"].includes(role)) {
    return res.status(401).json({ error: "Invalid role" });
  }

  try {
    // Hashing Password with 10 SaltRound
    const hashedPassword = await bcrypt.hash(password, 10); // ✅ hash password

    // Creating new User Object
    const user = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role,
    });

    // Saving User in DB
    await user.save();
    res.status(200).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ API to get the list of users
app.get("/api/users", async (req, res) => {
  try {
    // Finding list of users
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error("Failed to fetch users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ✅ Edit User
app.put("/api/user/:id", async (req, res) => {
  try {
    const { username, password, role, adminPassword } = req.body;
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    // Finding User from DB with ID came from frontend
    const user = await User.findById(req.params.id);

    // Setting new Details of User in "UpdateField"
    const updateFields = {};
    updateFields.username = username;
    updateFields.role = role;

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10); // Hashing new Password
      updateFields.password = hashedPassword;
    }

    // Updating User Details
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
app.delete("/api/user/:username", async (req, res) => {
  try {

    const { adminPassword } = req.body;

    // Comparing Admin Password
    if (adminPassword !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    // Deleting User by Username
    const result = await User.deleteOne({ username: req.params.username });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted successfully" });

  } catch (error) {
    console.error("Error updating User:", error);
    res.status(500).json({ error: "Server error while updating device" });
  }
});
// *====================  USER API  ========================


// *====================  DEVICE API  ====================== 
// ✅ Register new device
app.post("/api/register-device", authMiddleware, async (req, res) => {
  const { mac, locationId, address, latitude, longitude, ipCamera } = req.body;
  // const { mac, locationId, address, latitude, longitude } = req.body;
  try {
    const normalizedMac = mac.toLowerCase(); // Converting to LowerCase()
    let parsedCamera = ipCamera;

    // UNAUTHORIZED ERROR MESSAGE
    if (
      req.user.role !== "admin" &&
      req.user.role !== "field-worker"
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // IP ALREADY EXISTS MESSAGE
    const existingMac = await Device.findOne({ mac: normalizedMac });
    if (existingMac) {
      return res.status(409).json({ error: "Device IP already exists" });
    }

    // if (ipCamera && typeof ipCamera === 'string') {
    //   const [camType, camIP] = ipCamera.split(',');
    //   parsedCamera = {
    //     type: camType,
    //     ip: camIP.trim()
    //   }
    // }

    // const ipMatch = await Device.find({ "ipCamera.ip": parsedCamera.ip });
    // if (ipMatch && ipMatch.length > 0) {
    //   return res.status(409).json({ error: "Camera Ip already present" });
    // }


    // console.log("Parsed Camera: ", parsedCamera);
    const device = new Device({
      mac: normalizedMac,
      locationId,
      address,
      latitude,
      longitude,
      // ipCamera: parsedCamera || "",

      status: req.user.role === "admin" ? "approved" : "pending",
      createdBy: req.user.username
    });

    await device.save();

    deviceCache.set(normalizedMac, {
      cameraType: parsedCamera?.type || null,
      cameraIP: parsedCamera?.ip || null
    });

    res.json({ message: "Device registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ✅ Get registered device metadata
app.get("/api/devices-info", async (req, res) => {
  try {
    const devices = await Device.find({ status: "approved" }).sort({ locationId: -1 }); // includes ipCamera
    /* NEW ADDED */
    const normalizedDevices = devices.map(device => ({
      ...device._doc,
      mac: device.mac.toLowerCase() //! Converting to LowerCase()
    }));
    res.json(normalizedDevices);
  } catch (err) {
    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ ADMIN DEVICE
app.get("/api/admin/devices", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const devices = await Device.find().sort({ createdAt: -1 });
    res.json(devices);

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get connected MACs
app.get("/api/devices", (req, res) => {
  try {
    res.json(Array.from(connectedDevices.keys()).map(mac => mac.toLowerCase())); //! Converting to LowerCase()
  } catch (error) {
    res.status(500).json({ error: "Error fetching devices" });
  }
});

// ✅ Update device by MAC
app.put("/api/device/:mac", async (req, res) => {
  try {
    /* NEW ADDED*/
    const mac = req.params.mac.toLowerCase(); //! Converting to LowerCase()
    const { password, ...updateFields } = req.body;

    if (updateFields.locationId && updateFields.locationId.length > 17)
      return res
        .status(400)
        .json({ error: "Location ID must be 17 characters or fewer" });

    if (password !== process.env.ADMIN_PASSWORD)
      return res
        .status(403)
        .json({ error: "Unauthorized: Invalid admin password" });

    if (updateFields.ipCamera && typeof updateFields.ipCamera === 'string') {
      const [camType, camIP] = updateFields.ipCamera.split(',');
      updateFields.ipCamera = {
        type: camType,
        ip: camIP
      }

    }

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

//! Have to check this API
// ✅ Deleting device by MAC
app.post("/api/device/delete/:mac", async (req, res) => {
  const { password } = req.body;

  // Converting MAC to LowerCase()
  const mac = req.params.mac.toLowerCase();

  if (password !== process.env.ADMIN_PASSWORD)
    return res
      .status(403)
      .json({ error: "Unauthorized: Invalid admin password" });
  try {
    const result = await Device.deleteOne({ mac: mac });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device deleted successfully" });
  } catch (err) {
    console.error("Error deleting device:", err);
    res.status(500).json({ error: "Error deleting device" });
  }
});

// ✅ Get only registered MACs
app.get("/api/all-devices", async (req, res) => {
  try {
    const devices = await Device.find({}, "mac");
    res.json(devices.map((d) => d.mac.toLowerCase())); //! Converting to LowerCase()
  } catch (error) {
    console.error("Error fetching registered devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// ✅ Get latest reading by MAC
app.get("/api/device/:mac", async (req, res) => {
  try {
    const device = await Device.findOne({ mac: normalizedMac });

    if (!device || device.status !== "approved") {
      return res.status(403).json({ error: "Device not approved" });
    }

    const normalizedMac = req.params.mac.toLowerCase(); //! Converting to LowerCase()
    const latest = await SensorReading.findOne({ mac: normalizedMac }).sort({
      timestamp: -1,
    });
    if (!latest) return res.status(404).json({ message: "No data found" });
    res.json(latest);
  } catch (err) {
    console.error("Error fetching device data:", err.message);
    res.status(500).json({ error: "Failed to fetch reading" });
  }
});

// ✅ APPROVING DEVICE 
app.put("/api/device/approve/:mac", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("Checking admin login")

    const mac = req.params.mac.toLowerCase();

    const device = await Device.findOne({ mac });
    if (!device) return res.status(404).json({ error: "Device not found" });

    console.log("Checking device")

    if (device.status === "approved") {
      return res.status(400).json({ error: "Already approved" });
    }

    if (!device.createdBy) {
      device.createdBy = req.user.username;
    }

    console.log("Checking device current status")

    device.status = "approved";
    device.approvedAt = new Date();
    device.approvedBy = req.user.username;

    console.log("Saving device")
    console.log(device)
    await device.save();
    console.log("Device saved")

    res.json(device);

  } catch (err) {
    console.error("Approve failed:", err);
    res.status(500).json({ error: "Approve failed" });
  }
});

// ✅ REJECT DEVICE 
app.put("/api/device/reject/:mac", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const mac = req.params.mac.toLowerCase();

    const device = await Device.findOne({ mac });
    if (!device) return res.status(404).json({ error: "Device not found" });

    if (!device.createdBy) {
      device.createdBy = req.user.username;
    }

    device.status = "rejected";
    device.approvedAt = new Date();
    device.approvedBy = req.user.username;

    await device.save();

    res.json(device);

  } catch (err) {
    console.error("Reject failed:", err);
    res.status(500).json({ error: "Reject failed" });
  }
});
// *====================  DEVICE API  ====================== 


// *==================== SNAPSHOTS API =====================
// ✅ Serve snapshot images
app.get("/api/snapshots/:imageName", (req, res) => {
  try {
    const imageName = req.params.imageName;
    const rawMac = req.query.mac;
    const macSuffix = rawMac.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)

    /**
     * Constructs the full file path for a snapshot image by joining the snapshot output directory,
     * MAC address suffix, and image name.
     */
    const imagePath = path.join(`${snapshotOutputDir}/${macSuffix}`, imageName);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Send the image file
    res.sendFile(imagePath);
  } catch (err) {
    console.error("Error reading snapshots:", err);
    res.status(500).json({ error: "Failed to read snapshot" });
  }
});

// ✅ Get list of last 15 snapshots
app.get("/api/snapshots", (req, res) => {
  try {
    console.log("Into snapshot API");
    const rawMac = req.query.mac;

    console.log("MAC: ", rawMac);

    // Validate MAC address exists
    if (!rawMac) {
      return res.status(400).json({ error: "MAC address is required" });
    }

    // Extract the last part of MAC 
    const macSuffix = rawMac.slice(8).replace(/[. ]/g, "_"); // Gets characters 9-16 (0-indexed)
    // console.log("MAC ADDRESS: ", macSuffix);


    const snapshotsDir = `${snapshotOutputDir}/${macSuffix}`;
    console.log(snapshotsDir);
    let files = [];
    try {
      files = fs
        .readdirSync(snapshotsDir)
        .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(file))
        // Sorting images in descending order based on timestamp in filename
        .sort((a, b) => {
          // Extract YYMMDDHHMMSS format for comparison
          const getKey = (filename) => {
            const match = filename.match(/_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\./);
            return match ? match[3] + match[2] + match[1] + match[4] + match[5] + match[6] : '0';
          };
          return getKey(b).localeCompare(getKey(a));
        })
        .slice(0, 15); // Get last 15 images
      console.log("snapshots: ", files)
    } catch (dirErr) {

      console.error("Snapshots directory not found or error reading:", dirErr.message);
      // Return empty array if directory not found
      files = [];
    }
    res.json(files);
  } catch (err) {
    console.error("Error reading snapshots:", err);
    res.status(500).json({ error: "Failed to read snapshots" });
  }
});
// *==================== SNAPSHOTS API =====================


// ✅ Command endpoint
app.post("/command", (req, res) => {
  try {

    const { mac, command } = req.body;
    const normalizedMac = mac.toLowerCase(); //! Converting to LowerCase()
    const deviceSocket = connectedDevices.get(normalizedMac);

    if (!deviceSocket || deviceSocket.destroyed) {
      connectedDevices.delete(normalizedMac);
      return res.status(404).json({ message: `Device ${normalizedMac} not connected` });
    }

    const buffer = Buffer.from(command, "utf-8");
    deviceSocket.write(buffer, (err) => {
      if (err) {
        console.error(`Failed to send command to ${normalizedMac}:`, err.message);
        return res
          .status(500)
          .json({ message: `Error sending command to ${normalizedMac}` });
      }
      console.log(`Sent command "${command}" to ${normalizedMac}`);
      res.json({ message: `${command} sent to ${normalizedMac}` });
    });
  } catch (error) {
    console.error("Failed to write command to the device: ", err);
    res.status(500).json({ error: "Failed to write command to the device" });
  }

});

// ✅ Get last 100 readings
app.get("/api/readings", async (req, res) => {
  try {
    const readings = await SensorReading.find()
      .sort({ timestamp: -1 })
      .limit(600);
    res.json(readings);
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Failed to fetch readings" });
  }
});


// ✅ Get logs saved in PC
app.post("/api/log-command", (req, res) => {
  try {

    const { date, mac, command, status, message } = req.body;

    // console.log(date, mac, command, status, message);

    const now = new Date();
    const fileName = `${now.getDate()}_${now.getMonth() + 1
      }_${now.getHours()}.out`;
    // const outLogDir = "C:/CommandLogs/out";

    // if (!fs.existsSync(outLogDir)) {
    //   fs.mkdirSync(outLogDir, { recursive: true });
    // }

    const macDir = mac.replace(/[:. ]/g, "_");
    const deviceCmdDir = path.join(logDir, macDir);

    fs.mkdirSync(deviceCmdDir, { recursive: true });

    const filePath = path.join(deviceCmdDir, fileName);

    const timestamp = now.toLocaleString("en-IN");
    const logEntry = `[${timestamp}] | MAC:${mac} | ${status}  | COMMAND:"${command}" | MESSAGE:"${message}"`;

    // ✅ Send response immediately, log in background

    // File writing happens after response
    // fs.appendFile(filePath, logEntry, (err) => {
    //   if (err) {
    //     console.error("Failed to save log:", err);
    //   } else {
    //     if (eMS_LOGS) console.log(`✅ Log saved: ${filePath}`);
    //   }
    // });

    // ===================== Logging Command | OLD =====================
    //   writeLog(
    //   `${filePath}`,
    //   logEntry
    // );
    // ===================== Logging Command | RABBITMQ =====================

    publishLog({
      type: "out",
      mac,
      command,
      status,
      message,
      timestamp: new Date().toISOString()
    });

    res.json({ message: "Log received" });
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Failed to log" });
  }

});

//! ✅ Fetch logs from PC - CHECK THIS WHETHER IN USE OR NOT
// app.get("/api/device-logs", (req, res) => {
//   try {
//     const { mac, type = "inc", hours = 1 } = req.query;

//     if (!mac) return res.status(400).json({ error: "MAC required" });

//     const macDir = mac.replace(/[:. ]/g, "_");

//     let baseDir;
//     if (type === "inc") baseDir = IncLogDir;
//     else if (type === "out") baseDir = outLogDir;
//     else if (type === "alarm") baseDir = alarmLogDir;
//     else return res.status(400).json({ error: "Invalid log type" });

//     const deviceDir = path.join(baseDir, macDir);

//     if (!fs.existsSync(deviceDir)) {
//       return res.json({ logs: [] });
//     }

//     const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
//     const logs = [];

//     const files = fs.readdirSync(deviceDir)
//       .filter(f => f.endsWith(type === "out" ? ".out" : ".inc"))
//       .sort()
//       .reverse(); // latest first

//     for (const file of files) {
//       const filePath = path.join(deviceDir, file);
//       const content = fs.readFileSync(filePath, "utf-8");

//       content.split("\n").forEach(line => {
//         const match = line.match(/^\[(.*?)\]/);
//         if (!match) return;

//         const logTime = new Date(match[1]).getTime();
//         if (logTime >= cutoffTime) logs.push(line);
//       });
//     }

//     res.json({ logs: logs.reverse() });
//   } catch (err) {
//     console.error("Error fetching device logs:", err?.stack);
//   }


// });

app.get("/api/alarm-history", async (req, res) => {
  try {
    console.log("Calling Alarm History API")
    const { mac, from, to, page = 1, limit = 100 } = req.query;

    const pageNo = Number(page);
    const pageLimit = Number(limit);

    if (!mac || !from || !to) {
      return res.status(400).json({ error: "Missing mac, from or to" });
    }

    const fromDate = parseQueryDate(from);
    const toDate = parseQueryDate(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    if (toDate.getTime() < fromDate.getTime()) {
      return res.status(400).json({ error: "Invalid date range: 'to' must be >= 'from'" });
    }

    const macFolder = mac.replace(/[:. ]/g, "_");
    const baseDir = path.join(alarmLogDir, macFolder);;

    const cacheKey = `${mac}|${from}|${to}`;

    console.log("Base Dir: ", baseDir);

    if (!fs.existsSync(baseDir)) {
      console.log("Sending empty")
      return res.json({ mac, from, to, entries: [] });
    }
    let cache = alarmHistoryCache.get(cacheKey);

    if (cache) {

      console.log("✅ Returning alarm history from cache");

      const start = (pageNo - 1) * pageLimit;

      return res.json({
        entries: cache.entries.slice(start, start + pageLimit),
        total: cache.total,
        page: pageNo,
        limit: pageLimit,
        totalPages: Math.ceil(cache.total / pageLimit)
      });

    }

    // 🟢 Generate all hour blocks between from and to
    const filesToScan = getAlarmFiles(
      baseDir,
      fromDate,
      toDate
    );

    console.log("Files to scan:", filesToScan);

    const entries = [];

    if (filesToScan.length === 0) {
      return res.json({ mac, from, to, entries: [] });
    }

    // 🟢 Stream each file
    for (const filePath of filesToScan) {
      console.log("file loop")
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });

      let lineCount = 0;


      for await (const line of rl) {
        lineCount++;

        if (lineCount <= 5) {
          console.log("LINE:", line);
        }

        const text = String(line || "").trim();

        console.log("------------------------------------------------");
        console.log("LINE:", text);

        if (!text) {
          console.log("Skipped: Empty line");
          continue;
        }

        const tsMatch = text.match(/^\s*\[([^\]]+)\]/);

        if (!tsMatch) {
          console.log("Skipped: Regex didn't match");
          continue;
        }

        console.log("Timestamp String:", tsMatch[1]);

        const timestamp = parseIstLogTimestamp(tsMatch[1]);

        console.log("Parsed Timestamp:", timestamp);
        console.log("From:", fromDate);
        console.log("To:", toDate);

        if (!timestamp) {
          console.log("Skipped: Invalid timestamp");
          continue;
        }

        if (timestamp < fromDate || timestamp > toDate) {
          console.log("Skipped: Outside range");
          continue;
        }
        let payload = null;

        if (!text.includes("ALARM:")) {

          const pipeParts = text
            .split("|")
            .map(p => p.trim())
            .filter(Boolean);

          if (pipeParts.length < 3)
            continue;

          payload = pipeParts.slice(2).join(" | ");
        }

        const parsedEntries = parseAlarmLine(
          text,
          payload,
          timestamp
        );

        console.log("Parsed:", parsedEntries);

        if (parsedEntries && parsedEntries.length) {
          entries.push(...parsedEntries);
        }
      }
    }
    console.log("Logs send successfully to UI")

    const start = (pageNo - 1) * pageLimit;

    const pageEntries = entries.slice(
      start,
      start + pageLimit
    );

    alarmHistoryCache.set(
      cacheKey,
      entries,
      baseDir
    );

    res.json({
      mac,
      from,
      to,
      entries: pageEntries,
      total: entries.length,
      page: pageNo,
      limit: pageLimit,
      totalPages: Math.ceil(entries.length / pageLimit)
    });


  } catch (err) {

    console.error("===== Alarm History Error =====");
    console.error(err);
    console.error(err.stack);

    res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack
    });
  }
})

// HISTORICAL DATA
app.get("/api/historical-data", async (req, res) => {
  const { mac, datetime } = req.query;
  console.log("MAC: ", mac, " | Date ", datetime);

  if (!mac || !datetime)
    return res.status(400).json({ error: "Missing mac or datetime" });

  const normalizedMac = mac.toLowerCase(); //! Converting to LowerCase()
  const datetimeObj = new Date(datetime);

  if (isNaN(datetimeObj.getTime()))
    return res.status(400).json({ error: "Invalid datetime format" });

  const selectedDate = new Date(datetimeObj);
  selectedDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);

  console.log("Date passing to DB: ", selectedDate, nextDate);

  try {
    const readings = await SensorReading.find({
      mac: normalizedMac,
      timestamp: { $gte: selectedDate, $lt: nextDate },
    }).sort({ timestamp: 1 });
    const atSelectedTime = await SensorReading.findOne({
      mac: normalizedMac,
      timestamp: { $lte: datetimeObj },
    }).sort({ timestamp: -1 });
    res.json({ readings, atSelectedTime });
  } catch (err) {
    console.error("Historical data error:", err.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// ✅ Debug routes
// app.use('/debug', require('./auth/debug'));


// 📡 TCP Server
const BULK_SAVE_LIMIT = 1000;
let readingBuffer = [];
let alreadyReplied = 0;

const eMS_LOGS = process.env.eMS_LOGS === "true";
// console.log(`[BOOT] eMS_LOGS is`, eMS_LOGS);

const INC_LOGS_CMD = process.env.INC_LOGS_CMD === "true";
const OUT_LOGS_CMD = process.env.OUT_LOGS_CMD === "true";
const ALARM_LOGS_CMD = process.env.ALARM_LOGS_CMD === "true";
const SNAP_CMD = process.env.SNAP_CMD === "true";

const IncLogDir = process.env.INC_LOG_DIR;
const outLogDir = process.env.OUT_LOG_DIR;
const alarmLogDir = process.env.ALARM_LOG_DIR;
const snapshotOutputDir = process.env.SNAP_DIR;

const logDir = outLogDir;


function dirCheck(dir, enabled) {
  if (!enabled) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create dir ${dir}:`, err.message);
  }
}

dirCheck(IncLogDir, INC_LOGS_CMD);
dirCheck(outLogDir, OUT_LOGS_CMD);
dirCheck(alarmLogDir, ALARM_LOGS_CMD);
dirCheck(snapshotOutputDir, SNAP_CMD);

// Function to get formatted Date and Time
/*
  Pass any string to function to get Date & Time in below format: 
  20_01_26_12_45_52

  Without passing any argument will get below Data & Time format: 
  20/01/26 12:45:52
*/
function getFormattedDateTime(outType = 'string') {
  // Pass any string to function if you want output in second way
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(today.getDate());
  const mm = pad(today.getMonth() + 1);
  const yy = String(today.getFullYear()).slice(-2);
  const HH = pad(today.getHours());
  const MM = pad(today.getMinutes());
  const SS = pad(today.getSeconds());

  if (outType === 'string') {
    return `${dd}/${mm}/${yy} ${HH}:${MM}:${SS}`;
  } else {
    return `${dd}_${mm}_${yy}_${HH}_${MM}_${SS}`;
  }
}

function sendX(socket) {
  const msg = `%X000${getFormattedDateTime()}$`;
  console.log(`⬅️ Sending back: ${msg}`);
  const ok = socket.write(msg);
  if (!ok) {
    console.warn("⚠️ Backpressure: socket buffer is full, write queued");
  }
}

// *=================================== CLEANING CODE ===================================
// Function to delete DB Records
async function DBCleanup() {
  try {
    const MAX_DOCS = parseInt(process.env.MAX_SENSOR_DOCS || '50000', 10);
    // const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '15', 10);

    // Getting 'SensorReading' count
    const sensorRecordsCount = await SensorReading.countDocuments();
    if (sensorRecordsCount === 0) {
      console.log("No Sensor Data found", 'CLEANUP');
      return;
    }


    if (sensorRecordsCount > MAX_DOCS) {
      // Getting the boundary Document of SensorReading to delete all documents before from that bounday date
      const boundaryDoc = await SensorReading
        .findOne({}, { timestamp: 1 })
        .sort({ timestamp: -1 }) // Latest Doc first
        .skip(MAX_DOCS - 1);

      if (!boundaryDoc || !boundaryDoc.timestamp) {
        console.error("Unable to determine boundary timestamp for capping", 'CLEANUP');
        return;
      }

      // Deleting Documents
      const capRes = await SensorReading.deleteMany({
        timestamp: { $lt: boundaryDoc.timestamp }
      });
      if (eMS_LOGS) console.log(`Count capping: deleted ${capRes.deletedCount} docs older than ${boundaryDoc.timestamp.toISOString()}`, 'CLEANUP');
    }
  } catch (err) {
    console.error("Error in DB cleanup", err);
  }
}

// Cleaning up DB hourly
function hourlyDBCleanup() {
  let isCleaning = false;

  const runCleanup = async () => {
    if (isCleaning) {
      if (eMS_LOGS) console.log("Cleanup already running, skipping this tick", 'CLEANUP');
      return;
    }
    isCleaning = true;
    try {
      await DBCleanup();
    } catch (e) {
      // getData already logs errors
    } finally {
      isCleaning = false;
    }
  };

  // Run immediately, then hourly
  runCleanup();
  setInterval(runCleanup, 60 * 60 * 1000);
}

hourlyDBCleanup();

// Function to delete log files older than 3 days
function deleteLogFiles() {
  // const IncLogDir = "C:/CommandLogs/inc";

  const daysThreshold = 3;
  const thresholdTime = Date.now() - (daysThreshold * 24 * 60 * 60 * 1000);

  fs.readdir(IncLogDir, (err, macDirs) => {
    if (err) {
      // If directory doesn't exist, that's fine - nothing to delete
      if (err.code === 'ENOENT') return;
      console.error(`⚠️ Error reading log directory: ${err}`);
      return;
    }

    macDirs.forEach(macDir => {

      const fullDir = path.join(IncLogDir, macDir);

      // fs.stat(filePath, (err, stats) => {
      //   if (err) {
      //     console.error(`⚠️ Error getting stats for ${filename}: ${err}`);
      //     return;
      //   }

      //   // Check if file is older than threshold
      //   if (stats.mtimeMs < thresholdTime) {
      //     fs.unlink(filePath, (err) => {
      //       if (err) {
      //         console.error(`⚠️ Error deleting ${filename}: ${err}`);
      //       } else {
      //         console.log(`✅ ${filename} successfully deleted ✅`);
      //       }
      //     });
      //   }
      // });

      if (!fs.statSync(fullDir).isDirectory()) return;

      fs.readdir(fullDir, (err, files) => {
        if (err) return;

        files.forEach(file => {
          if (!file.endsWith('.inc')) return;

          const filePath = path.join(fullDir, file);
          fs.stat(filePath, (err, stats) => {
            if (stats.mtimeMs < thresholdTime) {
              fs.unlink(filePath, () => { });
            }
          });
        });
      });
    });
  });
}

function logCleanupScheduler() {
  // Run immediately, then every 24 hours
  deleteLogFiles();
  setInterval(deleteLogFiles, 24 * 60 * 60 * 1000);
}
logCleanupScheduler();
// *=================================== CLEANING CODE ===================================


function getLogStream(filePath) {
  if (!logStreams[filePath]) {
    // make sure directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    logStreams[filePath] = fs.createWriteStream(filePath, {
      flags: "a" // append mode
    });

    logStreams[filePath].on("error", (err) => {
      console.error("Log stream error:", err.message);
    });
  }

  return logStreams[filePath];
}

function writeLog(filePath, data) {
  const stream = getLogStream(filePath);
  stream.write(data + "\n");
}

const tempCalibrationTable = [
  { min: 0, max: 10, factor: 0 },
  { min: 11, max: 20, factor: 0 },
  { min: 21, max: 30, factor: 0 },
  { min: 31, max: 40, factor: 0.05 },
  { min: 41, max: 50, factor: 0.07 },
  { min: 51, max: 60, factor: 0.09 },
  { min: 61, max: 70, factor: 0.10 },
];

function calibrateTemperature(temp) {
  if (typeof temp !== "number") return temp;

  const range = tempCalibrationTable.find(
    r => temp >= r.min && temp <= r.max
  );

  if (!range) return temp;

  return temp * (1 + range.factor);
}

setInterval(() => {
  if (readingBuffer.length === 0) return;

  const toSave = readingBuffer.splice(0, BULK_SAVE_LIMIT);

  SensorReading.insertMany(toSave, { ordered: false })
    .catch(err =>
      console.error("Periodic bulk save error:", err.message)
    );

}, 2000);


const server = net.createServer((socket) => {
  // let buffer = Buffer.alloc(0);
  socket.buffer = Buffer.alloc(0);


  const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
  const connStart = Date.now();
  if (eMS_LOGS) {
    console.log(`[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`);
  }
  console.log(`[LOG] New TCP Connection from ${clientInfo} at ${new Date(connStart).toISOString()}`);
  console.log(`New TCP Connection from`, clientInfo);

  socket.on("data", async (data) => {
    let packetCount = 0;
    const dataStart = Date.now();
    // buffer = Buffer.concat([buffer, data]);
    socket.buffer = Buffer.concat([socket.buffer, data]);
    const PACKET_LEN = 58;

    try {
      // console.packetCount++;
      // debug.lastPacketTime = Date.now();
      // debug.bufferStats.discardedBytes.totalBytes += data.length;

      // console.log(`Raw data received ${data.toString('hex')} with length (${data.length} bytes) from`, clientInfo);
      console.log(`Raw data received with length (${data.length} bytes) from`, clientInfo);
      // console.log("Raw data received")
      // console.log(`Raw data hex preview:`, data.toString('hex').substring(0, 100) + '...');

      // buffer = Buffer.concat([buffer, data]);
      // console.log(`Total buffer size: ${buffer.length} bytes`);

      // let mac = null;
      while (socket.buffer.length >= 58 ||
        socket.buffer.slice(0, 6).toString("ascii") === "#EVENT"
      ) {
        packetCount++;

        // Handle protocol preamble once after device restart
        if (!socket.preambleHandled && socket.buffer.length >= 4) {
          const preamble = socket.buffer.slice(0, 4).toString('ascii');
          if (preamble === 'tcp2') {
            socket.buffer = socket.buffer.slice(4);
            socket.preambleHandled = true;
          }
        }

        if (
          socket.buffer.length >= 6 &&
          socket.buffer.slice(0, 6).toString("ascii") === "#EVENT"
        ) {

          // Dump packet ends with \r\n
          const endIndex = socket.buffer.indexOf(
            Buffer.from("\r\n")
          );

          // Complete dump packet has not arrived yet
          if (endIndex === -1) {
            break;
          }

          // Extract only #EVENT ... \r\n
          const dumpBuffer = socket.buffer.slice(0, endIndex + 2);

          // Remove dump packet from buffer
          socket.buffer = socket.buffer.slice(endIndex + 2);

          // Remove NUL padding if present
          const dumpPacket = dumpBuffer
            .toString("ascii")
            .replace(/\0/g, "")
            .trim();

          console.log("========================================");
          console.log("📜 PAST ALARM DUMP RECEIVED");
          console.log("IP:", "will be extracted separately if needed");
          console.log("Length:", dumpBuffer.length);
          console.log(dumpPacket);
          console.log("========================================");

          // Send dump packet to Incoming Log Worker
          if (INC_LOGS_CMD) {
            publishLog({
              type: "dump",
              
              mac: socket.deviceId || "UNKNOWN",
              packet: dumpPacket,
              timestamp: new Date().toISOString()
            });
          }

          continue;
        }

        const header = socket.buffer.slice(0, 8).toString('ascii');

        if (!/^[0-9a-fA-F]{8}$/.test(header)) {
          // corrupted / misaligned packet → resync like MAC server
          socket.buffer = socket.buffer.slice(1);
          continue;
        }

        const ipHexAscii = socket.buffer.slice(0, 8).toString('ascii');

        // Convert hex pairs → decimal
        const ip = ipHexAscii
          .match(/.{2}/g)
          .map(h => parseInt(h, 16))
          .join('.');

        // Reject obvious garbage IPs
        if (!ip.startsWith('192.168.')) {
          console.warn('🚫 Dropping invalid IP:', ip);
          socket.buffer = socket.buffer.slice(1);
          continue;
        }

        // console.log("EXTRACTED IP: ", ip);

        // wait for full packet
        if (socket.buffer.length < 58) break;

        const packet = socket.buffer.slice(0, 58);
        socket.buffer = socket.buffer.slice(58);

        // const ip = `${packet[0]}.${packet[1]}.${packet[2]}.${packet[3]}`;

        //! =============== CODE FOR MAC CHECKING =============== 
        // const bufStr = buffer.toString("utf-8");

        // // Search for first valid MAC pattern in buffer string
        // const macPattern = /[0-9]{3}(.[0-9]{3})(.[0-9]{1})(.[0-9]{3})/;
        // const match = bufStr.match(macPattern);

        // if (!match) {
        //   console.warn(
        //     `No IP found in buffer, discarding ${buffer.length} bytes`
        //   );
        //   buffer = Buffer.alloc(0);
        //   break;
        // }

        // const macStartIndex = bufStr.indexOf(match[0]);

        // if (macStartIndex > 0) {
        //   console.warn(`Discarding ${macStartIndex} bytes of junk before MAC`);
        //   buffer = buffer.slice(macStartIndex);
        //   continue;
        // }

        // if (socket.buffer.length < 58) {
        //   // Wait for more data for complete packet
        //   break;


        // Extract one full packet starting at MAC
        // const packet = buffer.slice(0, 58);

        // const macRaw = packet.subarray(0, 17);
        // let macRawStr = macRaw.toString("utf-8");
        // console.log(
        //   `Received MAC: [${macRawStr}], length: ${macRawStr.length}`
        // );

        // Sanitize and verify MAC
        // const sanitizedMac = macRawStr.replace(/[^0-9A-Fa-f:]/g, "");
        // const macRegex = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
        // if (sanitizedMac.length !== 17 || !macRegex.test(sanitizedMac)) {
        //   console.warn(`⚠️ Dropping malformed MAC: INVALID_${Date.now()}`);
        //   buffer = buffer.slice(58);
        //   continue;
        // }
        //! =============== CODE FOR MAC CHECKING =============== 


        // console.log("Extracted IP: ", extractedIP);
        const mac = ip; //! Converting to LowerCase()
        const humidity = +packet.readFloatLE(17).toFixed(2);
        const insideTemperature = +packet.readFloatLE(21).toFixed(2);
        const outside = +packet.readFloatLE(25).toFixed(2); // "+" converts string to number as toFixed return string

        const outsideTemperature = calibrateTemperature(outside);

        const lockStatus = packet[29] === 1 ? "OPEN" : "CLOSED";
        const doorStatus = packet[30] === 1 ? "OPEN" : "CLOSED";
        const waterLogging = !!packet[31]; // "!!" -> converts true/false to 1/0
        const waterLeakage = !!packet[32];

        const outputVoltage = (+packet.readInt16LE(33).toFixed(2)) / 100;
        const hupsDVC = (+packet.readInt16LE(35).toFixed(2)) / 100;
        const inputVoltage = (+packet.readInt16LE(37).toFixed(2)) / 100;
        const hupsBatVolt = packet.readInt16LE(39);
        const batteryBackup = +packet.readFloatLE(41).toFixed(2);

        const alarmActive = !!packet[45];
        const fireAlarm = packet[46];
        const fanLevel1Running = !!packet[47];
        const fanLevel2Running = !!packet[48];
        const fanLevel3Running = !!packet[49];
        const fanLevel4Running = !!packet[50];

        const padding = packet[51]; // unused
        const fanStatusBits = packet.readUInt16LE(52);

        const pwsFailCount = packet[54]; // Password Failure Count
        const hupsStat = packet[55];
        const hupsRes = packet[56];
        const failMask = packet[57];

        // console.log("Fire Alarm: ", fireAlarm);
        // console.log("pwsFailCount: ", pwsFailCount);

        const packetTimestamp = new Date();
        const macDir = mac.replace(/[:. ]/g, '_');

        // Getting HUPS Alarms
        const hupsAlarms = []
        /* 
            Extracting Individual HUPS Alarms from 'hupsStat' using bitwise operations. 
            Each alarm is represented by a single bit within the 'hupsStat' integer. 
            The loop iterates 8 times (for 8 alarms), extracting each bit and 
            storing the alarm status in the 'hupsAlarms' array.
        */
        for (let i = 0; i < 8; i++) {
          hupsAlarms[i] = (hupsStat >> (i) & 0x01);
        }

        console.log("hups", hupsAlarms)
        /*
          Extracting Individual Fan Status from 'fanStatusBits' using bitwise operations. 
          Each fan's status is represented by 2 bits within the 'fanStatusBits' integer. 
          The loop iterates 6 times (for 6 fans), extracting the relevant 2 bits for each fan and 
          storing the status in the 'fanStatus' array.
        */
        const fanStatus = [];
        for (let i = 0; i < 6; i++) {
          fanStatus[i] = (fanStatusBits >> (i * 2)) & 0x03; // 0=off, 1=healthy, 2=faulty
        }
        // console.log("Padding: ", padding);

        // ==== LOGGING EXTRACTED VALUES ====
        // console.log("Humidity: ", humidity);
        // console.log("Input Voltage: ", inputVoltage);
        // ==== LOGGING EXTRACTED VALUES ====



        if (padding === 0x31 && !alreadyReplied) {
          sendX(socket);
          alreadyReplied = 40; // Load Balancing
        }


        // ===================== RABBITMQ SNAPSHOT LOGIC =====================
        if ((padding === 0x43) && (doorStatus === "OPEN")) {
          console.log("Inside snapshot", mac)
          const deviceMeta = deviceCache.get(String(mac).toLowerCase());

          // if (!deviceMeta || !deviceMeta.cameraType || !deviceMeta.cameraIP) {
          //   console.warn(`⚠ No camera metadata found for ${mac}, skipping snapshot publish`);
          // } else {
          //   console.log("publish snapshot", mac)
          //   publishSnapshot({
          //     mac,
          //     cameraType: String(deviceMeta.cameraType).trim(),
          //     cameraIP: mac,
          //     // cameraIP: String(deviceMeta.cameraIP).trim(),
          //     requestedAt: new Date().toISOString()
          //   });
          // }

          publishSnapshot({
            mac,
            cameraType: String(deviceMeta.cameraType).trim(),
            cameraIP: mac,
            // cameraIP: String(deviceMeta.cameraIP).trim(),
            requestedAt: new Date().toISOString()
          });

        }
        // ===================== RABBITMQ SNAPSHOT LOGIC =====================


        // ===================== Logging Incoming Data from Simulator | RABBITMQ =====================
        if (INC_LOGS_CMD) {
          publishLog({
            type: "inc",
            mac,
            humidity,
            insideTemperature,
            outsideTemperature,
            inputVoltage,
            outputVoltage,
            batteryBackup,
            timestamp: new Date().toISOString()
          });
        }
        // ===================== Logging Incoming Data from Simulator | RABBITMQ =====================



        if (alreadyReplied) alreadyReplied--;

        // Extracting Fans Status
        // console.log("fanStatus", fanStatusBits);


        // console.log("Password Bit: ", pwsFailCount)// <-- Critical offset //Password

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
          // buffer = buffer.slice(58);
          // continue;
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

        // const activeAlarms = [];

        // if (thresholdAlarms.insideTemperatureAlarm) {
        //   activeAlarms.push(`Inside Temperature: ${insideTemperature}`);
        // }
        // if (thresholdAlarms.outsideTemperatureAlarm) {
        //   activeAlarms.push(`Outside Temperature: ${outsideTemperature}`);
        // }
        // if (thresholdAlarms.humidityAlarm) {
        //   activeAlarms.push(`Humidity: ${humidity}`);
        // }
        // if (thresholdAlarms.inputVoltageAlarm) {
        //   activeAlarms.push(`Input Voltage: ${inputVoltage}`);
        // }
        // if (thresholdAlarms.outputVoltageAlarm) {
        //   activeAlarms.push(`Output Voltage: ${outputVoltage}`);
        // }
        // if (thresholdAlarms.batteryBackupAlarm) {
        //   activeAlarms.push(`Battery Backup: ${batteryBackup}`);
        // }

        // if (waterLogging) {
        //   activeAlarms.push("Water Logging Alarm");
        //   // console.log("Water Logging Alarm")
        // }

        // if (waterLeakage) {
        //   activeAlarms.push("Water Leakage Alarm");
        //   // console.log("Water Leakage Alarm")
        // }

        // if (doorStatus === "OPEN") {
        //   activeAlarms.push("Door Alarm");
        //   // console.log("Door Alarm")
        // }

        // if (lockStatus === "OPEN") {
        //   activeAlarms.push("Lock Alarm");
        //   // console.log("Lock Alarm")
        // }

        // if (fireAlarm) {
        //   activeAlarms.push("Fire Alarm");
        //   // console.log("Fire Alarm")
        // }


        // ========================== RABBIT MQ ALARM PROCESSING ==========================
        // if (activeAlarms.length > 0) {
        //   publishAlarmResult({
        //     mac,
        //     alarms: activeAlarms,
        //     fanStatus,
        //     timestamp: new Date().toISOString()
        //   });
        // }
        // ========================== RABBIT MQ ALARM PROCESSING ==========================


        // Single console output
        // if (activeAlarms.length > 0) {

        // ========================== RABBIT MQ ALARM WORKER ==========================
        // console.log("Running PublishAlarm() worder")
        // publishAlarm({
        //   mac,
        //   alarms: activeAlarms,
        //   fanStatus,
        //   timestamp: new Date(),
        //   logType: 'alarm',
        //   baseDir: alarmLogDir
        // })

        publishAlarm({
          mac,
          humidity,
          insideTemperature,
          outsideTemperature,
          inputVoltage,
          outputVoltage,
          batteryBackup,
          waterLogging,
          waterLeakage,
          doorStatus,
          lockStatus,
          fireAlarm,
          fanStatus,
          pwsFailCount,
          timestamp: new Date(),
          mainStatus: hupsAlarms[0],
          rectStatus: hupsAlarms[1],
          inveStatus: hupsAlarms[2],
          overStatus: hupsAlarms[3],
          mptStatus: hupsAlarms[4],
          mosfStatus: hupsAlarms[5]
        });

        // ========================== RABBIT MQ ALARM WORKER ==========================
        // }

        socket.deviceId = mac;
        connectedDevices.set(mac, socket);

        // Build and save the reading (fan status is now independent, not derived)
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
          hupsDVC,
          inputVoltage,
          hupsBatVolt,
          batteryBackup,
          alarmActive,
          fireAlarm,
          fanLevel1Running,
          fanLevel2Running,
          fanLevel3Running,
          fanLevel4Running,
          // fanFailBits, // keep for legacy (optional)
          pwsFailCount, // keep for legacy (optional)
          fan1Status: fanStatus[0],
          fan2Status: fanStatus[1],
          fan3Status: fanStatus[2],
          fan4Status: fanStatus[3],
          fan5Status: fanStatus[4],
          fan6Status: fanStatus[5],
          mainStatus: hupsAlarms[0],
          rectStatus: hupsAlarms[1],
          inveStatus: hupsAlarms[2],
          overStatus: hupsAlarms[3],
          mptStatus: hupsAlarms[4],
          mosfStatus: hupsAlarms[5],
          hupsRes,
          ...thresholdAlarms,
          // Set timestamp to IST
          timestamp: packetTimestamp
        });

        // readingBuffer = readingBuffer.filter(r => r.mac !== mac);
        readingBuffer.push(reading);
        // console.log(`[BUFFER] pushed reading; readingBuffer.length=${readingBuffer.length}`);
        // console.log(`[eMS_LOGS] Finished parsing packet for MAC: ${mac}`);

        if (readingBuffer.length >= BULK_SAVE_LIMIT) {
          const toSave = [...readingBuffer];
          readingBuffer = [];
          SensorReading.insertMany(toSave)
            .catch((err) =>
              console.error("Bulk save error:", err.message)
            );
        }

        // setImmediate(async () => {
        //   if (readingBuffer.length >= BULK_SAVE_LIMIT) {
        //     const batch = readingBuffer.splice(0);
        //     await SensorReading.insertMany(batch, { ordered: false });
        //   }
        // });

        // socket.buffer = socket.buffer.slice(PACKET_LEN);

        // debugger;
        // if (eMS_LOGS) console.log(`✅ Packet processed successfully for MAC: ${mac}`, `Time: ${getFormattedDateTime()}`);
      }
    } catch (err) {
      console.error("Packet parsing failed:", err.message);
      socket.destroy();
    }
  });

  socket.on("end", () => {
    for (const [mac, sock] of connectedDevices.entries()) {
      if (sock === socket) {
        connectedDevices.delete(socket.deviceId);
        console.log(`Device ${mac} disconnected`);
      }
    }
  });

  socket.on("error", (err) => {
    if (err.code !== "ECONNRESET") {
      console.error("Socket error:", err.message);
    }
  });


  // setInterval(() => {
  //   if (readingBuffer.length > 0) {
  //     const toSave = [...readingBuffer];
  //     readingBuffer = [];
  //     SensorReading.insertMany(toSave)
  //       .then((docs) => {
  //         docs.forEach(doc => {
  //           console.log(`✅ Saved reading in DB (periodic): MAC=${doc.mac}, timestamp=${doc.timestamp}`);
  //         });
  //       })
  //       .catch((err) =>
  //         console.error("Periodic bulk save error:", err.message)
  //       );
  //   }
  // }, 5000);

});

server.listen(4000, "0.0.0.0", () => {
  console.log("TCP server listening on port 4000");
});

app.listen(5000, "0.0.0.0", () => {
  console.log("HTTP server running on port 5000");
});

// setInterval(async () => {
//   if (readingBuffer.length === 0) return;

//   const batch = readingBuffer.splice(0, BULK_SAVE_LIMIT);

//   try {
//     await SensorReading.insertMany(batch, { ordered: false });
//   } catch (err) {
//     console.error("❌ Bulk insert failed:", err.message);
//   }
// }, 200); // flush every 200ms


