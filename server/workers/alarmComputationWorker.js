const { consume, publishAlarmResult } = require("../services/rabbit");
const thresholds = require("../thresholds");

async function start() {
  console.log("🚀 Alarm Processor Worker started");

  await consume("alarm.queue", async (data) => {
    const {
      mac,
      humidity,
      insideTemperature,
      outsideTemperature,
      inputVoltage,
      outputVoltage,
      batteryBackup,
      waterLogging,
      waterLeakage,
      doorStatus,
      lockStatus,
      fireAlarm,
      pwsFailCount,
      fanStatus, 
      mainStatus,
      rectStatus,
      inveStatus,
      overStatus,
      mptStatus,
      mosfStatus
    } = data;

    const activeAlarms = [];

    // 🔥 Threshold logic moved here
    if (
      insideTemperature > thresholds.insideTemperature.max ||
      insideTemperature < thresholds.insideTemperature.min
    ) {
      activeAlarms.push(`Inside Temperature: ${insideTemperature}`);
    }

    if (
      outsideTemperature > thresholds.outsideTemperature.max ||
      outsideTemperature < thresholds.outsideTemperature.min
    ) {
      activeAlarms.push(`Outside Temperature: ${outsideTemperature}`);
    }

    if (
      humidity > thresholds.humidity.max ||
      humidity < thresholds.humidity.min
    ) {
      activeAlarms.push(`Humidity: ${humidity}`);
    }

    if (
      inputVoltage > thresholds.inputVoltage.max ||
      inputVoltage < thresholds.inputVoltage.min
    ) {
      activeAlarms.push(`Input Voltage: ${inputVoltage}`);
    }

    if (
      outputVoltage > thresholds.outputVoltage.max ||
      outputVoltage < thresholds.outputVoltage.min
    ) {
      activeAlarms.push(`Output Voltage: ${outputVoltage}`);
    }

    if (batteryBackup < thresholds.batteryBackup.min) {
      activeAlarms.push(`Battery Backup: ${batteryBackup}`);
    }

    const wrongPasswordAttempts = Number(pwsFailCount);
    if (Number.isFinite(wrongPasswordAttempts) && wrongPasswordAttempts > 0) {
      activeAlarms.push(`Wrong password attempt: ${wrongPasswordAttempts}`);
    }

        if (mainStatus === 0) {
      activeAlarms.push("Mains Alarm")
    }

    if (rectStatus === 0) {
      activeAlarms.push("Rectifier Alarm")
    }

    if (inveStatus === 0) {
      activeAlarms.push("Inverter Alarm")
    }

    if (overStatus === 0) {
      activeAlarms.push("OverLoad Alarm")
    }

    if (mptStatus === 0) {
      activeAlarms.push("MPT Alarm")
    }

    if (mosfStatus === 0) {
      activeAlarms.push("MOSFET Alarm")
    }


    // 🔔 Binary alarms
    if (waterLogging) activeAlarms.push("Water Logging Alarm");
    if (waterLeakage) activeAlarms.push("Water Leakage Alarm");
    if (doorStatus === "OPEN") activeAlarms.push("Door Alarm");
    if (lockStatus === "OPEN") activeAlarms.push("Lock Alarm");
    if (fireAlarm) activeAlarms.push("Fire Alarm");

    console.log("activeAlarms", activeAlarms)

    if (activeAlarms.length > 0) {
      publishAlarmResult({
        mac,
        alarms: activeAlarms,
        fanStatus,
        timestamp: new Date().toISOString()
      });
    } else {
      publishAlarmResult({
        mac,
        alarms: [],
        type: "clear",
        timestamp: new Date().toISOString()
      });
    }
  });
}

start();
