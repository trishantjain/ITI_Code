const net = require('net');
const path = require('path');
const csv = require('csv-parser');
const fs = require('fs');


const TOTAL_DEVICES = 11;
const devices = [];
let csvData = [];
let currentSecond = 0;
let isCSVMode = true;

// 🔥 PRE-INDEXING: Fast lookup structure
let csvDataBySecond = new Map(); // { second → [row1, row2, ...] }

const connectedDevices = new Map();

function generateMac(index) {
  return `00:11:22:33:44:${(index % 256).toString(16).padStart(2, '0').toUpperCase()}`;
}

function toFloatLE(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(value, 0);
  return buf;
}

// Reading CSV File
function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const csv_path = path.resolve(filePath);

    fs.createReadStream(csv_path).pipe(csv())
      .on('data', (row) => {

        const cleanedRow = {};
        Object.keys(row).forEach(key => {
          cleanedRow[key] = typeof row[key] === 'string' ? row[key].trim() : row[key];
        });
        results.push(cleanedRow);
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (err) => {
        reject(err);
      })
  })
}

// // Fetching Data for particular second
// function getDataForSecond(second, mac) {
//   return csvData.find(row =>
//     parseInt(row.seconds) === second && row.mac === mac
//   );
// }

function preIndexCSVData() {
  console.log('⚡ Pre-indexing CSV data...');

  csvDataBySecond.clear(); // Clear any existing data

  // Index by SECOND (for dispatcher)
  csvData.forEach(row => {
    const second = parseInt(row.seconds);
    if (!csvDataBySecond.has(second)) {
      csvDataBySecond.set(second, []);
    }
    csvDataBySecond.get(second).push(row);
  });

  console.log(`⚡ Indexed ${csvDataBySecond.size} seconds`);

  // Debug: Show index statistics
  console.log('📊 Index Statistics:');
  const secondsWithData = Array.from(csvDataBySecond.keys()).sort((a, b) => a - b);
  const maxDataInSecond = Math.max(...Array.from(csvDataBySecond.values()).map(arr => arr.length));
  console.log(`   Seconds range: ${secondsWithData[0]} to ${secondsWithData[secondsWithData.length - 1]}`);
  console.log(`   Most data in one second: ${maxDataInSecond}`);
}


function sendPacketForRow(client, row, mac, index) {
  const insideTemp = parseFloat(row.inside_temp) || (35 + Math.random() * 3);
  const outsideTemp = parseFloat(row.outside_temp) || (insideTemp + 5 + Math.random() * 3);
  const waterLeakage = parseInt(row.water_leakage) || (Math.random() < 0.2 ? 1 : 0);
  const waterLogging = parseInt(row.water_logging) || (Math.random() < 0.2 ? 1 : 0);

  // Random values for other fields
  const humidity = parseFloat(row.humidity) || (55 + Math.random() * 5);
  const lockStatus = Math.random() < 0.5 ? 1 : 0;
  const doorStatus = 0;
  const inputVoltage = parseFloat(row.input_volt) || (33 + Math.random() * 2);
  const outputVoltage = parseFloat(row.output_volt) || (3.3 + Math.random() * 0.1);
  const batteryBackup = parseFloat(row.battery_back) || (12 + Math.random() * 3);

  const alarmActive = waterLogging || waterLeakage;
  const fireAlarm = 0;

  // Fan simulation (from original code)
  const fan1 = Math.random() < 0.9 ? 1 : 0;
  const fan2 = Math.random() < 0.9 ? 1 : 0;
  const fan3 = Math.random() < 0.9 ? 1 : 0;
  const fan4 = Math.random() < 0.9 ? 1 : 0;

  // Fan status codes (from original code)
  const fanStatuses = [];
  for (let i = 0; i < 6; i++) {
    const rand = Math.random();
    fanStatuses[i] = rand < 0.4 ? 0 : rand < 0.9 ? 1 : 2;
  }

  let fanStatusBits = 0;
  for (let i = 0; i < 6; i++) {
    fanStatusBits |= (fanStatuses[i] << (i * 2));
  }
  const fanStatusBuf = Buffer.alloc(2);
  fanStatusBuf.writeUInt16LE(fanStatusBits, 0);

  // Fail mask (from original code)
  let failMask = 0;
  const failBuf = Buffer.alloc(4);
  failBuf.writeUInt32LE(failMask, 0);

  // Build packet
  const packet = Buffer.concat([
    Buffer.from(mac.padEnd(17, ' '), 'utf-8'),
    toFloatLE(humidity),
    toFloatLE(insideTemp),
    toFloatLE(outsideTemp),
    Buffer.from([lockStatus, doorStatus, waterLogging, waterLeakage]),
    toFloatLE(outputVoltage),
    toFloatLE(inputVoltage),
    toFloatLE(batteryBackup),
    Buffer.from([
      alarmActive ? 1 : 0,
      fireAlarm,
      fan1,
      fan2,
      fan3,
      fan4,
      0 // padding
    ]),
    fanStatusBuf,
    failBuf
  ]);

  console.log(`[${mac}] CSV: Temp=${insideTemp}°C, WaterLeak=${waterLeakage}, WaterLog=${waterLogging}`);
  client.write(packet);
}


function startDevice(mac, index) {
  try {
    const client = net.createConnection({ host: 'localhost', port: 4000 });

    // 🔧 NEW: Store this device in our connected devices map
    connectedDevices.set(mac, client);

    client.on('connect', () => {
      console.log(`✅ Connected as ${mac}`);

      if (!isCSVMode) {
        console.log(`🔄 ${mac} starting in RANDOM mode`);

        let sendCount = 0;
        const isHealthyDevice = index >= TOTAL_DEVICES - 2;
        const isDisconnectedSim = index >= TOTAL_DEVICES - 5 && index < TOTAL_DEVICES - 2;

        let alarmStart = 5 + Math.floor(Math.random() * 5);
        let alarmDuration = 2 + Math.floor(Math.random() * 2);
        let inAlarmPhase = false;

        const interval = setInterval(() => {
          sendCount++;

          console.log(`\n🎲 [${mac}] RANDOM MODE - Packet #${sendCount}`);

          // Disconnection Simulation
          if (isDisconnectedSim && sendCount >= 3) {
            console.log(`❌ [${mac}] DISCONNECTING after ${sendCount} packets`);
            clearInterval(interval);
            connectedDevices.delete(mac); // 🔧 NEW: Remove from map
            client.end();

            const reconnectDelay = 10000 + Math.random() * 10000;
            console.log(`🔄 [${mac}] Will reconnect in ${(reconnectDelay / 1000).toFixed(1)}s`);
            setTimeout(() => startDevice(mac, index), reconnectDelay);
            return;
          }

          // Toggle alarm phase
          if (isHealthyDevice) {
            if (sendCount >= alarmStart && sendCount < alarmStart + alarmDuration) {
              inAlarmPhase = true;
              console.log(`🚨 [${mac}] ALARM PHASE ACTIVATED`);
            } else {
              inAlarmPhase = false;
              console.log(`✅ [${mac}] NORMAL PHASE`);
            }

            if (sendCount >= alarmStart + alarmDuration) {
              alarmStart = sendCount + 5 + Math.floor(Math.random() * 5);
              alarmDuration = 2 + Math.floor(Math.random() * 2);
              console.log(`🔄 [${mac}] Next alarm at packet #${alarmStart}`);
            }
          }

          const triggerAlarm = !isHealthyDevice || inAlarmPhase;

          // SENSOR DATA GENERATION
          const humidity = triggerAlarm ? 85 + Math.random() * 10 : 55 + Math.random() * 5;
          const insideTemp = triggerAlarm ? 55 + Math.random() * 5 : 35 + Math.random() * 3;
          const outsideTemp = triggerAlarm ? 65 + Math.random() * 5 : 40 + Math.random() * 3;
          const lockStatus = Math.random() < 0.5 ? 1 : 0;
          const doorStatus = 0;
          const waterLogging = 1;
          const waterLeakage = !triggerAlarm && Math.random() < 0.2 ? 1 : 0;
          const outputVoltage = triggerAlarm ? 2.5 + Math.random() * 0.2 : 3.3 + Math.random() * 0.1;
          const inputVoltage = outputVoltage * 10;
          const batteryBackup = triggerAlarm ? 5 + Math.random() * 2 : 12 + Math.random() * 3;
          const alarmActive = waterLogging || waterLeakage;
          const fireAlarm = 0;

          const fan1 = Math.random() < 0.9 ? 1 : 0;
          const fan2 = Math.random() < 0.9 ? 1 : 0;
          const fan3 = Math.random() < 0.9 ? 1 : 0;
          const fan4 = Math.random() < 0.9 ? 1 : 0;

          const fanStatuses = [];
          for (let i = 0; i < 6; i++) {
            const rand = Math.random();
            fanStatuses[i] = rand < 0.4 ? 0 : rand < 0.9 ? 1 : 2;
          }

          let fanStatusBits = 0;
          for (let i = 0; i < 6; i++) {
            fanStatusBits |= (fanStatuses[i] << (i * 2));
          }
          const fanStatusBuf = Buffer.alloc(2);
          fanStatusBuf.writeUInt16LE(fanStatusBits, 0);

          let failMask = 0;
          for (let bit = 0; bit <= 5; bit++) {
            if (triggerAlarm && Math.random() < 0.1) failMask |= (1 << bit);
          }

          const failBuf = Buffer.alloc(4);
          failBuf.writeUInt32LE(failMask, 0);

          const packet = Buffer.concat([
            Buffer.from(mac.padEnd(17, ' '), 'utf-8'),
            toFloatLE(humidity),
            toFloatLE(insideTemp),
            toFloatLE(outsideTemp),
            Buffer.from([lockStatus, doorStatus, waterLogging, waterLeakage]),
            toFloatLE(outputVoltage),
            toFloatLE(inputVoltage),
            toFloatLE(batteryBackup),
            Buffer.from([
              alarmActive ? 1 : 0,
              fireAlarm,
              fan1,
              fan2,
              fan3,
              fan4,
              0
            ]),
            fanStatusBuf,
            failBuf
          ]);

          const status = isDisconnectedSim && sendCount >= 3 ? '❌ DISCONNECTED' : triggerAlarm ? '🚨 ALARM' : '✅ NORMAL';
          console.log(`📤 [${mac}] ${status} | Sending packet #${sendCount}`);
          client.write(packet);
        }, 2000);

        client.on('close', () => {
          console.warn(`🔌 [${mac}] CONNECTION CLOSED`);
          connectedDevices.delete(mac); // 🔧 NEW: Remove from map
          clearInterval(interval);
        });
      }
      // 🔧 NEW: No CSV mode logic here - handled by central dispatcher
    });

    client.on('error', (err) => {
      console.error(`💥 [${mac}] CONNECTION ERROR:`, err.message);
      connectedDevices.delete(mac); // 🔧 NEW: Remove from map
      setTimeout(() => startDevice(mac, index), 5000);
    });

    client.on('close', () => {
      console.warn(`🔌 [${mac}] CONNECTION CLOSED`);
      connectedDevices.delete(mac); // 🔧 NEW: Remove from map
    });

  } catch (err) {
    console.error(`💥 [${mac}] START DEVICE ERROR:`, err);
    setTimeout(() => startDevice(mac, index), 5000);
  }
}

/*
function startDevice(mac, index) {
  try {
    const client = net.createConnection({ host: 'localhost', port: 4000 });
    client.on('connect', () => {
      console.log(`✅ Connected as ${mac}`);

      if (isCSVMode && csvData.length > 0) {
        console.log(`📄 ${mac} starting in CSV mode`);

        // Get ALL data for this specific device and sort by seconds
        const deviceData = csvData
          .filter(row => row.mac === mac)
          .sort((a, b) => parseInt(a.seconds) - parseInt(b.seconds));

        console.log(`📊 ${mac} has ${deviceData.length} data points`);

        if (deviceData.length === 0) {
          console.log(`❌ No CSV data for ${mac}, switching to random mode`);
          isCSVMode = false;
          client.end();
          setTimeout(() => startDevice(mac, index), 1000);
          return;
        }

        let dataIndex = 0;

        const interval = setInterval(() => {
          if (dataIndex >= deviceData.length) {
            console.log(`📄 CSV data completed for ${mac}! Switching to random mode...`);
            clearInterval(interval);
            isCSVMode = false;
            client.end();
            setTimeout(() => startDevice(mac, index), 1000);
            return;
          }

          const row = deviceData[dataIndex];
          console.log(`⏰ [${mac}] Processing second ${row.seconds} (${dataIndex + 1}/${deviceData.length})`);

          sendPacketForRow(client, row, mac, index);
          dataIndex++;

        }, 2000);
      } else {
        console.log(`🔄 ${mac} starting in random mode`);
        console.log(`🔄 ${mac} starting in random mode`);

        let sendCount = 0;
        const isHealthyDevice = index >= TOTAL_DEVICES - 2;
        const isDisconnectedSim = index >= TOTAL_DEVICES - 5 && index < TOTAL_DEVICES - 2;

        let alarmStart = 5 + Math.floor(Math.random() * 5);
        let alarmDuration = 2 + Math.floor(Math.random() * 2);
        let inAlarmPhase = false;

        const interval = setInterval(() => {
          sendCount++;

          // Disconnection Simulation
          if (isDisconnectedSim && sendCount >= 3) {
            console.log(`❌ [${mac}] Disconnecting after ${sendCount} packets`);
            clearInterval(interval);
            client.end();

            const reconnectDelay = 10000 + Math.random() * 10000;
            console.log(`🔄 [${mac}] Will reconnect in ${(reconnectDelay / 1000).toFixed(1)}s`);
            setTimeout(() => startDevice(mac, index), reconnectDelay);
            return;
          }

          // Toggle alarm phase
          if (isHealthyDevice) {
            if (sendCount >= alarmStart && sendCount < alarmStart + alarmDuration) {
              inAlarmPhase = true;
            } else {
              inAlarmPhase = false;
            }

            if (sendCount >= alarmStart + alarmDuration) {
              alarmStart = sendCount + 5 + Math.floor(Math.random() * 5);
              alarmDuration = 2 + Math.floor(Math.random() * 2);
            }
          }

          // Your existing random data generation code here...
          const triggerAlarm = !isHealthyDevice || inAlarmPhase;

          // ... (keep all your random sensor data generation code)

          const status = isDisconnectedSim && sendCount >= 3 ? '❌ DISCONNECTED' : triggerAlarm ? '🚨 ALARM' : '✅ NORMAL';
          console.log(`[${mac}] ${status} | Packet #${sendCount}`);
          // client.write(packet); // Your existing packet sending

        }, 2000);

      }
    });

    client.on('error', (err) => {
      console.error(`${mac} connection error:`, err);
    });

    client.on('close', () => {
      console.warn(`${mac} connection closed`);
    });

  } catch (err) {
    console.error(`Error in startDevice for ${mac}:`, err);
  }
}
*/

// 🔧 NEW: Central Data Dispatcher
function startDataDispatcher() {
  console.log('🚀 Starting CENTRAL DATA DISPATCHER');

  const interval = setInterval(() => {
    console.log(`\n🕒 === DISPATCHING SECOND ${currentSecond} ===`);

    // data for current second (any MAC)
    const allDataThisSecond = csvDataBySecond.get(currentSecond) || [];


    console.log(`📊 Found ${allDataThisSecond.length} data entries for second ${currentSecond}`);

    if (allDataThisSecond.length === 0) {
      console.log(`⏭️ No data for any device at second ${currentSecond}`);
    } else {
      // Parsing each data entry to the appropriate device
      allDataThisSecond.forEach(dataRow => {
        const targetMAC = dataRow.mac;

        console.log(`🎯 Dispatching to ${targetMAC}:`, {
          humidity: dataRow.humidity,
          temp: dataRow.inside_temp,
          outside_temp: dataRow.outside_temp
        });

        // 3. Find the client for this MAC
        const client = connectedDevices.get(targetMAC);

        if (client && client.writable) {
          // Find device index for logging
          const deviceIndex = devices.findIndex(d => d === targetMAC);
          sendPacketForRow(client, dataRow, targetMAC, deviceIndex);
          console.log(`✅ Data sent to ${targetMAC}`);
        } else {
          console.log(`❌ Device ${targetMAC} not connected or not writable`);
        }
      });
    }

    // Moving to next second
    const previousSecond = currentSecond;
    currentSecond++;
    console.log(`🔄 Moving to next second: ${previousSecond} → ${currentSecond}`);

    // Check if we've reached the end of CSV timeline
    const maxSecond = Math.max(...csvData.map(row => parseInt(row.seconds)));
    console.log(`📈 Max second in CSV: ${maxSecond}, Current: ${currentSecond}`);

    if (currentSecond > maxSecond) {
      console.log('🏁 CSV timeline completed! Switching all devices to RANDOM mode');
      clearInterval(interval);
      isCSVMode = false;

      // All devices will now operate in random mode (handled in startDevice)
    }

  }, 2000); // Dispatch every 2 seconds
}

async function initializeSimulator() {
  try {
    console.log('📄 Attempting to load CSV data...');
    csvData = await readCSV('C:/Users/ITI/Documents/TechnoTrendz/simulator/sim_pack.csv');

    preIndexCSVData();

    // 🔍 Debug: Analyze CSV data
    const uniqueMACs = [...new Set(csvData.map(row => row.mac))];
    console.log(`🔍 CSV Analysis:`);
    console.log(`   Total rows: ${csvData.length}`);
    console.log(`   Unique MACs: ${uniqueMACs.length}`);
    console.log(`   MACs in CSV: ${uniqueMACs.join(', ')}`);

    // Show seconds distribution
    const secondsSample = [...new Set(csvData.map(row => parseInt(row.seconds)))].sort((a, b) => a - b).slice(0, 10);
    console.log(`   First 10 seconds: [${secondsSample.join(', ')}]`);

    // Start all devices
    for (let i = 0; i < TOTAL_DEVICES; i++) {
      const mac = generateMac(i);
      startDevice(mac, i);
      devices.push(mac);
    }

    // 🔧 NEW: Start the central data dispatcher after a brief delay
    setTimeout(() => {
      startDataDispatcher();
    }, 3000);

  } catch (err) {
    console.log('❌ CSV not found, using FULL RANDOM mode...');
    isCSVMode = false;

    // Start all devices in random mode
    for (let i = 0; i < TOTAL_DEVICES; i++) {
      const mac = generateMac(i);
      startDevice(mac, i);
      devices.push(mac);
    }
  }
}

// Start the simulator
initializeSimulator();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping simulator...');
  process.exit(0);
});


/* // Start all devices
let index = 0;
const spawnInterval = setInterval(() => {
  if (index >= TOTAL_DEVICES) {
    clearInterval(spawnInterval);
    console.log('✅ All simulated devices started.');
    return;
  }
  const mac = generateMac(index);
  startDevice(mac, index);
  devices.push(mac);
  index++;
}, 10);
 */