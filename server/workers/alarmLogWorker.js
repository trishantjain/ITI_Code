require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

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

async function startWorker() {
    let connection;

    try {
        connection = await amqp.connect(process.env.RABBIT_URL);
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

        await channel.assertQueue("alarm.result.queue", { durable: true });

        console.log("🚀 Alarm Worker started");

        channel.consume("alarm.result.queue", async (msg) => {
            if (!msg) return;

            try {
                const data = JSON.parse(msg.content.toString());

                const { mac, alarms, fanStatus } = data;
                const baseDir = process.env.ALARM_LOG_DIR;

                if (!mac || !baseDir) {
                    console.error("Invalid alarm message:", data);
                    channel.ack(msg);
                    return;
                }

                const macDir = mac.replace(/[:. ]/g, "_");
                const deviceAlarmDir = path.join(baseDir, macDir);
                fs.mkdirSync(deviceAlarmDir, { recursive: true });

                const now = new Date();
                const fileName = `${now.getDate()}_${now.getMonth() + 1}_${now.getHours()}_Alarm.inc`;

                let logLine;

                if (Array.isArray(fanStatus) && fanStatus.includes(2)) {
                    logLine =
                        `[${now.toLocaleString("en-IN")}] | MAC: ${mac} | ${alarms} | Fans: ${fanStatus}`;
                } else {
                    logLine =
                        `[${now.toLocaleString("en-IN")}] | MAC: ${mac} | ${alarms}`;
                }

                fs.appendFileSync(
                    path.join(deviceAlarmDir, fileName),
                    logLine + "\n"
                );

                channel.ack(msg);

            } catch (err) {
                console.error("Worker error:", err);
                channel.nack(msg, false, true); // requeue message
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
}

startWorker();
