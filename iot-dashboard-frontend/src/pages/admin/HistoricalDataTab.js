import React, { useEffect, useState } from "react";
import '../../App.css'
import { API } from '../../config/api.js'

const api = "/api";

const HistoricalDataTab = () => {
    const [devices, setDevices] = useState([]);
    const [selectedMac, setSelectedMac] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [toTime, setToTime] = useState("");
    const [alarmEntries, setAlarmEntries] = useState([]);

    const [query, setQuery] = useState("");
    const [showDropdown, setShowDropdown] = useState(false);

    const [loading, setLoading] = useState(false);

    const [page, setPage] = useState(1);
    const [limit] = useState(100);

    const [totalPages, setTotalPages] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);

    const [activeFilter, setActiveFilter] = useState("all");

    const filteredDevices = devices.filter((dev) =>
        dev.mac.toLowerCase().includes(query.toLowerCase())
    );

    const [specificReading, setSpecificReading] = useState(null);


    useEffect(() => {
        fetch(`${api}/${API.deviceInfo}`)
            .then((res) => res.json())
            .then(setDevices)
            .catch((err) => console.error("Error fetching devices:", err));
    }, []);

    const search = () => {
        if (page !== 1) {

            setPage(1);

        } else {

            fetchHistoricalData();

        }
    };


    useEffect(() => {
        if (
            selectedMac &&
            date &&
            time &&
            toTime
        ) {
            fetchHistoricalData();
        }
    }, [page]);

    const fetchHistoricalData = async () => {
        if (!date || !time || !toTime || !selectedMac) {
            alert("Please select device, date, from time and to time.");
            return;
        }

        const fromDateTime = `${date}T${time.length === 5 ? time + ":00" : time}`;
        const toDateTime = `${date}T${toTime.length === 5 ? toTime + ":00" : toTime}`;

        const fromObj = new Date(fromDateTime);
        const toObj = new Date(toDateTime);
        const now = new Date();

        if (isNaN(fromObj.getTime()) || isNaN(toObj.getTime())) {
            alert("❌ Invalid date/time format");
            return;
        }

        if (fromObj > now || toObj > now) {
            alert("⚠️ Cannot select future time");
            return;
        }

        if (toObj < fromObj) {
            alert("⚠️ 'To' must be after 'From'");
            return;
        }

        setLoading(true);

        try {
            const formatLocalNoTz = (d) => {
                const pad = (n) => String(n).padStart(2, "0");
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            };

            const fromStr = formatLocalNoTz(fromObj);
            const toStr = formatLocalNoTz(toObj);

            console.log("Alarm-history:", selectedMac, fromStr, "->", toStr);
            console.log("MAC =", JSON.stringify(selectedMac));
            const res = await fetch(
                `${api}/alarm-history?mac=${encodeURIComponent(selectedMac.trim())}&from=${encodeURIComponent(fromDateTime)}&to=${encodeURIComponent(toDateTime)}&page=${page}&limit=${limit}`
            );
            const data = await res.json();

            // console.log("Data: ", data);
            if (!res.ok)
                throw new Error(data.error || "Failed to fetch historical data");

            console.log("Response:", data);
            console.log("Entries:", data.entries);
            console.log("Count:", data.entries?.length);

            if (Array.isArray(data.entries)) {
                console.log("First entry:", data.entries[0]);
            }

            // const hourlyReadings = downsampleHourly(data.alarms);
            setAlarmEntries(data.entries || []);
            setTotalPages(data.totalPages || 1);
            setTotalRecords(data.total || 0);

            // setSpecificReading(data.atSelectedTime);
            // console.log("specific: ", specificReading)
        } catch (err) {
            alert(`❌ ${err?.stack}`);
        } finally {
            setLoading(false);
        }
    };

    const criticalAlarms = [
        "Fire Alarm",
        "Water Logging Alarm",
        "Water Leakage Alarm",
    ];

    const criticalCount = alarmEntries.filter((e) =>
        criticalAlarms.includes(e.alarm)
    ).length;

    const warningCount =
        alarmEntries.length - criticalCount;

    const raisedCount = alarmEntries.filter(
        (e) => e.event === "RAISED"
    ).length;

    const clearedCount = alarmEntries.filter(
        (e) => e.event === "CLEARED"
    ).length;

    return (
        <div className="min-h-screen p-6 text-white bg-gradient-to-br from-gray-950 via-gray-900 to-black">
            {/* TOP FILTER PANEL */}
            <div className="p-6 mb-6 bg-gradient-to-r from-gray-900 to-gray-800 rounded-3xl">

                <div className="p-6 border border-gray-700 shadow-2xl bg-gray-900/80 backdrop-blur-md rounded-3xl">

                    <div className="flex items-center justify-between mb-6">

                        <div>
                            <h2 className="text-3xl font-bold text-white">
                                🚨 Alarm Monitoring Center
                            </h2>

                            <p className="mt-1 text-sm text-gray-400">
                                Monitor historical alarms and device events
                            </p>
                        </div>

                        <div className="px-4 py-2 border border-blue-500/20 rounded-xl bg-blue-500/10">
                            <span className="text-sm font-semibold text-blue-300">
                                EMS Historical Viewer
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-5">

                        {/* DEVICE SEARCH */}
                        <div className="relative w-[260px]">

                            <label className="block mb-2 text-sm font-medium text-gray-300">
                                Device MAC
                            </label>

                            <input
                                type="text"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setShowDropdown(true);
                                }}
                                onFocus={() => setShowDropdown(true)}
                                placeholder="Search Device..."
                                className="w-full px-4 py-3 text-white border border-gray-700 bg-gray-800/80 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />

                            {showDropdown && (
                                <div className="absolute z-50 w-full mt-2 overflow-y-auto bg-gray-900 border border-gray-700 shadow-xl rounded-xl max-h-60">

                                    {filteredDevices.length > 0 ? (
                                        filteredDevices.map((dev) => (
                                            <div
                                                key={dev.mac}
                                                onClick={() => {
                                                    setQuery(dev.mac);
                                                    setSelectedMac(dev.mac);
                                                    setShowDropdown(false);
                                                }}
                                                className="px-4 py-3 text-gray-200 cursor-pointer hover:bg-blue-500/20"
                                            >
                                                {dev.mac}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="px-4 py-3 text-gray-500">
                                            No results
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* DATE */}
                        <div>

                            <label className="block mb-2 text-sm font-medium text-gray-300">
                                Date
                            </label>

                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="px-4 py-3 text-white border border-gray-700 bg-gray-800/80 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>

                        {/* FROM */}
                        <div>

                            <label className="block mb-2 text-sm font-medium text-gray-300">
                                From
                            </label>

                            <input
                                type="time"
                                step="1"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                className="px-4 py-3 text-white border border-gray-700 bg-gray-800/80 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>

                        {/* TO */}
                        <div>

                            <label className="block mb-2 text-sm font-medium text-gray-300">
                                To
                            </label>

                            <input
                                type="time"
                                step="1"
                                value={toTime}
                                onChange={(e) => setToTime(e.target.value)}
                                className="px-4 py-3 text-white border border-gray-700 bg-gray-800/80 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>

                        {/* BUTTON */}
                        <button
                            onClick={search}
                            disabled={loading}
                            className={`px-8 py-3 rounded-xl text-white font-semibold transition-all duration-200 shadow-xl
                        ${loading
                                    ? "bg-gray-500 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 hover:scale-[1.02]"
                                }`}
                        >
                            {loading ? "Fetching..." : "Fetch Alarms"}
                        </button>

                    </div>
                </div>
            </div>
            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 gap-4 mt-6 mb-6 md:grid-cols-4">

                {/* Total */}
                <div className="p-5 border border-gray-700 shadow-xl rounded-2xl bg-gray-900/80">
                    <div className="text-sm text-gray-400">
                        Total Events
                    </div>

                    <div className="mt-2 text-3xl font-bold text-white">
                        {alarmEntries.length}
                    </div>
                </div>

                {/* Critical */}
                <div className="p-5 border shadow-xl rounded-2xl border-red-500/20 bg-red-500/10">
                    <div className="text-sm text-red-300">
                        Critical
                    </div>

                    <div className="mt-2 text-3xl font-bold text-red-400">
                        {criticalCount}
                    </div>
                </div>

                {/* Warning */}
                <div className="p-5 border shadow-xl rounded-2xl border-yellow-500/20 bg-yellow-500/10">
                    <div className="text-sm text-yellow-200">
                        Warning
                    </div>

                    <div className="mt-2 text-3xl font-bold text-yellow-300">
                        {warningCount}
                    </div>
                </div>

                {/* Raised */}
                <div className="p-5 border shadow-xl rounded-2xl border-green-500/20 bg-green-500/10">
                    <div className="text-sm text-green-300">
                        Raised Events
                    </div>

                    <div className="mt-2 text-3xl font-bold text-green-400">
                        {raisedCount}
                    </div>
                </div>
            </div>

            {/* TABLE HEADER */}
            <div className="flex items-center justify-between mb-4">

                <h3 className="flex items-center gap-2 text-2xl font-bold text-white">
                    🚨 Alarm History
                </h3>

                <div className="text-sm text-gray-400">
                    Cleared Events:
                    <span className="ml-2 font-semibold text-green-400">
                        {clearedCount}
                    </span>
                </div>
            </div>

            {/* EMPTY */}
            {alarmEntries.length === 0 ? (
                <div className="p-10 text-center border border-gray-700 shadow-xl rounded-2xl bg-gray-900/70">
                    <p className="text-lg text-gray-400">
                        No alarm records found
                    </p>
                </div>
            ) : (

                /* TABLE */
                <div className="overflow-hidden border border-gray-800 shadow-[0_0_40px_rgba(0,0,0,0.45)] bg-gradient-to-br from-gray-900 via-gray-950 to-black rounded-3xl">
                    <div className="overflow-y-auto max-h-[650px]">

                        <table className="min-w-full text-sm text-left text-gray-300">

                            {/* TABLE HEADER */}
                            <thead className="sticky top-0 z-20 text-xs tracking-[0.15em] text-gray-300 uppercase border-b border-gray-700 bg-gradient-to-r from-gray-800 to-gray-900 backdrop-blur">

                                <tr>
                                    <th className="px-5 py-2.5 font-semibold">
                                        Time
                                    </th>

                                    <th className="px-5 py-2.5 font-semibold">
                                        Alarm
                                    </th>

                                    <th className="px-5 py-4 font-semibold">
                                        Severity
                                    </th>

                                    <th className="px-5 py-4 font-semibold">
                                        Event
                                    </th>
                                </tr>
                            </thead>

                            {/* BODY */}
                            <tbody className="divide-y divide-gray-800">

                                {alarmEntries.map((row, idx) => {

                                    const isCritical =
                                        criticalAlarms.includes(row.alarm);

                                    return (

                                        <tr
                                            key={idx}
                                            className={`
                                            ${idx % 2 === 0
                                                    ? "bg-gray-900/40"
                                                    : "bg-gray-950/60"
                                                }
                                            transition-all duration-300
                                            hover:bg-blue-500/10
                                            hover:border-blue-500
                                            border-l-4
                                            ${isCritical
                                                    ? "border-red-500/70"
                                                    : "border-yellow-500/40"
                                                }
                                            `}
                                        >

                                            {/* TIME */}
                                            <td className="px-5 py-2.5 whitespace-nowrap">
                                                <span className="font-semibold text-white">
                                                    {new Date(row.timestamp).toLocaleString("en-GB", {
                                                        day: "2-digit",
                                                        month: "2-digit",
                                                        year: "numeric",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                        second: "2-digit",
                                                        hour12: true,
                                                    }).replace(",", " |")}
                                                </span>
                                            </td>
                                            {/* EVENT */}
                                            <td className="px-5 py-4">

                                                <span
                                                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wide border shadow-md
                                    ${row.event === "RAISED"
                                                            ? "bg-red-500/15 text-red-300 border-red-500/30"
                                                            : "bg-green-500/15 text-green-300 border-green-500/30"
                                                        }`}
                                                >

                                                    <span className="text-sm">

                                                        {row.event === "RAISED"
                                                            ? "🔴"
                                                            : "🟢"}

                                                    </span>

                                                    {row.event}

                                                </span>

                                            </td>

                                            {/* ALARM */}
                                            <td className="px-5 py-4">

                                                <span
                                                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wide border shadow-md
                                    ${isCritical
                                                            ? "bg-red-500/10 text-red-300 border-red-500/20"
                                                            : "bg-yellow-500/10 text-yellow-200 border-yellow-500/20"
                                                        }`}
                                                >

                                                    {isCritical ? "🔥" : "⚠️"}

                                                    {row.alarm}

                                                </span>

                                            </td>

                                            {/* SEVERITY */}
                                            <td className="px-5 py-4">

                                                <span
                                                    className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide border shadow-md
                                    ${isCritical
                                                            ? "bg-red-500/15 text-red-300 border-red-500/30"
                                                            : "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
                                                        }`}
                                                >

                                                    {isCritical
                                                        ? "CRITICAL"
                                                        : "WARNING"}

                                                </span>

                                            </td>


                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-t border-gray-800">

                        <div className="text-sm text-gray-300">
                            Showing{" "}
                            <span className="font-semibold">
                                {(page - 1) * limit + 1}
                            </span>
                            {" - "}
                            <span className="font-semibold">
                                {Math.min(page * limit, totalRecords)}
                            </span>
                            {" of "}
                            <span className="font-semibold">
                                {totalRecords}
                            </span>
                        </div>

                        <div className="flex items-center gap-3">

                            <button
                                disabled={page === 1}
                                onClick={() => setPage(page - 1)}
                                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                ◀ Previous
                            </button>

                            <span className="text-sm text-gray-300">
                                Page {page} of {totalPages}
                            </span>

                            <button
                                disabled={page === totalPages}
                                onClick={() => setPage(page + 1)}
                                className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Next ▶
                            </button>

                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};

export default HistoricalDataTab;