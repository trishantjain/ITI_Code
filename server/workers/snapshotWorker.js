require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { spawn } = require("child_process");
const sharp = require("sharp");

const RECONNECT_DELAY_MS = 5000;
let restarting = false;

function scheduleRestart(reason) {
    if (restarting) return;

    restarting = true;
    console.error(`RabbitMQ worker disconnected: ${reason}. Restarting in ${RECONNECT_DELAY_MS / 1000}s...`);

    setTimeout(() => {
        restarting = false;
        startWorker().catch((err) => {
            console.error("Worker restart failed:", err.message);
            scheduleRestart(err.message);
        });
    }, RECONNECT_DELAY_MS);
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Time function
function getFormattedDateTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");

    return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${String(d.getFullYear()).slice(-2)}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

// VALIDATING IMAGE
async function validateImage(filePath) {
    try {
        await sharp(filePath).toBuffer();
        return true;
    } catch (err) {
        return false;
    }
}

// CHECKING IMAGE SIZE [50 KB MINIMUM]
async function imageSizeCheck(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const fileSizeInBytes = stat.size;
        const fileSizeInKB = (fileSizeInBytes / (1024)).toFixed(2);
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);

        return {
            fileSize: {
                bytes: fileSizeInBytes,
                kb: parseFloat(fileSizeInKB),
                mb: parseFloat(fileSizeInMB)
            }
        }
    } catch (error) {
        console.error('Error extracting image info:', error.message);
        throw error;
    }
}


// HiFocus Capture
function captureHiFocus(ip, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
            "-rtsp_transport", "tcp",
            // "-i", `rtsp://${ip}/media/video1`,

            // DUMMY IMAGES FOR TESTING
            "-i", `https://picsum.photos/800/600`,
            "-frames:v", "1",
            outputPath
        ]);

        ffmpeg.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error("ffmpeg failed"));
        });
    });
}

// Sparsh Capture
async function captureSparsh(ip, outputPath) {
    const response = await axios({
        method: "GET",
        // url: `https://${ip}/CGI/command/snap?channel=01`,

        // DUMMY IMAGES FOR TESTING
        url: `https://picsum.photos/800/600`,
        responseType: "stream",
        timeout: 10000
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
}


/**
 * Captures an image from a camera using an external executable (ReadImage.exe).
 *
 * @param {string} ip - IP address of the camera
 * @param {string} outputPath - Path where the captured image will be saved
 *
 * Workflow:
 * 1. Resolve executable path and timeout
 * 2. Prepare arguments (default or via env override)
 * 3. Spawn child process to run the executable
 * 4. Handle errors, timeout, and exit code
 * 5. Validate output file exists and is not empty
 */
// Techno Camera
// Techno Camera
async function captureTechno(ip, outputPath, cameraId = null) {

    // Linux executable
    const exePath =
        process.env.READIMAGE_EXE_PATH ||
        path.join(__dirname, "ReadImage2");

    const timeoutMs = Number.parseInt(
        process.env.READIMAGE_TIMEOUT_MS || "45000",
        10
    );

    if (!fs.existsSync(exePath)) {
        throw new Error(
            `ReadImage executable not found at: ${exePath}`
        );
    }

    // ----------------------------------------
    // Prepare arguments
    // ----------------------------------------

    let args = [
        String(ip),
        String(outputPath)
    ];

    // Camera ID is optional
    if (cameraId !== null && cameraId !== undefined) {
        args.push(String(cameraId));
    }

    // Optional environment override
    if (process.env.READIMAGE_ARGS_JSON) {
        try {
            const parsed = JSON.parse(
                process.env.READIMAGE_ARGS_JSON
            );

            if (!Array.isArray(parsed)) {
                throw new Error(
                    "READIMAGE_ARGS_JSON must be a JSON array"
                );
            }

            args = parsed.map((a) =>
                String(a)
                    .replaceAll("{ip}", String(ip))
                    .replaceAll("{out}", String(outputPath))
                    .replaceAll(
                        "{cameraId}",
                        cameraId !== null &&
                            cameraId !== undefined
                            ? String(cameraId)
                            : ""
                    )
            );

        } catch (e) {
            throw new Error(
                `Invalid READIMAGE_ARGS_JSON: ${e.message}`
            );
        }
    }

    console.log(
        `📷 ReadImage command: ${exePath} ${args.join(" ")}`
    );

    // ----------------------------------------
    // Run ReadImage2
    // ----------------------------------------

    await new Promise((resolve, reject) => {

        const child = spawn(
            exePath,
            args,
            {
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        let stderr = "";
        let stdout = "";

        child.stdout.on("data", (d) => {
            const text = d.toString();

            stdout += text;

            console.log(
                `[ReadImage] ${text.trim()}`
            );
        });

        child.stderr.on("data", (d) => {
            stderr += d.toString();

            console.error(
                `[ReadImage ERROR] ${d.toString().trim()}`
            );
        });

        child.on("error", (err) => {
            reject(err);
        });

        const timer = setTimeout(() => {

            try {
                child.kill();
            } catch {
                // ignore
            }

            reject(
                new Error(
                    `ReadImage timed out after ${timeoutMs}ms ` +
                    `(exe=${exePath}, ip=${ip}, out=${outputPath})`
                )
            );

        }, Number.isFinite(timeoutMs)
            ? timeoutMs
            : 45000);

        child.on("close", (code) => {

            clearTimeout(timer);

            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `ReadImage exited with code ${code}\n` +
                    `STDOUT:\n${stdout}\n` +
                    `STDERR:\n${stderr}`
                )
            );
        });
    });

    // ----------------------------------------
    // Determine actual output path
    // ----------------------------------------

    let actualOutputPath = outputPath;

    /*
     * When cameraId is supplied, the updated ReadImage
     * creates:
     *
     *   1_image_xxx.jpg
     *
     * instead of:
     *
     *   image_xxx.jpg
     */

    if (
        cameraId !== null &&
        cameraId !== undefined
    ) {
        actualOutputPath = path.join(
            path.dirname(outputPath),
            `${cameraId}_${path.basename(outputPath)}`
        );
    }

    console.log(
        `📸 Expected image path: ${actualOutputPath}`
    );

    // ----------------------------------------
    // Validate output
    // ----------------------------------------

    let stat;

    try {
        stat = fs.statSync(
            actualOutputPath
        );
    } catch {
        throw new Error(
            `ReadImage completed but output file was not created: ${actualOutputPath}`
        );
    }

    if (
        !stat.isFile() ||
        stat.size === 0
    ) {
        throw new Error(
            `ReadImage output file is empty or invalid: ${actualOutputPath}`
        );
    }

    // Validate JPEG
    const isValid =
        await validateImage(actualOutputPath);

    if (!isValid) {
        throw new Error(
            "Corrupted image detected by sharp"
        );
    }

    return actualOutputPath;
}


// Techno Camera with internal retry mechanism
// async function captureTechno(ip, outputPath, maxRetries = 3) {
//     let lastError = null;

//     for (let attempt = 1; attempt <= maxRetries; attempt++) {
//         try {
//             console.log(`📸 Capture attempt ${attempt}/${maxRetries} for ${ip}`);

//             // Resolve path to ReadImage executable
//             const exePath = process.env.READIMAGE_EXE_PATH || path.join(__dirname, "ReadImage_recovered_5.exe");
//             const timeoutMs = Number.parseInt(process.env.READIMAGE_TIMEOUT_MS || "20000", 10);

//             if (!fs.existsSync(exePath)) {
//                 throw new Error(`ReadImage executable not found at: ${exePath}`);
//             }

//             // Prepare arguments
//             let args = [String(ip), String(outputPath)];
//             if (process.env.READIMAGE_ARGS_JSON) {
//                 try {
//                     const parsed = JSON.parse(process.env.READIMAGE_ARGS_JSON);
//                     if (!Array.isArray(parsed)) throw new Error("READIMAGE_ARGS_JSON must be a JSON array");
//                     args = parsed.map((a) =>
//                         String(a).replaceAll("{ip}", String(ip)).replaceAll("{out}", String(outputPath))
//                     );
//                 } catch (e) {
//                     throw new Error(`Invalid READIMAGE_ARGS_JSON: ${e.message}`);
//                 }
//             }

//             // Execute the external process
//             await new Promise((resolve, reject) => {
//                 const child = spawn(exePath, args, {
//                     windowsHide: true,
//                     stdio: ["ignore", "pipe", "pipe"]
//                 });

//                 let stderr = "";
//                 let stdout = "";

//                 child.stdout.on("data", (d) => {
//                     stdout += d.toString();
//                 });

//                 child.stderr.on("data", (d) => {
//                     stderr += d.toString();
//                 });

//                 child.on("error", (err) => {
//                     reject(err);
//                 });

//                 const timer = setTimeout(() => {
//                     try { child.kill(); } catch { /* ignore */ }
//                     reject(new Error(`ReadImage timed out after ${timeoutMs}ms`));
//                 }, timeoutMs);

//                 child.on("close", (code) => {
//                     clearTimeout(timer);

//                     if (code === 0) {
//                         resolve();
//                     } else {
//                         reject(new Error(`ReadImage exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
//                     }
//                 });
//             });

//             // Validate output file
//             let stat;
//             try {
//                 stat = fs.statSync(outputPath);
//             } catch {
//                 throw new Error(`Output file was not created: ${outputPath}`);
//             }

//             if (!stat.isFile() || stat.size === 0) {
//                 throw new Error(`Output file is empty or invalid: ${outputPath} (size: ${stat.size} bytes)`);
//             }

//             // Validate image with sharp
//             const isValid = await validateImage(outputPath);
//             if (!isValid) {
//                 throw new Error("Corrupted image detected by sharp");
//             }

//             // Success! Return
//             console.log(`✅ Capture successful on attempt ${attempt}`);
//             return;

//         } catch (err) {
//             lastError = err;
//             console.error(`❌ Attempt ${attempt} failed:`, err.message);

//             // Clean up invalid file if it exists
//             if (fs.existsSync(outputPath)) {
//                 try {
//                     fs.unlinkSync(outputPath);
//                     console.log(`🗑️ Deleted invalid file: ${outputPath}`);
//                 } catch (cleanupErr) {
//                     console.error(`Failed to delete invalid file:`, cleanupErr.message);
//                 }
//             }

//             // If this wasn't the last attempt, wait before retrying
//             if (attempt < maxRetries) {
//                 const waitTime = attempt * 2000; // Progressive backoff: 2s, 4s, 6s
//                 console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
//                 await sleep(waitTime);
//             }
//         }
//     }

//     // All retries failed
//     throw new Error(`Failed to capture after ${maxRetries} attempts. Last error: ${lastError?.message}`);
// }



async function startWorker() {
    let connection;

    try {
        const rabbitUrl = process.env.RABBIT_URL;
        if (!rabbitUrl) {
            throw new Error("RABBIT_URL is not set");
        }

        const snapshotBaseDir = process.env.SNAP_DIR;
        if (!snapshotBaseDir) {
            throw new Error("SNAP_DIR is not set");
        }

        const sparshDelayMs = Number.parseInt(process.env.SPARSH_SNAPSHOT_DELAY_MS || "3000", 10);

        connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();

        connection.on("error", (err) => {
            console.error("RabbitMQ connection error:", err.message);
        });

        connection.on("close", () => {
            scheduleRestart("connection closed");
        });

        channel.on("error", (err) => {
            console.error("RabbitMQ channel error:", err.message);
        });

        channel.on("close", () => {
            scheduleRestart("channel closed");
        });


        // await channel.assertQueue("snapshot.queue", {
        //     durable: true,
        //     arguments: {
        //         "x-dead-letter-exchange": "",
        //         "x-dead-letter-routing-key": "snapshot.dead"
        //     }
        // });

        await channel.assertQueue("snapshot.queue", { durable: true });
        await channel.assertQueue("snapshot.done", { durable: true });
        channel.prefetch(50);

        console.log("📸 Snapshot Worker started");

        channel.consume("snapshot.queue", async (msg) => {
            if (!msg) return;

            let data;
            try {
                data = JSON.parse(msg.content.toString());
            } catch (err) {
                console.error("Invalid snapshot message (not JSON), dropping:", err.message);
                channel.ack(msg);
                return;
            }

            const mac = data?.mac;
            const cameraType = data?.cameraType;
            const cameraIP = data?.cameraIP;
            const cameraId = data?.cameraId;

            console.log(
                mac,
                cameraIP,
                cameraType,
                cameraId
            );

            if (!mac || !cameraIP) {
                console.error(
                    "Invalid snapshot message (missing mac/cameraIP), dropping:",
                    data
                );

                channel.ack(msg);
                return;
            }

            const timestamp = getFormattedDateTime();
            const snapshotFileName = `image_${timestamp}.jpg`;
            const macSuffix = String(mac).slice(8).replace(/[. ]/g, "_");

            const snapshotOutputDirMac = path.join(
                snapshotBaseDir,
                macSuffix
            );

            // dump = snapshot requested from IncLogWorker
            const isBackupSnapshot =
                data.type === "dump";

            const snapshotDir = isBackupSnapshot
                ? path.join(
                    snapshotOutputDirMac,
                    "backup images"
                )
                : snapshotOutputDirMac;

            fs.mkdirSync(
                snapshotDir,
                { recursive: true }
            );

            const snapshotOutputPath = path.join(
                snapshotDir,
                snapshotFileName
            );

            console.log(
                `📸 Snapshot output directory: ${snapshotDir}`
            );

            if (isBackupSnapshot) {
                console.log(
                    `📦 [BACKUP] Dump snapshot will be saved to: ${snapshotDir}`
                );
            }

            let actualSnapshotPath =
                snapshotOutputPath;

            try {
                fs.mkdirSync(snapshotOutputDirMac, { recursive: true });

                const make = String(cameraType).trim().toUpperCase();

                console.log("snapshot request came :", mac)

                if (make === "H") {
                    console.log("⏰ Snapshot for Hi-Focus Camera ⏰", mac);
                    await captureHiFocus(String(cameraIP).trim(), snapshotOutputPath);
                } else if (make === "S") {
                    console.log("⏰ Snapshot for Sparsh Camera ⏰", mac);
                    // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                    await captureSparsh(String(cameraIP).trim(), snapshotOutputPath);
                } else {
                    console.log("⏰ Snapshot for Techno Camera ⏰", mac);
                    // await sleep(Number.isFinite(sparshDelayMs) ? sparshDelayMs : 3000);
                    actualSnapshotPath = await captureTechno(
                        String(cameraIP).trim(),
                        snapshotOutputPath,
                        cameraId
                    );
                }

                const isValid =
                    await validateImage(actualSnapshotPath);
                if (!isValid) {
                    throw new Error("Corrupted image detected by sharp");
                }

                // await captureTechno(String(cameraIP).trim(), snapshotOutputPath);


                console.log("sending to done queue", mac)
                channel.sendToQueue(
                    "snapshot.done",
                    Buffer.from(JSON.stringify({
                        mac,
                        filename:
                            path.basename(actualSnapshotPath),
                        createdAt: new Date().toISOString(),
                        source: "camera",
                        path: actualSnapshotPath
                    })),
                    { persistent: true }
                );

                channel.ack(msg);
            }

            // catch (err) {
            //     console.error("Snapshot worker error:", err?.stack || err);
            //     // transient errors (camera offline etc) can be retried
            //     channel.nack(msg, false, true);    
            // }


            catch (err) {
                console.error("Snapshot worker error:", err?.stack || err);

                const retryCount = data.retryCount || 0;

                // RETRY THE JOB MAXIMUM 3 TIMES
                if (retryCount >= 3) {
                    console.error("Max retries reached → sending to DLQ");

                    channel.nack(msg, false, false); // ❗ goes to DLQ
                } else {
                    console.log(`Retrying... attempt ${retryCount + 1}`);

                    channel.sendToQueue("snapshot.queue",
                        Buffer.from(JSON.stringify({
                            ...data,
                            retryCount: retryCount + 1
                        })),
                        { persistent: true }
                    );

                    // REMOVE OLD MESSAGE
                    channel.ack(msg);
                }
            }
        });
    } catch (err) {
        console.error("Worker failed to start:", err.message);

        try {
            await connection?.close();
        } catch {
            // ignore
        }

        scheduleRestart(err.message);

    }

    // channel.consume("snapshot.queue", async (msg) => {
    //     if (!msg) return;

    //     let data;
    //     try {
    //         data = JSON.parse(msg.content.toString());
    //     } catch (err) {
    //         console.error("Invalid snapshot message (not JSON), dropping:", err.message);
    //         channel.ack(msg);
    //         return;
    //     }

    //     const mac = data?.mac;
    //     const cameraType = data?.cameraType;
    //     const cameraIP = data?.cameraIP;

    //     if (!mac || !cameraType || !cameraIP) {
    //         console.error("Invalid snapshot message (missing fields), dropping:", data);
    //         channel.ack(msg);
    //         return;
    //     }

    //     const timestamp = getFormattedDateTime();
    //     const snapshotFileName = `image_${timestamp}.jpg`;
    //     const macSuffix = String(mac).slice(8).replace(/[. ]/g, "_");
    //     const snapshotOutputDirMac = path.join(snapshotBaseDir, macSuffix);
    //     const snapshotOutputPath = path.join(snapshotOutputDirMac, snapshotFileName);

    //     try {
    //         fs.mkdirSync(snapshotOutputDirMac, { recursive: true });

    //         const make = String(cameraType).trim().toUpperCase();

    //         console.log(`📸 Snapshot request for ${mac} (${cameraIP}) - Type: ${make}`);

    //         // The capture functions now handle their own retries internally
    //         if (make === "T") {
    //             await captureTechno(String(cameraIP).trim(), snapshotOutputPath);
    //         } else if (make === "S") {
    //             await captureSparsh(String(cameraIP).trim(), snapshotOutputPath);
    //         } else {
    //             await captureHiFocus(String(cameraIP).trim(), snapshotOutputPath);
    //         }

    //         // Send success message
    //         channel.sendToQueue(
    //             "snapshot.done",
    //             Buffer.from(JSON.stringify({
    //                 mac,
    //                 filename: snapshotFileName,
    //                 createdAt: new Date().toISOString(),
    //                 source: "camera",
    //                 path: snapshotOutputPath
    //             })),
    //             { persistent: true }
    //         );

    //         channel.ack(msg);
    //         console.log(`✅ Successfully processed snapshot for ${mac}`);

    //     } catch (err) {
    //         console.error("Snapshot worker error after all retries:", err?.stack || err);

    //         // Send to DLQ after all retries failed
    //         channel.nack(msg, false, false);
    //     }
    // });
}

startWorker();
