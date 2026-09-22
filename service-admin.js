#!/usr/bin/env node
/**
 * 服务管理脚本（Node.js 18+）
 * 功能：
 * 1. 注册服务
 * 2. 删除服务
 *
 * 使用示例：
 * node service-admin.js register --apiBaseUrl "https://638rember.me" --registerKey "heq123456" --name "OpenClaw" --slug "openclaw" --description "OpenClaw 本机服务" --targetUrl "https://638rember.me/openclaw/" --tag "AI服务" --tone "violet"
 * node service-admin.js delete --apiBaseUrl "https://638rember.me" --registerKey "heq123456" --slug "openclaw"
 */

/**
 * @typedef {Object} CliOptions
 * @property {string} [apiBaseUrl] 网关基础地址（支持 https://xxx 或 https://xxx/api）
 * @property {string} [registerKey] 注册密钥
 * @property {string} [name] 服务名称
 * @property {string} [slug] 服务唯一编码
 * @property {string} [description] 服务描述
 * @property {string} [targetUrl] 服务目标地址
 * @property {string} [tag] 服务标签
 * @property {string} [tone] 服务色调
 */

/**
 * 程序主入口，负责分发命令执行。
 * @returns {Promise<void>}
 */
async function main() {
  const argv = process.argv.slice(2);
  const command = (argv[0] || "").trim().toLowerCase();
  const options = parseArgs(argv.slice(1));

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  try {
    if (command === "register") {
      await registerService(options);
      return;
    }
    if (command === "delete") {
      await deleteService(options);
      return;
    }

    throw new Error(`不支持的命令: ${command}`);
  } catch (error) {
    console.error(`[service-admin] 执行失败: ${error.message}`);
    process.exitCode = 1;
  }
}

/**
 * 注册服务到网关。
 * @param {CliOptions} options 命令参数
 * @returns {Promise<void>}
 */
async function registerService(options) {
  requireFields(options, ["apiBaseUrl", "registerKey", "name", "slug", "description", "targetUrl"]);
  validateSlug(options.slug);
  validateHttpUrl(options.targetUrl, "targetUrl");

  const apiBase = normalizeApiBaseUrl(options.apiBaseUrl);
  const endpoint = `${apiBase}/services/register`;
  const payload = {
    name: options.name,
    slug: options.slug,
    description: options.description,
    targetUrl: options.targetUrl,
    tag: options.tag || "业务服务",
    tone: options.tone || "indigo"
  };

  logInfo(`开始注册服务: slug=${payload.slug}, api=${endpoint}`);
  const result = await requestJson(endpoint, {
    method: "POST",
    headers: buildHeaders(options.registerKey),
    body: JSON.stringify(payload)
  });

  logInfo(`注册成功: slug=${result?.slug || payload.slug}`);
}

/**
 * 按 slug 删除服务。
 * @param {CliOptions} options 命令参数
 * @returns {Promise<void>}
 */
async function deleteService(options) {
  requireFields(options, ["apiBaseUrl", "registerKey", "slug"]);
  validateSlug(options.slug);

  const apiBase = normalizeApiBaseUrl(options.apiBaseUrl);
  const endpoint = `${apiBase}/services/${encodeURIComponent(options.slug)}`;

  logInfo(`开始删除服务: slug=${options.slug}, api=${endpoint}`);
  await requestJson(endpoint, {
    method: "DELETE",
    headers: buildHeaders(options.registerKey)
  });

  logInfo(`删除成功: slug=${options.slug}`);
}

/**
 * 解析命令行参数（--key value 形式）。
 * @param {string[]} args 命令参数数组
 * @returns {CliOptions}
 */
function parseArgs(args) {
  /** @type {CliOptions} */
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const nextValue = args[i + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      options[key] = "";
      continue;
    }
    options[key] = nextValue;
    i += 1;
  }

  return options;
}

/**
 * 构建统一请求头。
 * @param {string} registerKey 注册密钥
 * @returns {Record<string, string>}
 */
function buildHeaders(registerKey) {
  return {
    "Content-Type": "application/json",
    "x-register-key": registerKey
  };
}

/**
 * 统一 JSON 请求，自动校验后端返回格式。
 * @param {string} url 请求地址
 * @param {RequestInit} init fetch 参数
 * @returns {Promise<any>}
 */
async function requestJson(url, init) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => {
    throw new Error(`接口返回非 JSON: ${url}`);
  });

  // 后端统一返回格式：code、msg、data、timestamp
  if (
    typeof result !== "object" ||
    result === null ||
    !Object.prototype.hasOwnProperty.call(result, "code") ||
    !Object.prototype.hasOwnProperty.call(result, "msg") ||
    !Object.prototype.hasOwnProperty.call(result, "timestamp")
  ) {
    throw new Error(`接口返回格式异常: ${url}`);
  }

  if (!response.ok || result.code !== 0) {
    throw new Error(result.msg || `请求失败(${response.status})`);
  }

  return result.data;
}

/**
 * 校验必要字段是否存在。
 * @param {CliOptions} options 命令参数
 * @param {string[]} fields 必填字段
 */
function requireFields(options, fields) {
  fields.forEach((field) => {
    if (!options[field] || !String(options[field]).trim()) {
      throw new Error(`缺少必要参数: --${field}`);
    }
  });
}

/**
 * 校验服务编码是否合法。
 * @param {string} slug 服务编码
 */
function validateSlug(slug) {
  if (!/^[a-z0-9-]{2,32}$/.test(slug)) {
    throw new Error("slug 格式不合法：仅允许小写字母、数字、连字符，长度 2-32");
  }
}

/**
 * 校验 URL 是否为 http/https。
 * @param {string} value URL 值
 * @param {string} field 字段名称
 */
function validateHttpUrl(value, field) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("protocol");
    }
  } catch (_) {
    throw new Error(`${field} 必须是合法的 http/https 地址`);
  }
}

/**
 * 规范化 API 前缀，统一为 xxx/api。
 * @param {string} baseUrl 基础地址
 * @returns {string}
 */
function normalizeApiBaseUrl(baseUrl) {
  const trimmed = String(baseUrl).trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("apiBaseUrl 不能为空");
  }
  if (trimmed.endsWith("/api")) {
    return trimmed;
  }
  return `${trimmed}/api`;
}

/**
 * 输出帮助说明。
 */
function printHelp() {
  console.log(`
[service-admin] 服务管理脚本

命令：
  register   注册或更新服务（幂等）
  delete     删除指定 slug 的服务

参数：
  --apiBaseUrl   网关地址，支持 https://638rember.me 或 https://638rember.me/api
  --registerKey  注册密钥（必填）
  --slug         服务编码（必填）

register 额外必填参数：
  --name
  --description
  --targetUrl

register 可选参数：
  --tag           默认：业务服务
  --tone          默认：indigo

示例：
  node service-admin.js register --apiBaseUrl "https://638rember.me" --registerKey "heq123456" --name "OpenClaw" --slug "openclaw" --description "OpenClaw 本机服务" --targetUrl "https://638rember.me/openclaw/" --tag "AI服务" --tone "violet"
  node service-admin.js delete --apiBaseUrl "https://638rember.me" --registerKey "heq123456" --slug "openclaw"
`.trim());
}

/**
 * 打印统一信息日志。
 * @param {string} message 日志内容
 */
function logInfo(message) {
  console.log(`[service-admin] ${message}`);
}

main();
