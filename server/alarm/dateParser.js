// ==========================================
// PARSE QUERY DATE
// Converts frontend datetime to IST Date
// ==========================================

function parseQueryDate(value) {

    const raw = String(value || "").trim();

    if (!raw) {
        return new Date("invalid");
    }

    // If timezone already exists (Z or +05:30 etc.)
    if (
        /[zZ]$/.test(raw) ||
        /[+-]\d{2}:?\d{2}$/.test(raw)
    ) {
        return new Date(raw);
    }

    // Otherwise treat it as IST
    return new Date(`${raw}+05:30`);

}

module.exports = parseQueryDate;