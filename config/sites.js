const fs = require("fs");
const path = require("path");
const SITES_FILE = path.join(__dirname, "sites.json");

function loadSites() {
  if (!fs.existsSync(SITES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
  } catch {
    return [];
  }
}

module.exports = loadSites();
