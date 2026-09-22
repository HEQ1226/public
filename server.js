const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "services.json");
const REGISTER_KEY = String(process.env.REGISTER_KEY || "").trim();
const HEARTBEAT_TTL_MS = Number(process.env.HEARTBEAT_TTL_MS || 30000);
const serviceHeartbeats = new Map();

/**
 * 确保存储目录和文件存在。
 */
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    // 默认保留 3 个测试服务，后续你可在 data/services.json 中删除或替换。
    const defaults = [
      {
        name: "云盘服务",
        slug: "cloud-drive",
        description: "私有云存储，安全高效，支持跨设备快速同步。",
        tag: "主推荐",
        targetUrl: "https://example.com/cloud-drive",
        tone: "blue"
      },
      {
        name: "数据面板",
        slug: "dashboard",
        description: "实时监控与可视化分析，快速掌握关键指标趋势。",
        tag: "数据分析",
        targetUrl: "https://example.com/dashboard",
        tone: "indigo"
      },
      {
        name: "代码仓库",
        slug: "git-repo",
        description: "私有仓库与版本管理，支持团队协作流程。",
        tag: "开发协作",
        targetUrl: "https://example.com/git-repo",
        tone: "violet"
      }
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2), "utf8");
  }
}

/**
 * 统一响应格式。
 */
function sendJson(res, code, msg, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(
    JSON.stringify({
      code,
      msg,
      data,
      timestamp: new Date().toISOString()
    })
  );
}

/**
 * 统一错误响应。
 */
function sendError(res, msg, status = 400, code = 1) {
  sendJson(res, code, msg, null, status);
}

function readServices() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function saveServices(services) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(services, null, 2), "utf8");
}

function isValidSlug(slug) {
  return /^[a-z0-9-]{2,32}$/.test(slug);
}

function isSafeUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

/**
 * 统一解析注册参数。
 */
function buildServicePayload(payload) {
  return {
    name: String(payload.name || "").trim(),
    slug: String(payload.slug || "").trim(),
    description: String(payload.description || "").trim(),
    targetUrl: String(payload.targetUrl || "").trim(),
    tag: String(payload.tag || "新注册").trim(),
    tone: String(payload.tone || "blue").trim()
  };
}

/**
 * 校验注册参数。
 */
function validateServicePayload(service) {
  if (!service.name || !service.slug || !service.description || !service.targetUrl) {
    return "参数不完整";
  }
  if (!isValidSlug(service.slug)) {
    return "服务编码格式非法";
  }
  if (!isSafeUrl(service.targetUrl)) {
    return "目标地址不合法";
  }
  return "";
}

/**
 * 根据心跳时间给服务打在线状态。
 */
function attachServiceStatus(service) {
  const lastSeenAt = serviceHeartbeats.get(service.slug) || 0;
  const isOnline = Date.now() - lastSeenAt <= HEARTBEAT_TTL_MS;
  return {
    ...service,
    isOnline,
    lastSeenAt: lastSeenAt || null
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 64) {
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("请求体 JSON 格式错误"));
      }
    });
    req.on("error", () => reject(new Error("读取请求体失败")));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;

    if (req.method === "OPTIONS") {
      return sendJson(res, 0, "ok", null, 200);
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 0, "服务运行正常", { status: "ok" });
    }

    if (req.method === "GET" && pathname === "/api/services") {
      const services = readServices();
      return sendJson(res, 0, "查询成功", services.map(attachServiceStatus));
    }

    if (req.method === "GET" && pathname.startsWith("/api/services/")) {
      const slug = decodeURIComponent(pathname.split("/").pop() || "");
      if (!isValidSlug(slug)) {
        return sendError(res, "服务编码格式非法", 400);
      }
      const services = readServices();
      const target = services.find((item) => item.slug === slug);
      if (!target) {
        return sendError(res, "服务不存在", 404);
      }
      return sendJson(res, 0, "查询成功", attachServiceStatus(target));
    }

    if (req.method === "POST" && pathname === "/api/services") {
      const payload = await parseBody(req);
      const service = buildServicePayload(payload);
      const validateError = validateServicePayload(service);
      if (validateError) return sendError(res, validateError);

      const services = readServices();
      if (services.some((item) => item.slug === service.slug)) {
        return sendError(res, "服务编码已存在", 409);
      }
      services.push(service);
      saveServices(services);
      return sendJson(res, 0, "注册成功", service, 201);
    }

    // 服务自注册（幂等）：服务启动时主动上报，存在则更新，不存在则新增
    if (req.method === "POST" && pathname === "/api/services/register") {
      if (REGISTER_KEY) {
        const requestRegisterKey = String(req.headers["x-register-key"] || "").trim();
        if (!requestRegisterKey || requestRegisterKey !== REGISTER_KEY) {
          return sendError(res, "注册密钥无效", 401);
        }
      }

      const payload = await parseBody(req);
      const service = buildServicePayload(payload);
      const validateError = validateServicePayload(service);
      if (validateError) return sendError(res, validateError);

      const services = readServices();
      const index = services.findIndex((item) => item.slug === service.slug);
      if (index >= 0) {
        services[index] = { ...services[index], ...service };
      } else {
        services.push(service);
      }
      saveServices(services);
      return sendJson(res, 0, "自注册成功", service, 201);
    }

    // 服务心跳：服务存活期间定时上报，供引导页展示在线状态
    if (req.method === "POST" && pathname === "/api/services/heartbeat") {
      if (REGISTER_KEY) {
        const requestRegisterKey = String(req.headers["x-register-key"] || "").trim();
        if (!requestRegisterKey || requestRegisterKey !== REGISTER_KEY) {
          return sendError(res, "心跳密钥无效", 401);
        }
      }
      const payload = await parseBody(req);
      const slug = String(payload.slug || "").trim();
      if (!isValidSlug(slug)) {
        return sendError(res, "服务编码格式非法");
      }
      const services = readServices();
      const exists = services.some((item) => item.slug === slug);
      if (!exists) {
        return sendError(res, "服务不存在，无法上报心跳", 404);
      }
      const now = Date.now();
      serviceHeartbeats.set(slug, now);
      return sendJson(res, 0, "心跳上报成功", { slug, lastSeenAt: now });
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/services/")) {
      const slug = decodeURIComponent(pathname.split("/").pop() || "");
      if (!isValidSlug(slug)) {
        return sendError(res, "服务编码格式非法");
      }
      const services = readServices();
      const next = services.filter((item) => item.slug !== slug);
      if (next.length === services.length) {
        return sendError(res, "服务不存在", 404);
      }
      saveServices(next);
      return sendJson(res, 0, "删除成功", { slug });
    }

    return sendError(res, "接口不存在", 404);
  } catch (error) {
    console.error("网关服务异常:", error);
    return sendError(res, "服务器内部异常", 500, 500);
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Gateway API running at http://localhost:${PORT}`);
});
