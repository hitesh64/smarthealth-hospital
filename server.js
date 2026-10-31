// Starts the SmartHealth website with `npm start` (or `node server.js`).
// The website itself is Python (Flask, see app.py); this file only launches it.
// Set PYTHON to use a specific Python, e.g.  PYTHON=python3 npm start
const { spawn } = require("child_process");
const path = require("path");

const root = __dirname;
const candidates = process.env.PYTHON
  ? [[process.env.PYTHON, []]]
  : process.platform === "win32"
    ? [["py", ["-3"]], ["python", []]]
    : [["python3", []], ["python", []]];

function start(i) {
  if (i >= candidates.length) {
    console.error("Python was not found. Install Python 3 and run: pip install -r requirements.txt");
    process.exit(1);
  }
  const [cmd, args] = candidates[i];
  const child = spawn(cmd, [...args, path.join(root, "app.py")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONUNBUFFERED: "1" }, // show Python's messages right away
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") return start(i + 1); // try the next Python command
    console.error(err.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
}

start(0);
