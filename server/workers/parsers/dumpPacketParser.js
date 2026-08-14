function parseFanValue(fanHex) {
    if (!fanHex) {
        return {
            raw: "0000",
            values: [0, 0, 0, 0, 0, 0],
            states: ["F", "F", "F", "F", "F", "F"]
        };
    }

    // Normalize FAN value to uppercase
    const hex = String(fanHex).toUpperCase();

    // Convert 4-digit hexadecimal value to number
    const fanNumber = parseInt(hex, 16);

    if (Number.isNaN(fanNumber)) {
        return {
            raw: hex,
            values: [],
            states: []
        };
    }

    // Six fans, each represented by 2 bits.
    // Fan 1 uses bits 11-10
    // Fan 2 uses bits  9-8
    // Fan 3 uses bits  7-6
    // Fan 4 uses bits  5-4
    // Fan 5 uses bits  3-2
    // Fan 6 uses bits  1-0

    const values = [];

    for (let i = 0; i < 6; i++) {
        const shift = 10 - (i * 2);

        const value = (fanNumber >> shift) & 0x03;
        values.push(value);
    }

    // Convert numeric status to display status
    const states = values.map(value => {
        if (value === 0) return "F";
        if (value === 1) return "R";
        if (value === 2) return "D";

        return String(value);
    });

    return {
        raw: hex,
        values,
        states
    };
}

function parseDumpPacket(rawPacket) {
    // Remove NUL characters from fixed-length dump packet
    const packet = String(rawPacket)
        .replace(/\0/g, "")
        .trim();

    // Expected:
    // #EVENT[   18]11 13:42:49 Door 1 Lock 1 Fire 1 ...
    const eventMatch = packet.match(
        /^#EVENT\[\s*(\d+)\](\d{1,2})\s+(.+)$/
    );

    if (!eventMatch) {
        return {
            success: false,
            raw: packet,
            error: "Invalid dump packet format"
        };
    }

    const eventNo = parseInt(eventMatch[1], 10);
    const eventDate = parseInt(eventMatch[2], 10);
    const remainingData = eventMatch[3];

    // ----------------------------------------
    // Calculate month from event date
    // ----------------------------------------

    const today = new Date();
    const todayDate = today.getDate();
    const currentMonth = today.getMonth() + 1;

    let eventMonth;

    if (eventDate > todayDate) {
        eventMonth = currentMonth - 1;

        if (eventMonth === 0) {
            eventMonth = 12;
        }
    } else {
        eventMonth = currentMonth;
    }

    const formattedDate =
        `${String(eventDate).padStart(2, "0")}/${String(eventMonth).padStart(2, "0")}`;

    // ----------------------------------------
    // Extract event time
    // ----------------------------------------

    const timeMatch = remainingData.match(
        /^(\d{2}:\d{2}:\d{2})\s+/
    );

    const eventTime = timeMatch
        ? timeMatch[1]
        : null;

    // ----------------------------------------
    // Extract alarm values
    // ----------------------------------------

    const door = remainingData.match(/\bDoor\s+(\d+)/);
    const lock = remainingData.match(/\bLock\s+(\d+)/);
    const fire = remainingData.match(/\bFire\s+(\d+)/);
    const hups = remainingData.match(/\bHUPS\s+(\d+)/);
    const logg = remainingData.match(/\bLogg\s+(\d+)/);
    const leak = remainingData.match(/\bLeak\s+(\d+)/);
    const smoke = remainingData.match(/\bSMOK\s+(\d+)/);

    // FAN is a 4-character hexadecimal value
    const fan = remainingData.match(
        /\bFAN\s+([0-9a-fA-F]{4})\b/
    );

    // CAMR is optional
    const camr = remainingData.match(
        /\bCAMR\s+(\d+)/
    );

    const cameraId = camr
        ? parseInt(camr[1], 10)
        : null;

    const fanValue = fan
        ? fan[1].toUpperCase()
        : "0000";

    const fanData = parseFanValue(fanValue);

    // ----------------------------------------
    // Build active alarm list
    // ----------------------------------------

    const parsedPacket =
        `[${eventNo}]${formattedDate} ${eventTime} ` +
        `Door ${door ? door[1] : "0"} ` +
        `Lock ${lock ? lock[1] : "0"} ` +
        `Fire ${fire ? fire[1] : "0"} ` +
        `HUPS ${hups ? hups[1] : "0"} ` +
        `Logg ${logg ? logg[1] : "0"} ` +
        `Leak ${leak ? leak[1] : "0"} ` +
        `SMOK ${smoke ? smoke[1] : "0"} ` +
        `FAN [${fanData.states.join(",")}]`;

    // ----------------------------------------
    // Return parsed result
    // ----------------------------------------

    return {
        success: true,

        raw: packet,

        eventNo,
        eventDate,
        eventMonth,
        formattedDate,
        eventTime,

        alarms: {
            door: door ? parseInt(door[1], 10) : 0,
            lock: lock ? parseInt(lock[1], 10) : 0,
            fire: fire ? parseInt(fire[1], 10) : 0,
            hups: hups ? parseInt(hups[1], 10) : 0,
            logg: logg ? parseInt(logg[1], 10) : 0,
            leak: leak ? parseInt(leak[1], 10) : 0,
            smoke: smoke ? parseInt(smoke[1], 10) : 0
        },

        // HEX string, NOT decimal
        fan: fanValue,
        fanValues: fanData.values,
        fanStates: fanData.states,

        cameraId,

        hasCamera: cameraId !== null,

        parsedPacket
    };
}


module.exports = {
    parseDumpPacket
};