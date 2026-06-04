// CLI script for managing users in config/users.json
const bcrypt  = require("bcryptjs");
const fs      = require("fs");
const path    = require("path");
const readline = require("readline");

const USERS_FILE = path.join(__dirname, "../config/users.json");

// Read saved users from disk. If the file is missing or invalid, return an empty list.
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return []; }
}

// Write the current user list back to disk in pretty JSON format.
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const users = loadUsers();

  console.log("\n── Cairn Monitor · User Management ──────────────────\n");

  // Ask the admin what operation to perform.
  const action = await prompt(rl, "Action — (a)dd / (r)emove / (l)ist  → ");

  if (action.trim().toLowerCase() === "l") {
    // List all users.
    if (users.length === 0) {
      console.log("No users yet.\n");
    } else {
      console.log("\nCurrent users:");
      users.forEach(u => console.log(`  • ${u.username}  (${u.name})`));
      console.log();
    }
    rl.close();
    return;
  }

  if (action.trim().toLowerCase() === "r") {
    // Remove a user by username.
    if (users.length === 0) { console.log("No users to remove.\n"); rl.close(); return; }
    console.log("\nUsers:", users.map(u => u.username).join(", "));
    const uname = await prompt(rl, "Username to remove: ");
    const idx   = users.findIndex(u => u.username.toLowerCase() === uname.trim().toLowerCase());
    if (idx === -1) {
      console.log("User not found.\n");
    } else {
      users.splice(idx, 1);
      saveUsers(users);
      console.log(`Removed: ${uname.trim()}\n`);
    }
    rl.close();
    return;
  }

  if (action.trim().toLowerCase() === "a") {
    // Add a new user and hash their password.
    const name     = await prompt(rl, "Full name:  ");
    const username = await prompt(rl, "Username:   ");
    const password = await prompt(rl, "Password:   ");

    if (!name || !username || !password) {
      console.log("All fields are required.\n");
      rl.close();
      return;
    }

    if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
      console.log("A user with that username already exists.\n");
      rl.close();
      return;
    }

    if (password.trim().length < 8) {
      console.log("Password must be at least 8 characters.\n");
      rl.close();
      return;
    }

    const passwordHash = await bcrypt.hash(password.trim(), 12);
    const newUser = {
      id: Date.now().toString(),
      name: name.trim(),
      username: username.trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);
    console.log(`\nUser created: ${newUser.username} (${newUser.name})\n`);
    rl.close();
    return;
  }

  // If the action was not recognized, show an error.
  console.log("Unknown action.\n");
  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
