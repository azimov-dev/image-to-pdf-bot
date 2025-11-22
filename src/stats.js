// src/stats.js
const fs = require("fs");
const path = require("path");

// stats.json will sit next to this file: src/stats.json
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

/**
 * userObj = ctx.from
 */
function recordMessage(userObj) {
  if (!userObj || !userObj.id) return;

  const stats = loadStats();
  const id = String(userObj.id);
  const now = new Date().toISOString();

  stats.totalMessages += 1;

  if (!stats.users[id]) {
    stats.users[id] = {
      firstSeen: now,
      lastSeen: now,
      messageCount: 1,
      username: userObj.username || null,
      firstName: userObj.first_name || null,
      lastName: userObj.last_name || null,
    };
  } else {
    const u = stats.users[id];
    u.lastSeen = now;
    u.messageCount = (u.messageCount || 0) + 1;
    u.username = userObj.username || u.username || null;
    u.firstName = userObj.first_name || u.firstName || null;
    u.lastName = userObj.last_name || u.lastName || null;
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

module.exports = { recordMessage, getStats, statsPath };
