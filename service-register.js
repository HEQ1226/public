/**
 * 通用服务注册 SDK（Node.js 18+）
 * 功能：
 * 1. 启动时自注册到引导页网关
 * 2. 定时心跳上报
 * 3. 支持简单重试与优雅停止
 */

/**
 * @typedef {Object} ServiceRegisterOptions
 * @property {string} apiBaseUrl 网关 API 地址（例如 https://638rember.me/api）
 * @property {string} [registerKey] 注册密钥（可选）
 * @property {string} name 服务名称
 * @property {string} slug 服务编码（唯一，建议小写）
 * @property {string} description 服务描述
 * @property {string} targetUrl 服务目标地址
 * @property {string} [tag] 标签（默认：业务服务）
 * @property {string} [tone] 色调（blue|indigo|violet）
 * @property {number} [heartbeatIntervalMs] 心跳间隔毫秒（默认 10000）
 * @property {number} [requestTimeoutMs] 单次请求超时毫秒（默认 5000）
 * @property {number} [retryCount] 注册失败重试次数（默认 3）
 */

/**
 * 创建服务注册客户端。
 * @param {ServiceRegisterOptions} options 配置参数
 */
function createServiceRegisterClient(options) {
  const config = {
    tag: "业务服务",
    tone: "indigo",
    heartbeatIntervalMs: 10000,
    requestTimeoutMs: 5000,
    retryCount: 3,
    ...options
  };

  validateOptions(config);

  let heartbeatTimer = null;
  let stopped = false;

  const headers = {
    "Content-Type": "application/json"
  };
  if (config.registerKey) {
    headers["x-register-key"] = config.registerKey;
  }

  /**
   * 执行带超时的 fetch 请求。
   * @param {string} url 请求地址
   * @param {RequestInit} init fetch 参数
   * @returns {Promise<any>}
   */
  async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.code !== 0) {
        throw new Error(result.msg || `请求失败: ${response.status}`);
      }
      return result.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 注册服务（幂等更新）。
   */
  async function registerOnce() {
    const payload = {
      name: config.name,
      slug: config.slug,
      description: config.description,
      targetUrl: config.targetUrl,
      tag: config.tag,
      tone: config.tone
    };

    return fetchWithTimeout(`${trimSlash(config.apiBaseUrl)}/services/register`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  }

  /**
   * 上报单次心跳。
   */
  async function heartbeatOnce() {
    return fetchWithTimeout(`${trimSlash(config.apiBaseUrl)}/services/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ slug: config.slug })
    });
  }

  /**
   * 启动注册与心跳任务。
   */
  async function start() {
    stopped = false;
    await retry(registerOnce, config.retryCount);

    // 注册成功后立即打一次心跳，再开始周期上报
    await heartbeatOnce();
    heartbeatTimer = setInterval(async () => {
      if (stopped) return;
      try {
        await heartbeatOnce();
      } catch (error) {
        console.error(`[service-register] 心跳失败(${config.slug}):`, error.message);
      }
    }, config.heartbeatIntervalMs);
  }

  /**
   * 停止心跳任务。
   */
  function stop() {
    stopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  return {
    start,
    stop,
    registerOnce,
    heartbeatOnce
  };
}

/**
 * 基础参数校验。
 * @param {ServiceRegisterOptions} config 配置
 */
function validateOptions(config) {
  const requiredFields = ["apiBaseUrl", "name", "slug", "description", "targetUrl"];
  requiredFields.forEach((field) => {
    if (!config[field]) {
      throw new Error(`[service-register] 缺少必要参数: ${field}`);
    }
  });
}

/**
 * 重试执行工具。
 * @param {() => Promise<any>} fn 异步任务
 * @param {number} retryCount 重试次数
 */
async function retry(fn, retryCount) {
  let lastError = null;
  for (let i = 0; i <= retryCount; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retryCount) {
        await sleep(500 * (i + 1));
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

module.exports = {
  createServiceRegisterClient
};

/**
 * 使用示例：
 *
 * const { createServiceRegisterClient } = require("./service-register");
 *
 * const client = createServiceRegisterClient({
 *   apiBaseUrl: "https://638rember.me/api",
 *   registerKey: process.env.REGISTER_KEY,
 *   name: "订单服务",
 *   slug: "order-service",
 *   description: "订单创建与查询",
 *   targetUrl: "https://order.example.com",
 *   tag: "业务服务",
 *   tone: "indigo",
 *   heartbeatIntervalMs: 10000
 * });
 *
 * client.start().catch((err) => {
 *   console.error("注册启动失败:", err.message);
 *   process.exit(1);
 * });
 *
 * process.on("SIGINT", () => {
 *   client.stop();
 *   process.exit(0);
 * });
 */
