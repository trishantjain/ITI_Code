function parseIstLogTimestamp (timestampText) {
    // Example: "24/2/2026, 3:00:20 pm"
    const txt = String(timestampText || "").trim();
    const match = txt.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i
    );
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    let hours = Number(match[4]);
    const minutes = Number(match[5]);
    const seconds = Number(match[6]);
    const ampm = String(match[7]).toLowerCase();

    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    const hh = String(hours).padStart(2, "0");
    const mi = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    const iso = `${year}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`;
    const date = new Date(iso);
    return isNaN(date.getTime()) ? null : date;
};

module.exports = parseIstLogTimestamp;