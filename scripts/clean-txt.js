const fs = require("fs");
const path = require("path");

function clean(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const name of items) {
    const fp = path.join(dir, name);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) {
      clean(fp);
    } else if (name.endsWith(".txt")) {
      fs.unlinkSync(fp);
    }
  }
}

clean("out");
