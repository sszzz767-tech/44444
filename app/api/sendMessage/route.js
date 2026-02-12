import { NextResponse } from "next/server";

const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "https://oapi.dingtalk.com/robot/send?access_token=你的token";
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const TENCENT_CLOUD_KOOK_URL = process.env.TENCENT_CLOUD_KOOK_URL || "https://你的腾讯云函数地址";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";
const SEND_TO_KOOK = process.env.SEND_TO_KOOK === "true";
const SEND_TO_DISCORD = process.env.SEND_TO_DISCORD === "true";
const DEFAULT_KOOK_CHANNEL_ID = process.env.DEFAULT_KOOK_CHANNEL_ID || "3152587560978791";

const lastEntryBySymbol = Object.create(null);

// ---------- 智能价格格式化（保留原始小数位数，最多5位）----------
function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  
  // 如果是字符串，直接原样返回（但会清理多余空格）
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  
  // 如果是数字，转换为字符串，保留原始小数位数（最多5位）
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  
  if (decimalIndex === -1) return strValue; // 整数
  
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  
  // 如果小数位超过5位，截断到5位
  if (decimalLength > 5) {
    return value.toFixed(5);
  }
  
  return strValue; // 保留原始小数位数（包括末尾的0）
}

// ---------- 辅助函数：解析原始消息 ----------
function getNum(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const m = String(text).match(re);
  return m ? parseFloat(m[1]) : null;
}

function getStr(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([^,\\n]+)`);
  const m = String(text).match(re);
  return m ? m[1].trim() : null;
}

// 获取原始价格字符串（用于保留完整精度）
function getPriceStr(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const m = String(text).match(re);
  return m ? m[1].trim() : null;
}

function getSymbol(text) {
  const symbol = getStr(text, "品种");
  return symbol ? symbol.split(' ')[0].replace(/[^a-zA-Z0-9.]/g, '') : null;
}

function getDirection(text) {
  const direction = getStr(text, "方向");
  return direction ? direction.replace(/[^多头空头]/g, '') : null;
}

// ---------- 消息类型判断 ----------
function isTP2(t) { return /TP2达成/.test(t); }
function isTP1(t) { return /TP1达成/.test(t); }
function isBreakeven(t) { return /已到保本位置/.test(t); }
function isBreakevenStop(t) { return /保本止损.*触发/.test(t); }
function isInitialStop(t) { return /初始止损.*触发/.test(t); }
function isEntry(t) {
  return /【开仓】/.test(t) || (/开仓价格/.test(t) && !isTP1(t) && !isTP2(t) && !isBreakeven(t) && !isBreakevenStop(t) && !isInitialStop(t));
}

function getMessageType(text) {
  if (isTP2(text)) return "TP2";
  if (isTP1(text)) return "TP1";
  if (isBreakeven(text)) return "BREAKEVEN";
  if (isBreakevenStop(text)) return "BREAKEVEN_STOP";
  if (isInitialStop(text)) return "INITIAL_STOP";
  if (isEntry(text)) return "ENTRY";
  return "OTHER";
}

// ---------- 格式化消息（完整小数位，无头部文字）----------
function formatForDingTalk(raw) {
  let text = String(raw || "")
    .replace(/\\u[\dA-Fa-f]{4}/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const MODEL_NAME = "RS-3.2";
  const symbol = getSymbol(text) || "-";
  const direction = getDirection(text) || "多頭";

  // 优先使用原始价格字符串，若不存在则使用数字格式化
  const entryPriceStr = getPriceStr(text, "开仓价格");
  const stopPriceStr = getPriceStr(text, "止损价格");
  const breakevenPriceStr = getPriceStr(text, "保本位");
  const tp1PriceStr = getPriceStr(text, "TP1");
  const tp2PriceStr = getPriceStr(text, "TP2");
  const triggerPriceStr = getPriceStr(text, "触发价格") || getPriceStr(text, "平仓价格");

  // 回退：如果没有原始字符串，则用数字格式
  const entryPriceNum = getNum(text, "开仓价格");
  const stopPriceNum = getNum(text, "止损价格");
  const breakevenPriceNum = getNum(text, "保本位");
  const tp1PriceNum = getNum(text, "TP1");
  const tp2PriceNum = getNum(text, "TP2");
  const triggerPriceNum = getNum(text, "触发价格") || getNum(text, "平仓价格");

  // 统一格式化函数：优先使用原始字符串，否则用数字
  const fmt = (str, num) => {
    if (str) return str;
    if (num != null) return formatPriceSmart(num);
    return "-";
  };

  let body = "";

  if (isEntry(text)) {
    if (symbol && entryPriceNum != null) {
      lastEntryBySymbol[symbol] = { entry: entryPriceNum, t: Date.now() };
    }

    body = 
      `⚡ 系統執行\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `入場確認\n` +
      `風險設定完成\n` +
      `執行生效\n\n` +
      `入場位：${fmt(entryPriceStr, entryPriceNum)}\n` +
      `風險位：${fmt(stopPriceStr, stopPriceNum)}\n` +
      `保護位：${fmt(breakevenPriceStr, breakevenPriceNum)}\n` +
      `階段一：${fmt(tp1PriceStr, tp1PriceNum)}\n` +
      `階段二：${fmt(tp2PriceStr, tp2PriceNum)}\n\n` +
      `狀態：運行中`;
  }
  else if (isBreakeven(text)) {
    body = 
      `⚡ 倉位更新\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `保護位生效\n` +
      `風險已轉移\n\n` +
      `當前保護位：${fmt(breakevenPriceStr || triggerPriceStr, breakevenPriceNum ?? triggerPriceNum)}\n\n` +
      `狀態：已保護`;
  }
  else if (isBreakevenStop(text)) {
    body = 
      `⚡ 倉位關閉\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `保護位觸發\n` +
      `倉位平倉\n\n` +
      `風險已完全轉移\n\n` +
      `狀態：重置`;
  }
  else if (isTP1(text)) {
    body = 
      `⚡ 階段推進\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `階段一完成\n` +
      `結構延伸\n\n` +
      `狀態：持續運行`;
  }
  else if (isTP2(text)) {
    body = 
      `⚡ 階段完成\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `階段二完成\n` +
      `本輪結構結束\n\n` +
      `狀態：重置中`;
  }
  else if (isInitialStop(text)) {
    body = 
      `⚡ 週期關閉\n\n` +
      `模型：${MODEL_NAME}\n` +
      `標的：${symbol}\n` +
      `方向：${direction}\n\n` +
      `風險觸發\n` +
      `倉位關閉\n\n` +
      `狀態：重置`;
  }
  else {
    body = String(text).replace(/,\s*/g, "\n").replace(/\\n/g, "\n");
  }

  // 直接返回正文，无头部文字
  return body;
}

// ---------- Discord 发送（纯文本）----------
async function sendToDiscord(messageData) {
  if (!SEND_TO_DISCORD || !DISCORD_WEBHOOK_URL) {
    console.log("Discord发送未启用或Webhook未配置，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到Discord（纯文本） ===");
    const discordPayload = { content: messageData };
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord响应错误:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    console.log("Discord消息发送成功");
    return { success: true };
  } catch (error) {
    console.error("发送到Discord失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

// ---------- KOOK 发送（保持不变）----------
async function sendToKook(messageData, rawData, messageType) {
  if (!SEND_TO_KOOK) {
    console.log("KOOK发送未启用，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到腾讯云KOOK服务 ===");
    const kookPayload = {
      channelId: DEFAULT_KOOK_CHANNEL_ID,
      formattedMessage: messageData,
      messageType: messageType,
      timestamp: Date.now(),
      symbol: getSymbol(rawData),
      direction: getDirection(rawData)
    };
    const response = await fetch(TENCENT_CLOUD_KOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kookPayload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("腾讯云响应错误:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const result = await response.json();
    console.log("腾讯云KOOK服务响应:", result);
    return { success: true, data: result };
  } catch (error) {
    console.error("发送到腾讯云KOOK服务失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

// ---------- POST 入口 ----------
export async function POST(req) {
  try {
    console.log("=== 收到TradingView Webhook请求 ===");
    const contentType = req.headers.get("content-type") || "";
    let raw;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      raw = typeof json === "string" ? json : json?.message || json?.text || json?.content || JSON.stringify(json || {});
    } else {
      raw = await req.text();
    }

    console.log("原始请求数据:", raw.substring(0, 500) + (raw.length > 500 ? "..." : ""));
    let processedRaw = String(raw || "").replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

    const isValid = processedRaw && /(品种|方向|开仓|止损|TP1|TP2|保本|盈利|胜率|交易次数)/.test(processedRaw);
    if (!isValid) {
      console.log("收到无效或空白消息，跳过处理");
      return NextResponse.json({ ok: true, skipped: true, reason: "无效或空白消息" });
    }

    const formattedMessage = formatForDingTalk(processedRaw);
    const messageType = getMessageType(processedRaw);
    console.log("消息类型:", messageType);
    console.log("格式化消息预览:\n", formattedMessage);

    console.log("=== 开始并行发送消息 ===");
    const [dingtalkResult, kookResult, discordResult] = await Promise.allSettled([
      (async () => {
        console.log("开始发送到钉钉...");
        if (USE_RELAY_SERVICE) {
          const relayPayload = {
            message: formattedMessage,
            needImage: false,
            imageParams: null,
            dingtalkWebhook: DINGTALK_WEBHOOK
          };
          const relayResponse = await fetch(RELAY_SERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(relayPayload)
          });
          const relayData = await relayResponse.json();
          if (!relayData.success) throw new Error(relayData.error || "中继服务返回错误");
          return { ok: true, relayData, method: "relay" };
        } else {
          const markdown = {
            msgtype: "markdown",
            markdown: {
              title: "交易通知",
              text: formattedMessage
            },
            at: { isAtAll: false }
          };
          const resp = await fetch(DINGTALK_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(markdown)
          });
          const data = await resp.json().catch(() => ({}));
          return { ok: true, dingTalk: data, method: "direct" };
        }
      })(),
      sendToKook(formattedMessage, processedRaw, messageType),
      sendToDiscord(formattedMessage)
    ]);

    const results = {
      dingtalk: dingtalkResult.status === 'fulfilled' ? dingtalkResult.value : { error: dingtalkResult.reason?.message },
      kook: kookResult.status === 'fulfilled' ? kookResult.value : { error: kookResult.reason?.message },
      discord: discordResult.status === 'fulfilled' ? discordResult.value : { error: discordResult.reason?.message }
    };

    console.log("=== 最终发送结果 ===", results);
    return NextResponse.json({ ok: true, results, method: USE_RELAY_SERVICE ? "relay" : "direct" });
  } catch (e) {
    console.error("处理请求时发生错误:", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(
    JSON.stringify({ message: 'TradingView Webhook API is running', timestamp: new Date().toISOString() }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
