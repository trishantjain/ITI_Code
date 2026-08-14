function parseNewAlarm(line, timestamp) {

    const alarmMatch = line.match(
        /\|\s*ALARM:\s*(.*?)\s*\|\s*EVENT:\s*(.*?)\s*$/
    );

    if (!alarmMatch)
        return [];

    return [{
        timestamp: timestamp.toISOString(),
        alarm: alarmMatch[1].trim(),
        event: alarmMatch[2].trim()
    }];
}

module.exports = parseNewAlarm;