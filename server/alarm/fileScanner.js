const fs = require("fs");

/**
 * Returns all alarm files between the given date range.
 *
 * @param {string} baseDir
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {string[]}
 */
function getAlarmFiles(baseDir, fromDate, toDate) {

    const filesToScan = [];

    let current = new Date(fromDate);

    while (current <= toDate) {

        // Convert to IST before generating filename
        const ist = new Date(
            current.toLocaleString(
                "en-US",
                {
                    timeZone: "Asia/Kolkata"
                }
            )
        );

        const day = ist.getDate();
        const month = ist.getMonth() + 1;
        const hour = ist.getHours();

        const fileName =
            `${day}_${month}_${hour}_Alarm.inc`;

        const filePath =
            `${baseDir}/${fileName}`;

        if (fs.existsSync(filePath)) {
            filesToScan.push(filePath);
        }

        current.setHours(
            current.getHours() + 1
        );
    }

    return filesToScan;
}

module.exports = getAlarmFiles;