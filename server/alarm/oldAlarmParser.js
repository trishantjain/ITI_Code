function parseOldAlarm(payload, timestamp) {

    const entries = [];

    const tokens = String(payload)
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

    for (const token of tokens) {

        const idx = token.indexOf(":");

        if (idx === -1) {

            entries.push({
                timestamp: timestamp.toISOString(),
                alarm: token,
                event: "ACTIVE"
            });

            continue;
        }

        const alarm = token.slice(0, idx).trim();
        const value = token.slice(idx + 1).trim();

        entries.push({
            timestamp: timestamp.toISOString(),
            alarm,
            event: value
        });
    }

    return entries;
}

module.exports = parseOldAlarm;