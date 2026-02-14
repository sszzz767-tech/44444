// /app/api/tradingview/route.js
// 最终版 —— 消息推送集成代码，为保本/TP1/TP2 自动附加图片，Discord 同时显示图片链接
import { NextResponse } from "next/server";

// ---------- 环境变量 ----------
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "https://oapi.dingtalk.com/robot/send?access_token=你的token";
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const TENCENT_CLOUD_KOOK_URL = process.env.TENCENT_CLOUD_KOOK_URL || "https://你的腾讯云函数地址";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";
const SEND_TO_KOOK = process.env.SEND_TO_KOOK === "true";
const SEND_TO_DISCORD = process.env.SEND_TO_DISCORD === "true";
const DEFAULT_KOOK_CHANNEL_ID = process.env.DEFAULT_KOOK_CHANNEL_ID || "3152587560978791";
const DEFAULT_CAPITAL = parseFloat(process.env.DEFAULT_CAPITAL || "1000"); // 默认本金 1000 USDT
const IMAGE_BASE_URL = "https://aa44444.vercel.app"; // 图片服务的部署域名

// 用于临时存储开仓价格（按交易对）
const lastEntryBySymbol = Object.create(null);

// ---------- 辅助解析函数 ----------
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

function getSymbol(text) {
  const symbol = getStr(text, "品种");
  return symbol ? symbol.split(' ')[0].replace(/[^a-zA-Z0-9.]/g, '') : null;
}

function getDirection(text) {
  const dir = getStr(text, "方向");
  if (!dir) return null;
  // 转换为标准显示：买/卖
  if (dir.includes("多") || dir.includes("buy") || dir.includes("Buy") || dir === "买") return "买";
  if (dir.includes("空") || dir.includes("sell") || dir.includes("Sell") || dir === "卖") return "卖";
  return null;
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

// ---------- 格式化价格（保留原始精度，用于显示）----------
function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  if (decimalIndex === -1) return strValue;
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  if (decimalLength > 5) return value.toFixed(5);
  return strValue;
}

// ---------- 构建图片 URL ----------
function generateImageURL(params) {
  const { symbol, direction, entry, price, capital = DEFAULT_CAPITAL } = params;
  const url = new URL(`${IMAGE_BASE_URL}/api/card-image`);
  url.searchParams.set('symbol', symbol || 'SOLUSDT.P');
  url.searchParams.set('direction', direction === '卖' ? '卖' : '买'); // 确保是“买”或“卖”
  url.searchParams.set('entry', formatPriceSmart(entry));
  url.searchParams.set('price', formatPriceSmart(price));
  url.searchParams.set('capital', capital.toString());
  return url.toString();
}

// ---------- 格式化消息（精简版，完全符合新模板）----------
function formatForDingTalk(raw) {
  const text = String(raw || "").replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

  const symbol = getSymbol(text) || "SYMBOL";
  const direction = getDirection(text) || "买";
  const symbolLine = `${symbol} ｜ ${direction === '卖' ? '空頭' : '多頭'}`;

  // 提取各类价格
  const entryPrice = getNum(text, "开仓价格");
  const stopPrice = getNum(text, "止损价格");
  const breakevenPrice = getNum(text, "保本位");
  const tp1Price = getNum(text, "TP1");
  const tp2Price = getNum(text, "TP2");
  const triggerPrice = getNum(text, "触发价格") || getNum(text, "平仓价格");

  // 如果是开仓，记录价格
  if (isEntry(text) && symbol && entryPrice != null) {
    lastEntryBySymbol[symbol] = { entry: entryPrice, t: Date.now() };
  }

  let body = "";

  // ----- 1. 开仓 -----
  if (isEntry(text)) {
    body =
      `⚡ 系統啟動\n` +
      `${symbolLine}\n\n` +
      `入場：${formatPriceSmart(entryPrice)}\n` +
      `風險：${formatPriceSmart(stopPrice)}\n` +
      `保護：${formatPriceSmart(breakevenPrice)}\n\n` +
      `階段一：${formatPriceSmart(tp1Price)}\n` +
      `階段二：${formatPriceSmart(tp2Price)}\n\n` +
      `狀態：持倉`;
  }

  // ----- 2. 保本触发 -----
  else if (isBreakeven(text)) {
    body =
      `⚡ 倉位更新\n` +
      `${symbolLine}\n\n` +
      `保護位生效\n` +
      `風險轉移完成\n\n` +
      `保護：${formatPriceSmart(breakevenPrice || triggerPrice)}\n\n` +
      `狀態：已保護`;
  }

  // ----- 3. TP1 达成 -----
  else if (isTP1(text)) {
    body =
      `⚡ 階段推進\n` +
      `${symbolLine}\n\n` +
      `階段一完成\n` +
      `結構延伸中\n\n` +
      `狀態：持續持倉`;
  }

  // ----- 4. TP2 达成 -----
  else if (isTP2(text)) {
    body =
      `⚡ 階段完成\n` +
      `${symbolLine}\n\n` +
      `階段二完成\n` +
      `本輪結構結束\n\n` +
      `狀態：週期重置`;
  }

  // ----- 5. 保本止损触发 -----
  else if (isBreakevenStop(text)) {
    body =
      `⚡ 倉位關閉\n` +
      `${symbolLine}\n\n` +
      `保護觸發\n` +
      `倉位平倉\n\n` +
      `風險已完全轉移\n\n` +
      `狀態：重置`;
  }

  // ----- 6. 初始止损触发 -----
  else if (isInitialStop(text)) {
    body =
      `⚡ 週期關閉\n` +
      `${symbolLine}\n\n` +
      `風險觸發\n` +
      `倉位關閉\n\n` +
      `狀態：重置`;
  }

  // ----- 其他未知消息 -----
  else {
    body = text.replace(/,\s*/g, "\n").replace(/\\n/g, "\n");
  }

  return body;
}

// ---------- 发送到 Discord（纯文本 + 可选图片链接）----------
async function sendToDiscord(messageData, imageUrl = null) {
  if (!SEND_TO_DISCORD || !DISCORD_WEBHOOK_URL) {
    console.log("Discord发送未启用或Webhook未配置，跳过");
    return { success: true, skipped: true };
  }
  try {
    // 如果有图片，将图片 URL 附加到消息末尾
    const content = imageUrl ? `${messageData}\n${imageUrl}` : messageData;
    const payload = { content };
    const resp = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log("Discord消息发送成功");
    return { success: true };
  } catch (e) {
    console.error("Discord发送失败:", e);
    return { success: false, error: e.message };
  }
}

// ---------- 发送到 KOOK（可选保留）----------
async function sendToKook(messageData, rawData, messageType) {
  if (!SEND_TO_KOOK) return { success: true, skipped: true };
  try {
    const payload = {
      channelId: DEFAULT_KOOK_CHANNEL_ID,
      formattedMessage: messageData,
      messageType,
      timestamp: Date.now(),
      symbol: getSymbol(rawData),
      direction: getDirection(rawData)
    };
    const resp = await fetch(TENCENT_CLOUD_KOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    return { success: true, data: result };
  } catch (e) {
    console.error("KOOK发送失败:", e);
    return { success: false, error: e.message };
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
      raw = typeof json === "string" ? json : json?.message || json?.text || json?.content || JSON.stringify(json);
    } else {
      raw = await req.text();
    }

    const processedRaw = String(raw).replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

    if (!processedRaw || !/(品种|方向|开仓|止损|TP1|TP2|保本|盈利|胜率|交易次数)/.test(processedRaw)) {
      console.log("无效或空白消息，跳过");
      return NextResponse.json({ ok: true, skipped: true, reason: "无效或空白消息" });
    }

    const formattedMessage = formatForDingTalk(processedRaw);
    const messageType = getMessageType(processedRaw);
    console.log("消息类型:", messageType);
    console.log("格式化消息预览:\n", formattedMessage);

    // 检查是否需要附加图片（仅保本/TP1/TP2）
    let imageUrl = null;
    if (isBreakeven(processedRaw) || isTP1(processedRaw) || isTP2(processedRaw)) {
      const symbol = getSymbol(processedRaw) || "SYMBOL";
      const direction = getDirection(processedRaw) || "买";
      const entry = getNum(processedRaw, "开仓价格") || (symbol && lastEntryBySymbol[symbol]?.entry) || null;
      let price = null;
      if (isBreakeven(processedRaw)) {
        price = getNum(processedRaw, "保本位") || getNum(processedRaw, "触发价格") || getNum(processedRaw, "平仓价格");
      } else if (isTP1(processedRaw)) {
        price = getNum(processedRaw, "TP1价格") || getNum(processedRaw, "TP1");
      } else if (isTP2(processedRaw)) {
        price = getNum(processedRaw, "TP2价格") || getNum(processedRaw, "TP2");
      }
      if (price === null) {
        price = getNum(processedRaw, "最新价格") || getNum(processedRaw, "当前价格") || getNum(processedRaw, "市价");
      }

      imageUrl = generateImageURL({
        symbol,
        direction,
        entry,
        price,
        capital: DEFAULT_CAPITAL,
      });

      console.log("生成的图片URL:", imageUrl);
    }

    // 最终发送的消息内容（用于钉钉/KOOK）：纯文本 + 图片 Markdown 链接
    let finalMessage = formattedMessage;
    if (imageUrl) {
      finalMessage += `\n\n![交易图表](${imageUrl})`;
    }

    // 并行发送
    const [dingtalkResult, kookResult, discordResult] = await Promise.allSettled([
      // 钉钉发送
      (async () => {
        if (USE_RELAY_SERVICE) {
          const relayPayload = {
            message: finalMessage,
            needImage: false,
            imageParams: null,
            dingtalkWebhook: DINGTALK_WEBHOOK,
          };
          const resp = await fetch(RELAY_SERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(relayPayload)
          });
          const data = await resp.json();
          if (!data.success) throw new Error(data.error);
          return { ok: true, relayData: data };
        } else {
          const markdown = {
            msgtype: "markdown",
            markdown: { title: "交易通知", text: finalMessage },
            at: { isAtAll: false }
          };
          const resp = await fetch(DINGTALK_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(markdown)
          });
          const data = await resp.json().catch(() => ({}));
          return { ok: true, dingTalk: data };
        }
      })(),

      // KOOK 发送（如果需要）
      sendToKook(finalMessage, processedRaw, messageType),

      // Discord 发送（纯文本 + 图片链接，不包含 Markdown 图片语法）
      sendToDiscord(formattedMessage, imageUrl)
    ]);

    const results = {
      dingtalk: dingtalkResult.status === 'fulfilled' ? dingtalkResult.value : { error: dingtalkResult.reason?.message },
      kook: kookResult.status === 'fulfilled' ? kookResult.value : { error: kookResult.reason?.message },
      discord: discordResult.status === 'fulfilled' ? discordResult.value : { error: discordResult.reason?.message }
    };

    console.log("最终发送结果:", results);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("处理请求时发生错误:", e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

// ---------- GET 用于健康检查 ----------
export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(JSON.stringify({ message: 'TradingView Webhook API is running', timestamp: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
