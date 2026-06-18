const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fixturesDir = path.join(root, "fixtures");
const readmePath = path.join(root, "README.md");
const indexPath = path.join(fixturesDir, "index.html");
const validExpectations = new Set(["auto-active", "auto-inactive", "auto-uncertain"]);
const validCoverageTags = new Set([
  "badges",
  "callouts",
  "changelog",
  "custom-elements",
  "dark-islands",
  "dashboard-negative",
  "nav",
  "svg-labels",
  "tables"
]);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(message, failures) {
  failures.push(message);
}

function fixtureFiles() {
  return fs
    .readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".html") && file !== "index.html")
    .sort();
}

function expectedBehavior(html) {
  return html.match(/<meta\s+name="light-reader-expected"\s+content="([^"]+)"/i)?.[1] || "";
}

function coverageTags(html) {
  const content = html.match(/<meta\s+name="light-reader-covers"\s+content="([^"]+)"/i)?.[1] || "";
  return content
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function linkedFixtures(html) {
  return Array.from(html.matchAll(/<a\s+href="([^"]+\.html)"/gi))
    .map((match) => match[1])
    .filter((href) => href !== "index.html")
    .sort();
}

function localReferences(html) {
  const refs = [];

  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
    refs.push(match[1]);
  }

  for (const match of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)) {
    refs.push(match[1]);
  }

  return refs.filter((ref) => !/^(https?:|data:|mailto:|#)/i.test(ref));
}

function hasInlineScript(html) {
  return Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)).some((match) => {
    return match[1].trim().length > 0;
  });
}

function run() {
  const failures = [];
  const files = fixtureFiles();
  const indexHtml = read(indexPath);
  const readme = read(readmePath);
  const linked = linkedFixtures(indexHtml);

  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    const html = read(filePath);
    const expected = expectedBehavior(html);
    const tags = coverageTags(html);

    if (!expected) {
      fail(`${file} is missing light-reader-expected metadata.`, failures);
    } else if (!validExpectations.has(expected)) {
      fail(`${file} has invalid expectation "${expected}".`, failures);
    }

    for (const tag of tags) {
      if (!validCoverageTags.has(tag)) {
        fail(`${file} has invalid coverage tag "${tag}".`, failures);
      }
    }

    if ((file.startsWith("dark-island") || file === "dark-header-changelog.html") && !tags.includes("dark-islands")) {
      fail(`${file} must include dark-islands coverage metadata.`, failures);
    }

    if (!linked.includes(file)) {
      fail(`${file} is not linked from fixtures/index.html.`, failures);
    }

    if (!readme.includes(file)) {
      fail(`${file} is not mentioned in README.md.`, failures);
    }

    if (hasInlineScript(html)) {
      fail(`${file} contains inline script; use an external fixture script.`, failures);
    }

    for (const ref of localReferences(html)) {
      const refPath = path.resolve(path.dirname(filePath), ref);
      if (!fs.existsSync(refPath)) {
        fail(`${file} references missing local file ${ref}.`, failures);
      }
    }
  }

  for (const file of linked) {
    if (!files.includes(file)) {
      fail(`fixtures/index.html links missing fixture ${file}.`, failures);
    }
  }

  if (failures.length) {
    console.error(failures.map((message) => `- ${message}`).join("\n"));
    process.exit(1);
  }

  console.log(`Checked ${files.length} fixtures.`);
}

run();
