// stats.js
const fs = require("fs");
const path = require("path");

const statsPath = path.join(__dirname, "stats.json");

function loadStats() {
  if (!fs.existsSync(statsPath)) {
    return { totalMessages: 0, users: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(statsPath, "utf8"));
  } catch (e) {
    console.error("Failed to read stats.json:", e);
    return { totalMessages: 0, users: {} };
  }
}

function saveStats(stats) {
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

function recordMessage(userId) {
  const stats = loadStats();
  const id = String(userId);
  const now = new Date().toISOString();

  stats.totalMessages += 1;

  if (!stats.users[id]) {
    stats.users[id] = {
      firstSeen: now,
      lastSeen: now,
      messageCount: 1,
    };
  } else {
    stats.users[id].lastSeen = now;
    stats.users[id].messageCount += 1;
  }

  saveStats(stats);
}

function getStats() {
  const stats = loadStats();
  const uniqueUsers = Object.keys(stats.users).length;
  return {
    totalMessages: stats.totalMessages,
    uniqueUsers,
    users: stats.users,
  };
}

module.exports = { recordMessage, getStats };
