const { execFile } = require("child_process");
const path = require("path");

const ES_EXE = process.env.EVERYTHING_ES_PATH || "E:/Everything/es.exe";
const MAX_RESULTS = 50;
const EXEC_TIMEOUT_MS = 15_000;

const SERVER_NAME = "everything-search";
const SERVER_VERSION = "1.0.0";

let buffer = "";

function respond(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

const EXTENSION_MAP = {
  excel: "xlsx|xls|xlsm|xltx|xltm",
  word: "docx|doc|docm|dotx",
  pdf: "pdf",
  image: "png|jpg|jpeg|gif|bmp|webp|svg|ico|tiff|psd",
  ppt: "pptx|ppt|pptm|potx",
  text: "txt|md|csv|json|xml|yaml|yml|log",
  video: "mp4|avi|mkv|mov|wmv|flv|webm",
  audio: "mp3|wav|flac|aac|ogg|wma|m4a",
  archive: "zip|rar|7z|tar|gz|bz2",
};

function buildExtensionFilter(extArg) {
  if (!extArg) return "";
  const trimmed = extArg.trim().toLowerCase();
  if (trimmed === "any" || trimmed === "不限" || trimmed === "all") return "";
  if (EXTENSION_MAP[trimmed]) return `ext:${EXTENSION_MAP[trimmed]}`;
  const clean = trimmed.replace(/^\./, "").replace(/[^a-z0-9|*]/g, "");
  return clean ? `ext:${clean}` : "";
}

function buildEverythingArgs({ keyword, path: searchPath, ext, fuzzy, maxResults, sortBy }) {
  const args = [];

  if (searchPath) {
    args.push("-path", searchPath);
  }

  const extFilter = buildExtensionFilter(ext);
  if (extFilter) args.push(extFilter);

  if (sortBy === "date") {
    args.push("-sort-dm-descending");
  }

  args.push("-n", String(Math.min(maxResults || 20, MAX_RESULTS)));
  args.push("-full-path-and-name");

  if (fuzzy) {
    const fuzzyPattern = keyword.replace(/[?*]/g, (m) => m === "?" ? "?" : "*");
    args.push(fuzzyPattern);
  } else {
    args.push(keyword);
  }

  return args;
}

function runEs(args) {
  return new Promise((resolve, reject) => {
    execFile(ES_EXE, args, {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      encoding: "buffer",
    }, (err, stdout, stderr) => {
      if (err && err.killed) {
        return reject(new Error("es.exe timed out"));
      }
      if (err && !stdout) {
        return reject(new Error(err.message || String(err)));
      }
      const stdoutStr = decodeWindowsOutput(stdout);
      const stderrStr = decodeWindowsOutput(stderr);
      resolve({ stdout: stdoutStr, stderr: stderrStr });
    });
  });
}

function decodeWindowsOutput(buf) {
  if (!buf || buf.length === 0) return "";
  try {
    return new TextDecoder("gbk", { fatal: false }).decode(buf);
  } catch {
    return Buffer.from(buf).toString("utf8");
  }
}

function parseSearchResults(stdout) {
  if (!stdout.trim()) return { files: [], truncated: false };
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const files = lines.map((line) => {
    try {
      const absPath = line.trim();
      const dir = path.dirname(absPath);
      const name = path.basename(absPath);
      const ext = path.extname(name).toLowerCase();
      let fileType = ext.replace(".", "");
      return { name, path: absPath, directory: dir, extension: fileType };
    } catch {
      return { name: line, path: line, directory: "", extension: "" };
    }
  });
  return { files, truncated: files.length >= MAX_RESULTS };
}

async function handleSearchFiles(params) {
  const keyword = (params.keyword || "").trim();
  if (!keyword) throw new Error("keyword is required");

  const args = buildEverythingArgs({
    keyword,
    path: params.path || "",
    ext: params.extension || params.type || "",
    fuzzy: Boolean(params.fuzzy),
    maxResults: params.max_results || 20,
    sortBy: (params.sort || "date"),
  });

  const { stdout } = await runEs(args);
  const { files, truncated } = parseSearchResults(stdout);

  if (files.length === 0) {
    return {
      found: false,
      keyword,
      count: 0,
      hint: "没有找到匹配的文件。试试模糊搜索 (fuzzy: true) 或检查关键词拼写。",
    };
  }

  return {
    found: true,
    keyword,
    count: files.length,
    truncated,
    files: files.map((f) => ({
      name: f.name,
      path: f.path,
      extension: f.extension,
    })),
    hint: truncated
      ? `结果超过限制，只显示前 ${MAX_RESULTS} 条。尝试缩小搜索范围。`
      : undefined,
  };
}

async function handleCountFiles(params) {
  const keyword = (params.keyword || "").trim();
  if (!keyword) throw new Error("keyword is required");

  const extFilter = buildExtensionFilter(params.extension || params.type || "");
  const searchTerm = extFilter ? `${extFilter} ${keyword}` : keyword;
  const { stdout } = await runEs(["-get-result-count", searchTerm]);
  const count = Number.parseInt(stdout.trim(), 10) || 0;
  return { keyword, count, extension: params.extension || null };
}

const TOOLS = [
  {
    name: "search_files",
    description: "使用 Everything 引擎全盘秒搜文件。支持关键词、文件类型过滤、模糊搜索、路径限定。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词（必填）。支持部分匹配，不区分大小写。" },
        type: {
          type: "string",
          description: "文件类型别名：excel, word, pdf, image, ppt, text, video, audio, archive。也可直接写扩展名如 xlsx, docx。",
        },
        path: { type: "string", description: "限定搜索目录路径（可选）。" },
        fuzzy: { type: "boolean", description: "是否启用模糊搜索（用通配符匹配，默认 false）。" },
        max_results: { type: "integer", description: "最大返回数，默认 20，上限 50。" },
        sort: { type: "string", enum: ["date", "name"], description: "排序方式：date 按修改时间降序，name 按文件名。" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "count_files",
    description: "快速统计匹配文件数量，不返回文件列表。适合先确认数量再决定是否拉列表。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词（必填）。" },
        type: {
          type: "string",
          description: "文件类型：excel, word, pdf, image, ppt 或扩展名如 xlsx。",
        },
      },
      required: ["keyword"],
    },
  },
];

async function handleToolsCall(params) {
  const name = params?.name;
  const args = params?.arguments || {};

  try {
    switch (name) {
      case "search_files": {
        const result = await handleSearchFiles(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "count_files": {
        const result = await handleCountFiles(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: "text", text: err.message }], isError: true };
  }
}

async function handle(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        respond(ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        }));
        break;

      case "notifications/initialized":
        break;

      case "tools/list":
        respond(ok(id, { tools: TOOLS }));
        break;

      case "tools/call":
        respond(ok(id, await handleToolsCall(params)));
        break;

      default:
        respond(error(id, -32601, `Method not found: ${method}`));
    }
  } catch (err) {
    respond(error(id, -32603, err.message));
  }
}

function checkEsAvailable() {
  return new Promise((resolve) => {
    execFile(ES_EXE, ["-version"], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(!!stdout);
    });
  });
}

async function main() {
  const available = await checkEsAvailable();
  if (!available) {
    process.stderr.write(`[everything-mcp] WARNING: es.exe not found at ${ES_EXE}\n`);
    process.stderr.write("[everything-mcp] Set EVERYTHING_ES_PATH env var to the correct path.\n");
  } else {
    process.stderr.write(`[everything-mcp] es.exe ready at ${ES_EXE}\n`);
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        handle(JSON.parse(trimmed));
      } catch {
        // ignore malformed JSON
      }
    }
  });

  process.stdin.on("end", () => process.exit(0));
}

main().catch((err) => {
  process.stderr.write(`[everything-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
