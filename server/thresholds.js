module.exports = {
  insideTemperature: {
    min: 0,
    max: 55   // Over 50°C triggers fire/alarm
  },
  outsideTemperature: {
    min: 0,
    max: 65
  },
  humidity: {
    min: 20,
    max: 80   // You can adjust as per your sensor/environment
  },
  inputVoltage: {
    min: 40.0,
    max: 65.0
  },
  outputVoltage: {
    min: 45.0,
    max: 55.0
  },
  batteryBackup: {
    min: 8,     // minimum 10 mins backup expected
    max: 13     // assume 2 hrs max for chart normalization
  }
};
