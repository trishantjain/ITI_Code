import React, { useEffect, useState } from "react";
import Spinner from "../../components/Spinner";
import { useNavigate } from "react-router-dom";
import { API } from "../../config/api";
import PasswordPrompt from "../../components/PasswordPrompt";

const api = "/api";

const RegisteredDevices = () => {
    const navigate = useNavigate();

    const [deviceList, setDeviceList] = useState([]);
    const [loadingDevices, setLoadingDevices] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [filter, setFilter] = useState("pending");

    useEffect(() => {
        fetchDevices(true);

        const interval = setInterval(() => {
            fetchDevices(false);
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    const fetchDevices = async (showLoader = false) => {
        try {
            if (showLoader) setLoadingDevices(true);

            const token = localStorage.getItem("token");

            const res = await fetch(`${api}/${API.adminDevices}`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            const data = await res.json();
            
            // setDeviceList(data);
            setDeviceList(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to fetch devices:", err);
            setDeviceList([]);
        } finally {
            if (showLoader) setLoadingDevices(false);
        }
    };

    const handleDeviceUpdated = (updatedDevice) => {
        setDeviceList((prevDevices) =>
            prevDevices.map((dev) =>
                dev.mac === updatedDevice.mac ? { ...updatedDevice } : dev
            )
        );
    };

    const handleDeviceDeleted = (mac) => {
        setDeviceList((prevDevices) =>
            prevDevices.filter((dev) => dev.mac !== mac)
        );
    };

    const filteredDevices = deviceList.filter((device) => {
        const term = searchTerm.toLowerCase();

        const matchesSearch =
            device.mac?.toLowerCase().includes(term) ||
            device.locationId?.toLowerCase().includes(term) ||
            device.address?.toLowerCase().includes(term)

        const matchesStatus = device.status === filter

        return matchesSearch && matchesStatus;
    });

    return (
        <div>
            <div style={{ marginBottom: "15px" }}>
                <button onClick={() => navigate("/admin/register-device")}>
                    ➕ Add New Device
                </button>
            </div>

            <h2>🖥 Registered Devices</h2>

            {/* 🔍 Search Box */}
            <div className="device-search-row">
                <input
                    type="text"
                    className="text-black device-search-input"
                    name="device-search"
                    autoComplete="off"
                    placeholder="🔍 Search by IP, Location ID or Address..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                {searchTerm && (
                    <button onClick={() => setSearchTerm("")}>
                        ❌ Clear
                    </button>
                )}
            </div>

            {/* Pending || Approved Toggle Button */}
            <div className="flex gap-3 mb-4">
                <button
                    onClick={() => setFilter("pending")}
                    className={`px-4 py-2 rounded-lg font-medium transition ${filter === "pending"
                        ? "bg-yellow-500 text-black"
                        : "bg-gray-700 text-white hover:bg-gray-600"
                        }`}
                >
                    ⏳ Pending
                </button>

                <button
                    onClick={() => setFilter("approved")}
                    className={`px-4 py-2 rounded-lg font-medium transition ${filter === "approved"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 text-white hover:bg-gray-600"
                        }`}
                >
                    ✅ Approved
                </button>
            </div>

            {/* 📋 Table */}
            <div className="admin-table-scroll">
                <table className="device-table">
                    <thead>
                        <tr>
                            <th>IP</th>
                            <th>Location ID</th>
                            <th>Address</th>
                            <th>Latitude</th>
                            <th>Longitude</th>
                            {/* <th>Camera</th> */}
                            <th>Action</th>
                            <th>Edit</th>
                            <th>Approval</th>
                            <th>Status</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loadingDevices ? (
                            <tr>
                                <td colSpan="10" style={{ textAlign: "center", padding: "30px" }}>
                                    <Spinner />
                                </td>
                            </tr>
                        ) : filteredDevices.length > 0 ? (
                            filteredDevices.map((device) => (
                                <EditableRow
                                    key={device.mac}
                                    device={device}
                                    onUpdated={handleDeviceUpdated}
                                    onDeleted={handleDeviceDeleted}
                                />
                            ))
                        ) : (
                            <tr>
                                <td colSpan="10">⚠️ No devices found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


// ================= Editable Row =================

const EditableRow = ({ device, onUpdated, onDeleted }) => {
    const [editMode, setEditMode] = useState(false);
    const [formData, setFormData] = useState({ ...device });
    const [showPrompt, setShowPrompt] = useState(false);
    const [promptWarning, setPromptWarning] = useState("");
    const [passwordResolver, setPasswordResolver] = useState(null);


    useEffect(() => {
        if (editMode) {
            setFormData({ ...device });
        }
    }, [editMode, device]);

    const askAdminPassword = async (warningText = "") => {
        // const password = prompt("Enter admin password:");
        // if (!password) {
        //     alert("⚠️ Action cancelled");
        //     return null;
        // }
        // return password;
        setPromptWarning(warningText);
        setShowPrompt(true);

        return new Promise((resolve) => {
            setPasswordResolver(() => resolve);
        });
    };

    // PASSWORD SUBMIT
    const handlePasswordSubmit = (password) => {
        if (!password) return;
        passwordResolver?.(password);
        setShowPrompt(false);
        setPromptWarning("");
        setPasswordResolver(null);
    };

    // PASSWORD CANCEL
    const handlePasswordCancel = () => {
        passwordResolver?.(null);
        setShowPrompt(false);
        setPromptWarning("");
        setPasswordResolver(null);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const saveEdit = async () => {
        const password = await askAdminPassword();
        if (!password) return;

        try {
            const res = await fetch(`${api}/device/${device.mac}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...formData, password }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => null);
                throw new Error(errorData?.error || "Update failed");
            }

            const updatedDevice = await res.json();
            setEditMode(false);
            onUpdated(updatedDevice);
        } catch (err) {
            alert("❌ " + err.message);
        }
    };

    // DELETE DEVICE FUNCTION
    const handleDelete = async () => {
        const password = await askAdminPassword("DELETED DEVICE CANNOT BE RETRIEVED");
        if (!password) return;

        try {
            const res = await fetch(`${api}/device/delete/${device.mac}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            alert("✅ Device deleted");

            onDeleted(device.mac);
        } catch (err) {
            alert("❌ " + err.message);
        }
    };

    // APPROVE DEVICE FUNCTION
    const approveDevice = async () => {
        try {
            const token = localStorage.getItem("token");

            const res = await fetch(`/api/device/approve/${device.mac}`, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) throw new Error("Approve failed");

            const updated = await res.json();
            onUpdated(updated);
        } catch (err) {
            alert(err.message);
        }
    };

    // REJECT DEVICE FUNCTION
    const rejectDevice = async () => {
        try {
            const token = localStorage.getItem("token");

            const res = await fetch(`/api/device/reject/${device.mac}`, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) throw new Error("Reject failed");

            const updated = await res.json();
            onUpdated(updated);
        } catch (err) {
            alert(err.message);
        }
    };

    return (
        <>
            <tr>
                <td>{device.mac}</td>

                <td>
                    {editMode ? (
                        <input
                            className="text-black"
                            name="locationId"
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
                            className="text-black"

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
                            className="text-black"
                            name="latitude"
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
                            className="text-black"
                            name="longitude"
                            value={formData.longitude}
                            onChange={handleChange}
                        />
                    ) : (
                        device.longitude
                    )}
                </td>

                {/* <td>
                    {device.ipCamera?.ip ? (
                        <a
                            href={`https://${device.ipCamera.ip}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            📷 View
                        </a>
                    ) : (
                        "-"
                    )}
                </td> */}

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

                <td>
                    {device.status === "pending" ? (
                        <div className="flex gap-2">
                            <button
                                onClick={approveDevice}
                                className="px-2 py-1 bg-green-600 rounded"
                            >
                                ✔
                            </button>

                            <button
                                onClick={rejectDevice}
                                className="px-2 py-1 bg-red-600 rounded"
                            >
                                ✖
                            </button>
                        </div>
                    ) : (
                        device.approvedBy || "-"
                    )}
                </td>

                {/* 🔥 STATUS COLUMN */}
                <td>
                    {device.status === "pending" && "⏳ Pending"}
                    {device.status === "approved" && "✅ Approved"}
                    {device.status === "rejected" && "❌ Rejected"}
                </td>
            </tr>


            {
                showPrompt && (
                    <PasswordPrompt onSubmit={handlePasswordSubmit} onCancel={handlePasswordCancel} warningSign={promptWarning} />
                )
            }
        </>
    );
};

export default RegisteredDevices;