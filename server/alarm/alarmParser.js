// import { parseOldAlarm } from "./oldAlarmParser.js";
// import { parseNewAlarm } from "./newAlarmParser.js";

const parseOldAlarm = require("./oldAlarmParser.js")
const parseNewAlarm = require("./newAlarmParser.js")


function parseAlarmLine(
    line,
    payload,
    timestamp
) {

    if (
        line.includes("ALARM:") &&
        line.includes("EVENT:")
    ) {
        return parseNewAlarm(
            line,
            timestamp
        );
    }

    return parseOldAlarm(
        payload,
        timestamp
    );

}

module.exports = parseAlarmLine;