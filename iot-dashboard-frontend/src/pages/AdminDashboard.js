import React, { useState, useEffect } from "react";
import "../App.css";
import DashboardView from "./DashboardView";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import PasswordPrompt from "../components/PasswordPrompt";

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState("register-user");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  return (
    <div className={`admin-dashboard ${sidebarCollapsed ? "collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <button className="collapse-toggle" onClick={toggleSidebar}>
          {sidebarCollapsed ? "➡️" : "⬅️"}
        </button>
        {!sidebarCollapsed && <h3>🛠 Admin Panel</h3>}
        <ul>
          <li
            onClick={() => setActiveTab("register-user")}
            className={activeTab === "register-user" ? "active" : ""}
          >
            👤 {sidebarCollapsed ? "" : "Register User"}
          </li>
          <li
            onClick={() => setActiveTab("register-device")}
            className={activeTab === "register-device" ? "active" : ""}
          >
            📡 {sidebarCollapsed ? "" : "Register Device"}
          </li>
          <li className={activeTab === "color-scheme" ? "active" : ""}>
            🎨 {sidebarCollapsed ? "" : "Alarm Colors"}
          </li>
          <li
            onClick={() => setActiveTab("console")}
            className={activeTab === "console" ? "active" : ""}
          >
            📊 {sidebarCollapsed ? "" : "Console"}
          </li>
          <li
            onClick={() => setActiveTab("historical-data")}
            className={activeTab === "historical-data" ? "active" : ""}
          >
            📈 {sidebarCollapsed ? "" : "Historical Data"}
          </li>
        </ul>
      </aside>

      <main className="tab-content">
        {activeTab === "register-user" && <RegisterUserTab />}
        {activeTab === "register-device" && <RegisterDeviceTab />}
        {activeTab === "color-scheme" && (
          <p>🎨 Alarm color customization (coming soon)</p>
        )}
        {activeTab === "console" && <DashboardView />}
        {activeTab === "historical-data" && <HistoricalDataTab />}
      </main>
    </div>
  );
};

// ---------------- Register User Tab ----------------
const RegisterUserTab = () => {
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "block",
  });
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/api/users`);
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error("❌ Failed to fetch users:", err);
    }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("");
    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/register-user`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register user");
      setStatus("✅ User registered successfully");
      setForm({ username: "", password: "", role: "block" });
      fetchUsers();
    } catch (err) {
      setStatus("❌ " + err.message);
    }
  };

  const requestPassword = (callback) => {
    setPendingAction(() => callback);
    setShowPrompt(true);
  };

  const handleEdit = (user, newUsername, newPassword) => {
    requestPassword(async (adminPassword) => {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_API_URL}/api/user/${user._id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: newUsername,
              password: newPassword,
              adminPassword,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed");
        alert("✅ User updated");
        fetchUsers();
      } catch (err) {
        alert("❌ " + err.message);
      }
    });
  };

  const handleDelete = (user) => {
    if (user.role === "admin") {
      alert("❌ Cannot delete an admin user");
      return;
    }
    requestPassword(async (adminPassword) => {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_API_URL}/api/user/${user.username}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPassword }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Delete failed");
        alert("✅ User deleted");
        fetchUsers();
      } catch (err) {
        alert("❌ " + err.message);
      }
    });
  };

  return (
    <div>
      <h2>👤 Register New User</h2>
      <form onSubmit={handleSubmit} className="admin-form">
        <input
          type="text"
          placeholder="Username"
          value={form.username}
          maxLength={17}
          title="Maximum 17 characters"
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          title="Min 8 chars: 1 uppercase, 1 lowercase, 1 number, 1 special char"
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="admin">Admin</option>
          <option value="block">Block Officer</option>
          <option value="gp">GP Officer</option>
          <option value="user">Common User</option>
        </select>
        <button type="submit">Register</button>
        {status && <p>{status}</p>}
      </form>

      <h3>📋 Registered Users</h3>
      <table className="device-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(users) && users.length > 0 ? (
            users.map((user) => (
              <UserRow
                key={user._id}
                user={user}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          ) : (
            <tr>
              <td colSpan="4">⚠️ No users available or failed to load.</td>
            </tr>
          )}
        </tbody>
      </table>

      {showPrompt && (
        <PasswordPrompt
          onSubmit={(password) => {
            pendingAction(password);
            setShowPrompt(false);
          }}
          onCancel={() => setShowPrompt(false)}
        />
      )}
    </div>
  );
};

// ------------- UserRow Component (updated inputs) ---------------
const UserRow = ({ user, onEdit, onDelete }) => {
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    username: user.username,
    password: "",
  });

  const handleSave = () => {
    if (!formData.username || !formData.password) {
      alert("⚠️ Username and Password are required.");
      return;
    }
    console.log("User Edit Form Data", formData);
    console.log("user", user)
    onEdit(user, formData.username, formData.password);
    setEditMode(false);
  };

  return (
    <tr>
      <td>
        {editMode ? (
          <input
            value={formData.username}
            maxLength={17}
            title="Maximum 17 characters"
            onChange={(e) =>
              setFormData({ ...formData, username: e.target.value })
            }
          />
        ) : (
          user.username
        )}
      </td>
      <td>{user.role}</td>
      <td>
        {editMode ? (
          <>
            <input
              type="password"
              placeholder="New password"
              title="Min 8 chars: 1 uppercase, 1 lowercase, 1 number, 1 special char"
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              style={{ marginRight: "5px" }}
            />
            <button onClick={handleSave}>💾 Save</button>
          </>
        ) : (
          <button onClick={() => setEditMode(true)}>✏️ Edit</button>
        )}
      </td>
      <td>
        <button onClick={() => onDelete(user)} disabled={user.role === "admin"}>
          ❌ Delete
        </button>
      </td>
    </tr>
  );
};

// ---------------- Register Device Tab ----------------
const RegisterDeviceTab = () => {
  const [form, setForm] = useState({
    mac: "",
    locationId: "",
    address: "",
    latitude: "",
    longitude: "",
    ipCamera: "",
  });
  const [status, setStatus] = useState("");
  const [deviceList, setDeviceList] = useState([]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchDevices = async () => {
    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/devices-info`
      );
      const data = await res.json();
      setDeviceList(data);
    } catch (err) {
      console.error("Failed to fetch devices:", err);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setStatus("");
    const macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
    const cleanedMac = form.mac.trim();
    if (!macRegex.test(cleanedMac)) {
      setStatus("❌ Invalid MAC address format. Use XX:XX:XX:XX:XX:XX");
      return;
    }
    // Check if MAC already exists
    const macExists = deviceList.some(
      (device) => device.mac.toLowerCase() === cleanedMac.toLowerCase()
    );
    if (macExists) {
      setStatus("❌ This MAC address already exists.");
      return;
    }
    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/register-device`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mac: cleanedMac,
            locationId: form.locationId,
            address: form.address,
            latitude: +form.latitude,
            longitude: +form.longitude,
            ipCamera: form.ipCamera,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Device registration failed");
      setStatus("✅ Device registered");
      setForm({
        mac: "",
        locationId: "",
        address: "",
        latitude: "",
        longitude: "",
        ipCamera: "",
      });
      fetchDevices();
    } catch (err) {
      setStatus(`❌ ${err.message}`);
    }
  };

  // Update deviceList instantly with backend response
  const handleDeviceUpdated = (updatedDevice) => {
    setDeviceList((prevDevices) =>
      prevDevices.map((dev) =>
        dev.mac === updatedDevice.mac ? { ...updatedDevice } : dev
      )
    );
  };

  return (
    <div>
      <h2>📡 Register New Device</h2>
      <form onSubmit={handleRegister} className="admin-form">
        <input
          type="text"
          placeholder="MAC Address"
          value={form.mac}
          maxLength={17}
          pattern="^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$"
          title="Format: XX:XX:XX:XX:XX:XX (hex digits only)"
          onChange={(e) => setForm({ ...form, mac: e.target.value })}
          required
        />

        <input
          type="text"
          placeholder="Location ID"
          value={form.locationId}
          maxLength={17}
          title="Maximum 17 characters"
          onChange={(e) => setForm({ ...form, locationId: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="Address"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          required
        />
        <input
          type="number"
          step="0.000001"
          pattern="^-?\d{1,2}\.\d{1,6}$"
          title="Latitude must be a number with up to 6 decimals"
          placeholder="Latitude"
          value={form.latitude}
          onChange={(e) => setForm({ ...form, latitude: e.target.value })}
          required
        />
        <input
          type="number"
          step="0.000001"
          pattern="^-?\d{1,3}\.\d{1,6}$"
          title="Longitude must be a number with up to 6 decimals"
          placeholder="Longitude"
          value={form.longitude}
          onChange={(e) => setForm({ ...form, longitude: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="IP Camera URL"
          value={form.ipCamera}
          onChange={(e) => setForm({ ...form, ipCamera: e.target.value })}
        />
        <button type="submit">Register Device</button>
        {status && <p>{status}</p>}
      </form>

      <h3>📋 Registered Devices</h3>
      <table className="device-table">
        <thead>
          <tr>
            <th>MAC</th>
            <th>Location ID</th>
            <th>Address</th>
            <th>Latitude</th>
            <th>Longitude</th>
            <th>Camera</th>
            <th>Action</th>
            <th>Edit</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(deviceList) && deviceList.length > 0 ? (
            deviceList.map((device) => (
              <EditableRow
                key={device.mac}
                device={device}
                onUpdated={handleDeviceUpdated}
              />
            ))
          ) : (
            <tr>
              <td colSpan="8">⚠️ No devices available or failed to load.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// Editable device row with update using backend response
const EditableRow = ({ device, onUpdated }) => {
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({ ...device });

  useEffect(() => {
    if (editMode) {
      setFormData({ ...device });
    }
  }, [editMode]);

  const askAdminPassword = async () => {
    const password = prompt("Enter admin password:");
    if (!password) {
      alert("⚠️ Action cancelled: No password entered.");
      return null;
    }
    return password;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const saveEdit = async () => {
    const password = await askAdminPassword();
    if (!password) return;

    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/device/${device.mac}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...formData, password }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to update device");
      }

      const updatedDevice = await res.json();
      setEditMode(false);
      onUpdated(updatedDevice);
    } catch (err) {
      alert("Error updating device: " + err.message);
    }
  };

  const handleDelete = async () => {
    const password = await askAdminPassword();
    if (!password) return;

    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/device/delete/${device.mac}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      alert("✅ Device deleted successfully");
    } catch (err) {
      alert("❌ Error deleting device: " + err.message);
    }
  };

  return (
    <tr>
      <td>{device.mac}</td>
      <td>
        {editMode ? (
          <input
            type="text"
            name="locationId"
            maxLength={17}
            title="Maximum 17 characters"
            value={formData.locationId}
            onChange={handleChange}
          />
        ) : (
          device.locationId
        )}
      </td>
      <td>
        {editMode ? (
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
          />
        ) : (
          device.address
        )}
      </td>
      <td>
        {editMode ? (
          <input
            type="number"
            name="latitude"
            step="0.000001"
            pattern="^-?\d{1,2}\.\d{1,6}$"
            title="Latitude must be a number with up to 6 decimals"
            value={formData.latitude}
            onChange={handleChange}
          />
        ) : (
          device.latitude
        )}
      </td>
      <td>
        {editMode ? (
          <input
            type="number"
            name="longitude"
            step="0.000001"
            pattern="^-?\d{1,3}\.\d{1,6}$"
            title="Longitude must be a number with up to 6 decimals"
            value={formData.longitude}
            onChange={handleChange}
          />
        ) : (
          device.longitude
        )}
      </td>
      <td>
        {editMode ? (
          <input
            type="text"
            name="ipCamera"
            value={formData.ipCamera}
            onChange={handleChange}
          />
        ) : device.ipCamera ? (
          <a href={device.ipCamera} target="_blank" rel="noopener noreferrer">
            📷 View
          </a>
        ) : (
          "-"
        )}
      </td>
      <td>
        <button onClick={handleDelete}>❌ Delete</button>
      </td>
      <td>
        {editMode ? (
          <button onClick={saveEdit}>💾 Save</button>
        ) : (
          <button onClick={() => setEditMode(true)}>✏️ Edit</button>
        )}
      </td>
    </tr>
  );
};

// ---------------- Historical Data Tab ----------------
const HistoricalDataTab = () => {
  const [devices, setDevices] = useState([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [readings, setReadings] = useState([]);
  const [specificReading, setSpecificReading] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL}/api/devices-info`)
      .then((res) => res.json())
      .then(setDevices)
      .catch((err) => console.error("Error fetching devices:", err));
  }, []);

  function downsampleHourly(readings) {
    const seenHours = new Set();
    return readings.filter((reading) => {
      const date = new Date(reading.timestamp);
      const hourKey = date.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
      if (!seenHours.has(hourKey)) {
        seenHours.add(hourKey);
        return true;
      }
      return false;
    });
  }

  const fetchHistoricalData = async () => {
    if (!date || !time || !selectedMac) {
      alert("Please select device, date, and time.");
      return;
    }

    const datetime = `${date}T${time.length === 5 ? time + ":00" : time}`;
    const dateObj = new Date(datetime);
    const now = new Date();

    if (isNaN(dateObj.getTime())) {
      alert("❌ Invalid datetime format");
      return;
    }

    if (dateObj > now) {
      alert("⚠️ You cannot select a future date/time.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `${
          process.env.REACT_APP_API_URL
        }/api/historical-data?mac=${selectedMac}&datetime=${encodeURIComponent(
          datetime
        )}`
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to fetch historical data");

      const hourlyReadings = downsampleHourly(data.readings);
      setReadings(hourlyReadings);
      setSpecificReading(data.atSelectedTime);
    } catch (err) {
      alert(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const chartParams = [
    { key: "humidity", label: "Humidity (%)" },
    { key: "insideTemperature", label: "Inside Temp (°C)" },
    { key: "outsideTemperature", label: "Outside Temp (°C)" },
    { key: "outputVoltage", label: "Output Voltage (V)" },
    { key: "inputVoltage", label: "Input Voltage (V)" },
    { key: "batteryBackup", label: "Battery Backup (min)" },
  ];

  return (
    <div className="historical-data-tab">
      <h2>📈 Historical Data Viewer</h2>

      <div
        className="filter-row"
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <select
          value={selectedMac}
          onChange={(e) => setSelectedMac(e.target.value)}
          required
        >
          <option value="">Select Device</option>
          {devices.map((dev) => (
            <option key={dev.mac} value={dev.mac}>
              {dev.mac}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <input
          type="time"
          step="1"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
        <button onClick={fetchHistoricalData} disabled={loading}>
          {loading ? "⏳ Fetching..." : "🔍 Fetch"}
        </button>
      </div>

      {loading ? (
        <div className="loader">⏳ Loading data...</div>
      ) : (
        <>
          <div className="charts-grid">
            {chartParams.map((param) => (
              <div className="chart-box" key={param.key}>
                <h4>{param.label}</h4>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={readings}>
                    <XAxis
                      dataKey="timestamp"
                      ticks={[
                        readings[0]?.timestamp,
                        readings[readings.length - 1]?.timestamp,
                      ]}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        });
                      }}
                      tickLine={false}
                      axisLine={true}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(label) => {
                        try {
                          const date = new Date(label);
                          return `Time: ${date.toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}`;
                        } catch {
                          return "Invalid Time";
                        }
                      }}
                    />
                    <Line
                      type="basis"
                      dataKey={param.key}
                      stroke="#379a89"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>

          {specificReading && (
            <div className="gauge-status-block">
              <h3>📍 Snapshot at Selected Time</h3>
              <div className="snapshot-table">
                <div className="snapshot-cell">
                  🌡 Inside Temp: {specificReading.insideTemperature}°C
                </div>
                <div className="snapshot-cell">
                  💧 Humidity: {specificReading.humidity}%
                </div>
                <div className="snapshot-cell">
                  🌡 Outside Temp: {specificReading.outsideTemperature}°C
                </div>
                <div className="snapshot-cell">
                  🔋 Input Voltage: {specificReading.inputVoltage}V
                </div>
                <div className="snapshot-cell">
                  🔌 Output Voltage: {specificReading.outputVoltage}V
                </div>
                <div className="snapshot-cell">
                  🔋 Battery Backup: {specificReading.batteryBackup} mins
                </div>
                <div className="snapshot-cell">
                  🔥 Fire Alarm:{" "}
                  {specificReading.fireAlarm ? "Active" : "Normal"}
                </div>
                <div className="snapshot-cell">
                  🚪 Lock: {specificReading.lockStatus}
                </div>
                <div className="snapshot-cell">
                  🚪 Door: {specificReading.doorStatus}
                </div>
                <div className="snapshot-cell">
                  ⚙️ Fan Level:{" "}
                  {specificReading.fanLevel1Running
                    ? 1
                    : specificReading.fanLevel2Running
                    ? 2
                    : specificReading.fanLevel3Running
                    ? 3
                    : "Off"}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
